import { OllamaClient, ChatMessage } from "./llm/ollama.js";
import { Config } from "./config.js";
import { getAllTools, executeTool, ToolCall, ToolResult, Tool } from "./tools/index.js";

export interface AgentEvent {
  type: "thinking" | "content" | "tool_use" | "tool_result" | "done" | "error";
  content?: string;
  tool?: string;
  status?: "start" | "complete" | "error";
  args?: Record<string, unknown>;
  result?: ToolResult;
  error?: string;
}

export interface AgentResult {
  content: string;
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }>;
}

const SYSTEM_PROMPT = `You are ACTIVO, an AI-powered code quality analyzer.

You help developers:
1. Analyze code quality and find issues
2. Import development standards from PDFs
3. Check code against standards
4. Navigate and understand codebases

You have access to these tools:
- read_file: Read file contents
- write_file: Write content to files
- list_directory: List directory contents
- grep_search: Search for patterns in files
- glob_search: Find files by pattern
- run_command: Execute shell commands
- import_pdf_standards: Convert PDF to markdown rules
- list_standards: List loaded standards
- check_code_quality: Check code against standards

When users ask in natural language, use the appropriate tools to help them.
Examples:
- "이 프로젝트 분석해줘" → Use list_directory, read_file to explore
- "PDF 규칙으로 변환해줘" → Use import_pdf_standards
- "코드 품질 검사해줘" → Use check_code_quality
- "UserService 찾아줘" → Use grep_search or glob_search

Always explain what you're doing and provide helpful insights.
Respond in the same language as the user's input.`;

export async function processMessage(
  userMessage: string,
  history: ChatMessage[],
  client: OllamaClient,
  config: Config,
  onEvent?: (event: AgentEvent) => void
): Promise<AgentResult> {
  const tools = getAllTools();
  const toolDefinitions = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  const toolCallResults: AgentResult["toolCalls"] = [];
  let finalContent = "";
  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    iterations++;

    onEvent?.({ type: "thinking" });

    const response = await client.chat(messages, tools as Tool[]);
    messages.push(response);

    // If no tool calls, we're done
    if (!response.toolCalls?.length) {
      finalContent = response.content;
      break;
    }

    // Process tool calls
    for (const toolCall of response.toolCalls) {
      onEvent?.({
        type: "tool_use",
        tool: toolCall.name,
        status: "start",
        args: toolCall.arguments,
      });

      const result = await executeTool(toolCall);

      onEvent?.({
        type: "tool_result",
        tool: toolCall.name,
        status: result.success ? "complete" : "error",
        result,
      });

      toolCallResults.push({
        tool: toolCall.name,
        args: toolCall.arguments,
        result,
      });

      // Add tool result to messages
      messages.push({
        role: "tool",
        content: result.success ? result.content : `Error: ${result.error}`,
        toolCallId: toolCall.id,
      });
    }

    // Continue the conversation with tool results
    onEvent?.({ type: "content", content: response.content });
  }

  if (iterations >= maxIterations) {
    onEvent?.({ type: "error", error: "Maximum iterations reached" });
  }

  onEvent?.({ type: "done" });

  return {
    content: finalContent,
    toolCalls: toolCallResults,
  };
}

export async function* streamProcessMessage(
  userMessage: string,
  history: ChatMessage[],
  client: OllamaClient,
  config: Config,
  abortSignal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const tools = getAllTools();

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    // Check if aborted
    if (abortSignal?.aborted) {
      yield { type: "error", error: "Operation cancelled" };
      return;
    }

    iterations++;

    yield { type: "thinking" };

    let fullContent = "";
    const pendingToolCalls: ToolCall[] = [];

    for await (const event of client.streamChat(messages, tools as Tool[], abortSignal)) {
      // Check if aborted during streaming
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
        return;
      }
      if (event.type === "content" && event.content) {
        fullContent += event.content;
        yield { type: "content", content: event.content };
      } else if (event.type === "tool_call" && event.toolCall) {
        pendingToolCalls.push(event.toolCall);
      } else if (event.type === "error") {
        yield { type: "error", error: event.error };
        return;
      }
    }

    messages.push({ role: "assistant", content: fullContent, toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined });

    // If no tool calls, we're done
    if (pendingToolCalls.length === 0) {
      break;
    }

    // Process tool calls
    for (const toolCall of pendingToolCalls) {
      // Check if aborted before each tool call
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
        return;
      }

      yield {
        type: "tool_use",
        tool: toolCall.name,
        status: "start",
        args: toolCall.arguments,
      };

      const result = await executeTool(toolCall);

      // Check if aborted after tool execution
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
        return;
      }

      yield {
        type: "tool_result",
        tool: toolCall.name,
        status: result.success ? "complete" : "error",
        result,
      };

      messages.push({
        role: "tool",
        content: result.success ? result.content : `Error: ${result.error}`,
        toolCallId: toolCall.id,
      });
    }
  }

  yield { type: "done" };
}
