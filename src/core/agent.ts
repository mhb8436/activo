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

const BASE_SYSTEM_PROMPT = `You are ACTIVO, a code quality analyzer. You MUST call tools to perform tasks.

## CRITICAL RULES
1. Call tool IMMEDIATELY when user requests an action
2. NEVER output text before calling a tool
3. NEVER fabricate results - only report actual tool output
4. After tool returns, summarize in user's language (Korean if user speaks Korean)

## TOOLS BY CATEGORY

### Document Conversion
- import_hwp_standards(hwpPath, outputDir): Convert HWP to markdown
- import_pdf_standards(pdfPath, outputDir): Convert PDF to markdown

### Code Analysis (Recommended: use analyze_all)
- analyze_all(path, include?): Analyze all code (Java/JS/TS/Python)
- java_analyze(path): Java code analysis
- java_complexity(path): Java complexity metrics
- spring_check(path): Spring pattern check
- ast_analyze(path): JS/TS AST analysis
- react_check(path): React pattern check
- vue_check(path): Vue pattern check
- python_check(path): Python code analysis

### SQL/DB Analysis
- sql_check(path): SQL query analysis
- mybatis_check(path): MyBatis mapper analysis

### Web Analysis
- css_check(path): CSS analysis
- html_check(path): HTML analysis
- dependency_check(path): package.json dependency analysis
- openapi_check(path): OpenAPI spec analysis

### File Operations
- read_file(path): Read file content
- write_file(path, content): Write file
- list_directory(path): List directory contents
- grep_search(pattern, path): Search pattern in files
- glob_search(pattern): Search files by pattern

## EXAMPLE
User: "Analyze src folder"
→ Call analyze_all(path="src") immediately
→ After result: Summarize findings`;

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

    // Collect all events first (non-streaming mode for tools)
    for await (const event of client.streamChat(messages, tools as Tool[], abortSignal)) {
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
        return;
      }
      if (event.type === "content" && event.content) {
        fullContent += event.content;
        // Don't yield content yet - wait to see if there are tool calls
      } else if (event.type === "tool_call" && event.toolCall) {
        pendingToolCalls.push(event.toolCall);
      } else if (event.type === "error") {
        yield { type: "error", error: event.error };
        return;
      }
    }

    // Only yield content if NO tool calls (avoid hallucinated pre-tool text)
    if (pendingToolCalls.length === 0 && fullContent) {
      yield { type: "content", content: fullContent };
    } else if (pendingToolCalls.length > 0) {
      // Clear content when tool calls exist
      fullContent = "";
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
