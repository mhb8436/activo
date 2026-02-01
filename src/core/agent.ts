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

const BASE_SYSTEM_PROMPT = `You are ACTIVO, a code quality analyzer.

## ABSOLUTE RULE: NO TEXT WHEN CALLING TOOLS

When you call a tool, output NOTHING else. No text before, no text after. ONLY the tool call.

WRONG (NEVER DO THIS):
\`\`\`
실행 중... ← NO!
[some explanation] ← NO!
tool_call(...)
결과: ... ← NO! (you don't have results yet)
\`\`\`

CORRECT:
\`\`\`
tool_call(...)
\`\`\`

## AFTER TOOL RETURNS

Only AFTER you receive the actual tool result, you may write a response summarizing what the tool returned.

## HALLUCINATION = FAILURE

If you write ANY of these WITHOUT a tool result, you have FAILED:
- File names (e.g., "UserService.java")
- Numbers (e.g., "복잡도: 15", "3개 파일")
- Paths (e.g., "/path/to/file.md")
- Status messages (e.g., "변환 완료!", "성공")

## Tools

- analyze_all: 코드 분석
- import_pdf_standards: PDF→마크다운 (pdfPath 필수)
- import_hwp_standards: HWP→마크다운 (hwpPath 필수)
- read_file, write_file, list_directory, grep_search, glob_search: 파일

## Example

User: "HWP 파일을 마크다운으로 변환해줘"

YOUR RESPONSE (no other text):
→ Call import_hwp_standards with hwpPath

AFTER tool returns result:
→ Now you can summarize the actual result`;

// Build system prompt with optional context
function buildSystemPrompt(contextSummary?: string): string {
  if (!contextSummary) {
    return BASE_SYSTEM_PROMPT;
  }

  return `${BASE_SYSTEM_PROMPT}

## 이전 대화 컨텍스트

${contextSummary}

---
위 내용은 이전 세션에서의 대화 요약입니다. 필요시 참고하세요.`;
}

export async function processMessage(
  userMessage: string,
  history: ChatMessage[],
  client: OllamaClient,
  config: Config,
  onEvent?: (event: AgentEvent) => void,
  contextSummary?: string
): Promise<AgentResult> {
  const tools = getAllTools();
  const systemPrompt = buildSystemPrompt(contextSummary);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
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
  abortSignal?: AbortSignal,
  contextSummary?: string
): AsyncGenerator<AgentEvent> {
  const tools = getAllTools();
  const systemPrompt = buildSystemPrompt(contextSummary);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
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
