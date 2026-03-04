import type { LLMClient, ChatMessage } from "./llm/types.js";
import { Config } from "./config.js";
import { selectTools, executeTool, ToolCall, ToolResult, Tool } from "./tools/index.js";
import { detectAndExecuteIntent, compressAnalysisResult } from "./intentRouter.js";

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

// Extract a unique signature from a tool call for loop detection
function toolSignature(tc: ToolCall): string {
  const args = tc.arguments;
  const primary = args.filepath || args.path || args.pattern || args.file || args.directory || "";
  return `${tc.name}:${String(primary)}`;
}

const BASE_SYSTEM_PROMPT = `You are ACTIVO, a code quality analyzer. You MUST call tools to perform tasks.

## RULES
1. Call tool IMMEDIATELY when user requests an action
2. NEVER fabricate results - only report actual tool output
3. After tool returns, summarize in user's language (Korean if user speaks Korean)
4. Use analyze_all for broad code analysis
5. When all tools have completed, STOP calling tools and provide a final summary

## WORKFLOWS
- PDF→규칙: import_pdf_standards → generate_apex_rules (do NOT read_file individually)
- 코드분석: recommend_profile → mcp_apex_analyze_code → analyze_patterns
- 리포트: mcp_apex_analyze_code → generate_report`;

// System prompt for summary-only mode (no tool calling)
const SUMMARY_SYSTEM_PROMPT = `You are ACTIVO, a code quality analyzer.
You are summarizing tool results. Do NOT call any tools. Do NOT output XML or tool_use tags.
Just provide a clear, helpful summary in the user's language (Korean if user speaks Korean).`;

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

// ─── Main processing functions ───

