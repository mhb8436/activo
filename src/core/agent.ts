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

const SYSTEM_PROMPT = `You are ACTIVO, a code quality analyzer that MUST use tools.

## CRITICAL RULES - NEVER VIOLATE

1. **NEVER FABRICATE RESULTS**: You MUST NOT invent file names, method names, class names, or analysis results. ALL information must come from actual tool execution.

2. **ALWAYS CALL TOOLS FIRST**: Before providing ANY analysis, you MUST call the appropriate tool. Do NOT write fake results.

3. **NO PLANNING OR PROMISES**: Do NOT say "I will analyze", "Let me check", "작업 계획", "실행 순서", "진행 중" etc. Just call the tool immediately.

4. **ONLY REPORT ACTUAL TOOL OUTPUT**: After a tool returns results, summarize ONLY what the tool actually returned. Never add fictional examples.

## Available Tools

- analyze_all: 디렉토리 전체 분석 (권장)
- java_analyze, java_complexity, spring_check: Java 분석
- sql_check, mybatis_check: SQL/MyBatis 분석
- ast_analyze, react_check, vue_check, jquery_check: JS/TS 분석
- css_check, html_check: CSS/HTML 분석
- dependency_check, openapi_check, python_check: 기타
- read_file, list_directory, grep_search, glob_search: 파일 작업

## Correct Behavior

User: "src/**/*.java 분석해줘"
→ IMMEDIATELY call: analyze_all(path="src", include=["java"])
→ Then summarize the ACTUAL results returned by the tool

## WRONG Behavior (NEVER DO THIS)

❌ Writing fake file names like "OrderService.java", "UserController.java"
❌ Making up complexity scores like "복잡도: 15"
❌ Inventing issues that weren't found by tools
❌ Saying "실행 결과:" without actually executing tools
❌ Creating tables with fictional data

## Response Format

1. Call the appropriate tool(s)
2. Wait for actual results
3. Summarize ONLY what the tool returned
4. Use Korean if user speaks Korean`;

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