export async function processMessage(
  userMessage: string,
  history: ChatMessage[],
  client: LLMClient,
  config: Config,
  onEvent?: (event: AgentEvent) => void,
  contextSummary?: string
): Promise<AgentResult> {
  // Try intent router first
  const intent = await detectAndExecuteIntent(userMessage, onEvent);

  if (intent.handled && intent.summaryPrompt) {
    // Tool already executed → ask LLM to summarize only (no tools = VRAM savings)
    onEvent?.({ type: "thinking" });

    const summaryMessages: ChatMessage[] = [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: intent.summaryPrompt },
    ];

    const response = await client.chat(summaryMessages); // No tools!

    onEvent?.({ type: "content", content: response.content });
    onEvent?.({ type: "done" });

    return {
      content: response.content,
      toolCalls: intent.toolResult
        ? [{ tool: intent.toolName!, args: intent.toolArgs!, result: intent.toolResult }]
        : [],
    };
  }

  // Fallback: existing LLM-driven tool selection
  const tools = selectTools(userMessage);
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
  const recentSignatures: string[] = [];

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

    // Detect true loops: same tool + same args 3+ times consecutively
    for (const tc of response.toolCalls) {
      recentSignatures.push(toolSignature(tc));
    }
    if (recentSignatures.length >= 3) {
      const last3 = recentSignatures.slice(-3);
      if (last3.every((s) => s === last3[0])) {
        const toolSummary = toolCallResults
          .map((tc) => `- ${tc.tool}(${Object.values(tc.args)[0] || ""}): ${tc.result.success ? "✓" : "✗"}`)
          .join("\n");
        finalContent = `동일한 작업이 반복되어 중단합니다.\n\n수행된 작업:\n${toolSummary}`;
        onEvent?.({ type: "content", content: finalContent });
        break;
      }
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

      // Add tool result to messages (compressed to avoid context overflow)
      const toolContent = result.success
        ? compressAnalysisResult(result.content, 8000)
        : `Error: ${result.error}`;
      messages.push({
        role: "tool",
        content: toolContent,
        toolCallId: toolCall.id,
      });
    }

    // Continue the conversation with tool results
    onEvent?.({ type: "content", content: response.content });
  }

  if (iterations >= maxIterations) {
    // Force LLM to generate final answer without tools
    messages.push({
      role: "user",
      content: "지금까지 수행된 작업 결과를 바탕으로 최종 답변을 작성해주세요. 더 이상 도구를 호출하지 마세요.",
    });

    try {
      const finalResponse = await client.chat(messages); // No tools!
      finalContent = finalResponse.content;
      onEvent?.({ type: "content", content: finalContent });
    } catch {
      const toolSummary = toolCallResults
        .map((tc) => `- ${tc.tool}(${Object.values(tc.args)[0] || ""}): ${tc.result.success ? "✓" : "✗"}`)
        .join("\n");
      finalContent = `작업이 최대 반복 횟수에 도달했습니다.\n\n수행된 작업:\n${toolSummary}`;
      onEvent?.({ type: "content", content: finalContent });
    }
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
  client: LLMClient,
  config: Config,
  abortSignal?: AbortSignal,
  contextSummary?: string
): AsyncGenerator<AgentEvent> {
  // Try intent router first — collect events from pipeline for later emission
  const collectedEvents: AgentEvent[] = [];
  const intent = await detectAndExecuteIntent(userMessage, (event) => {
    collectedEvents.push(event);
  });

  if (intent.handled) {
    // Emit all events that happened during intent detection (pipeline steps)
    for (const event of collectedEvents) {
      yield event;
    }

    if (intent.summaryPrompt) {
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
        return;
      }

      yield { type: "thinking" };

      // Stream the LLM summary (no tools = streaming mode in ollama client)
      const summaryMessages: ChatMessage[] = [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: intent.summaryPrompt },
      ];

      for await (const event of client.streamChat(summaryMessages, undefined, abortSignal)) {
        if (abortSignal?.aborted) {
          yield { type: "error", error: "Operation cancelled" };
          return;
        }
        if (event.type === "content" && event.content) {
          yield { type: "content", content: event.content };
        } else if (event.type === "error") {
          yield { type: "error", error: event.error };
          return;
        }
      }
    }

    yield { type: "done" };
    return;
  }

  // Fallback: existing LLM-driven tool selection
  const tools = selectTools(userMessage);
  const systemPrompt = buildSystemPrompt(contextSummary);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  let iterations = 0;
  const maxIterations = 10;
  const recentSignatures: string[] = [];
  const completedToolCalls: Array<{ tool: string; args: Record<string, unknown>; success: boolean }> = [];

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

    // Detect true loops: same tool + same args 3+ times consecutively
    for (const tc of pendingToolCalls) {
      recentSignatures.push(toolSignature(tc));
    }
    if (recentSignatures.length >= 3) {
      const last3 = recentSignatures.slice(-3);
      if (last3.every((s) => s === last3[0])) {
        const toolSummary = completedToolCalls
          .map((tc) => `- ${tc.tool}(${Object.values(tc.args)[0] || ""}): ${tc.success ? "✓" : "✗"}`)
          .join("\n");
        yield {
          type: "content",
          content: `\n\n동일한 작업이 반복되어 중단합니다.\n\n수행된 작업:\n${toolSummary}`,
        };
        break;
      }
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

      completedToolCalls.push({
        tool: toolCall.name,
        args: toolCall.arguments,
        success: result.success,
      });

      // Compress tool result to avoid context overflow (especially for Anthropic 200k limit)
      const toolContent = result.success
        ? compressAnalysisResult(result.content, 8000)
        : `Error: ${result.error}`;
      messages.push({
        role: "tool",
        content: toolContent,
        toolCallId: toolCall.id,
      });
    }
  }

  // If maxIterations reached, force LLM to generate final answer
  if (iterations >= maxIterations) {
    // Add a nudge message asking LLM to summarize
    messages.push({
      role: "user",
      content: "지금까지 수행된 작업 결과를 바탕으로 최종 답변을 작성해주세요. 더 이상 도구를 호출하지 마세요.",
    });

    try {
      // One final LLM call WITHOUT tools to force a text response
      for await (const event of client.streamChat(messages, undefined, abortSignal)) {
        if (abortSignal?.aborted) break;
        if (event.type === "content" && event.content) {
          yield { type: "content", content: event.content };
        }
      }
    } catch {
      // Fallback: show tool summary if final LLM call fails
      const toolSummary = completedToolCalls
        .map((tc) => `- ${tc.tool}(${Object.values(tc.args)[0] || ""}): ${tc.success ? "✓" : "✗"}`)
        .join("\n");
      yield {
        type: "content",
        content: `\n\n작업이 최대 반복 횟수에 도달했습니다.\n\n수행된 작업:\n${toolSummary}`,
      };
    }
  }

  yield { type: "done" };
}
