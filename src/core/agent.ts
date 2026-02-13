import * as fs from "fs";
import { OllamaClient, ChatMessage } from "./llm/ollama.js";
import { Config } from "./config.js";
import { getAllTools, selectTools, executeTool, ToolCall, ToolResult, Tool } from "./tools/index.js";

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

## RULES
1. Call tool IMMEDIATELY when user requests an action
2. NEVER fabricate results - only report actual tool output
3. After tool returns, summarize in user's language (Korean if user speaks Korean)
4. Use analyze_all for broad code analysis`;

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

// ─── Intent Router ───

interface IntentResult {
  handled: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ToolResult;
  summaryPrompt?: string;
}

interface IntentPattern {
  keywords: string[];
  tool: string;
  buildArgs: (path: string, message: string) => Record<string, unknown>;
}

// Intent patterns: keyword groups → tool + args builder
const INTENT_PATTERNS: IntentPattern[] = [
  // Single file analysis (must come before directory patterns)
  {
    keywords: ["분석", "analyze", "검사", "check"],
    tool: "_single_file",  // special marker - resolved at match time
    buildArgs: (path: string) => ({ filepath: path }),
  },
  // analyze_all with Java filter
  {
    keywords: ["자바", "java"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["java"] }),
  },
  // Spring patterns
  {
    keywords: ["spring", "스프링"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["java"] }),
  },
  // Dependency analysis
  {
    keywords: ["의존성", "dependency", "dependencies", "취약점"],
    tool: "dependency_check",
    buildArgs: (path: string) => ({ path }),
  },
  // Complexity
  {
    keywords: ["복잡도", "complexity"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path }),
  },
  // Python
  {
    keywords: ["python", "파이썬", ".py"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["py"] }),
  },
  // Frontend
  {
    keywords: ["react", "리액트", "vue", "뷰", "프론트엔드", "frontend"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["js", "ts", "jsx", "tsx", "vue"] }),
  },
  // CSS
  {
    keywords: ["css", "scss", "less", "스타일"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["css"] }),
  },
  // HTML
  {
    keywords: ["html", "jsp", "접근성", "a11y", "seo"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["html"] }),
  },
  // SQL / MyBatis
  {
    keywords: ["sql", "mybatis", "마이바티스", "쿼리"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["java", "xml"] }),
  },
  // Broad analysis (catch-all, must be last)
  {
    keywords: ["전체분석", "전체 분석", "분석해", "코드품질", "코드 품질", "analyze", "분석", "검사", "check"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path }),
  },
];

// File extension → single-file tool mapping
const FILE_TOOL_MAP: Record<string, string> = {
  ".java": "java_analyze",
  ".js": "ast_analyze",
  ".ts": "ast_analyze",
  ".jsx": "react_check",
  ".tsx": "react_check",
  ".vue": "vue_check",
  ".py": "python_check",
  ".css": "css_check",
  ".scss": "css_check",
  ".less": "css_check",
  ".html": "html_check",
  ".htm": "html_check",
  ".jsp": "html_check",
};

/**
 * Extract filesystem paths from user message.
 * Handles quoted paths (with spaces), simple paths, and greedy path expansion.
 */
function extractPaths(message: string): string[] {
  const paths: string[] = [];

  // 1. Quoted paths: '...' or "..."
  const quotedMatches = message.match(/['"]([/\\][^'"]+)['"]/g);
  if (quotedMatches) {
    for (const m of quotedMatches) {
      paths.push(m.slice(1, -1)); // strip quotes
    }
  }

  // 2. Simple paths (no spaces) - Unix & Windows
  const unixMatches = message.match(/(?:^|\s)(\/[^\s,;:'"]+)/g);
  if (unixMatches) {
    for (const m of unixMatches) {
      paths.push(m.trim());
    }
  }
  const winMatches = message.match(/(?:^|\s)([A-Z]:\\[^\s,;:'"]+)/gi);
  if (winMatches) {
    for (const m of winMatches) {
      paths.push(m.trim());
    }
  }

  // 3. Greedy path expansion: if simple match doesn't exist,
  //    try extending with subsequent words until path is valid
  if (paths.length === 0 || !paths.some((p) => { try { return fs.existsSync(p); } catch { return false; } })) {
    const words = message.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      if (words[i].startsWith("/") || /^[A-Z]:\\/i.test(words[i])) {
        // Found a path start, try extending
        let candidate = words[i];
        let bestPath = "";
        // Check initial segment
        try { if (fs.existsSync(candidate)) bestPath = candidate; } catch { /* */ }
        // Extend with subsequent words
        for (let j = i + 1; j < words.length; j++) {
          const extended = candidate + " " + words[j];
          try {
            if (fs.existsSync(extended)) {
              bestPath = extended;
              candidate = extended;
            } else {
              // No more valid extensions - stop
              break;
            }
          } catch {
            break;
          }
        }
        if (bestPath) {
          paths.push(bestPath);
        }
      }
    }
  }

  // Filter to actually existing paths, deduplicate
  const seen = new Set<string>();
  return paths.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/**
 * Determine if a path is a single file (not a directory).
 */
function isSingleFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the correct tool for a single file based on extension.
 */
function resolveFileAnalysisTool(filepath: string): { tool: string; args: Record<string, unknown> } | null {
  const ext = filepath.substring(filepath.lastIndexOf(".")).toLowerCase();
  const toolName = FILE_TOOL_MAP[ext];
  if (!toolName) return null;

  // Some tools use 'filepath', others use 'path'
  const argKey = ["python_check", "css_check", "html_check"].includes(toolName) ? "path" : "filepath";
  return { tool: toolName, args: { [argKey]: filepath } };
}

/**
 * Detect user intent from the message and automatically execute the appropriate tool.
 * Returns IntentResult with handled=true if a tool was executed, false otherwise.
 */
async function detectAndExecuteIntent(
  userMessage: string,
  onEvent?: (event: AgentEvent) => void
): Promise<IntentResult> {
  const msg = userMessage.toLowerCase();
  const paths = extractPaths(userMessage);

  // No path found → can't auto-route
  if (paths.length === 0) {
    return { handled: false };
  }

  const targetPath = paths[0];

  // Check if path is a single file
  if (isSingleFile(targetPath)) {
    const fileInfo = resolveFileAnalysisTool(targetPath);
    if (fileInfo) {
      return await executeIntentTool(fileInfo.tool, fileInfo.args, onEvent);
    }
    // Unknown file type → fall back to LLM
    return { handled: false };
  }

  // Path is a directory → match intent patterns
  for (const pattern of INTENT_PATTERNS) {
    // Skip the single-file marker for directories
    if (pattern.tool === "_single_file") continue;

    if (pattern.keywords.some((kw) => msg.includes(kw))) {
      const args = pattern.buildArgs(targetPath, userMessage);
      return await executeIntentTool(pattern.tool, args, onEvent);
    }
  }

  // Has a directory path but no matching keyword → default to analyze_all
  // (user likely wants some kind of analysis if they provided a path)
  const hasAnalysisHint = /분석|검사|확인|체크|check|analyze|review|scan|report/i.test(msg);
  if (hasAnalysisHint) {
    return await executeIntentTool("analyze_all", { path: targetPath }, onEvent);
  }

  return { handled: false };
}

/**
 * Execute a tool by name and return an IntentResult with the summary prompt.
 */
async function executeIntentTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  onEvent?: (event: AgentEvent) => void
): Promise<IntentResult> {
  const toolCall: ToolCall = {
    id: `intent_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: toolName,
    arguments: toolArgs,
  };

  // Emit tool_use start event
  onEvent?.({
    type: "tool_use",
    tool: toolName,
    status: "start",
    args: toolArgs,
  });

  const result = await executeTool(toolCall);

  // Emit tool_result event
  onEvent?.({
    type: "tool_result",
    tool: toolName,
    status: result.success ? "complete" : "error",
    result,
  });

  if (!result.success) {
    return {
      handled: true,
      toolName,
      toolArgs,
      toolResult: result,
      summaryPrompt: `도구 "${toolName}" 실행 중 오류가 발생했습니다: ${result.error}\n사용자에게 오류 내용을 설명해주세요.`,
    };
  }

  // Compress result to fit in context window
  const compressed = compressAnalysisResult(result.content);

  return {
    handled: true,
    toolName,
    toolArgs,
    toolResult: result,
    summaryPrompt: `아래는 "${toolName}" 도구의 실행 결과입니다. 사용자에게 한국어로 핵심 내용을 요약해주세요.\n\n${compressed}`,
  };
}

/**
 * Compress analysis result JSON to fit within LLM context window.
 * Extracts only key metrics, removing verbose raw data.
 */
function compressAnalysisResult(resultContent: string, maxChars: number = 2000): string {
  try {
    const parsed = JSON.parse(resultContent);

    // analyze_all result
    if (parsed.path && parsed.fileStats) {
      const compact: Record<string, unknown> = {
        path: parsed.path,
        totalFiles: parsed.totalFiles,
        fileStats: parsed.fileStats,
        analysesRun: parsed.analysesRun,
        successful: parsed.successful,
        failed: parsed.failed,
      };

      // Extract issue summaries (compact)
      if (parsed.issuesSummary?.length > 0) {
        compact.issues = parsed.issuesSummary.map((is: { tool: string; issues: string[] }) => ({
          tool: is.tool,
          issues: is.issues.slice(0, 5),
        }));
      }

      // Extract per-tool summaries (key metrics only)
      if (parsed.details?.length > 0) {
        compact.analyses = parsed.details.map((d: { tool: string; summary: Record<string, unknown> }) => {
          const s = d.summary;
          const brief: Record<string, unknown> = { tool: d.tool };

          // Extract numeric/small fields only
          for (const [k, v] of Object.entries(s)) {
            if (typeof v === "number" || typeof v === "boolean") {
              brief[k] = v;
            } else if (typeof v === "string" && v.length < 100) {
              brief[k] = v;
            }
            // Skip arrays/objects (raw data) to save space
          }

          // Include issues from samples (java_analyze etc.)
          if (Array.isArray((s as any).samples)) {
            const allIssues: unknown[] = [];
            for (const sample of (s as any).samples) {
              if (Array.isArray(sample.result?.issues)) {
                allIssues.push(...sample.result.issues.slice(0, 3));
              }
            }
            if (allIssues.length > 0) {
              brief.issues = allIssues.slice(0, 10);
            }
          }

          return brief;
        });
      }

      if (parsed.errors?.length > 0) {
        compact.errors = parsed.errors;
      }

      const result = JSON.stringify(compact, null, 1);
      return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
    }

    // java_analyze or other single-file results
    if (parsed.file || parsed.filepath || parsed.classes || parsed.functions) {
      const result = JSON.stringify(parsed, null, 1);
      return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
    }

    // Generic: just truncate
    const result = JSON.stringify(parsed, null, 1);
    return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
  } catch {
    // Not valid JSON, return truncated raw text
    return resultContent.length > maxChars ? resultContent.slice(0, maxChars) + "..." : resultContent;
  }
}

// ─── Main processing functions ───

export async function processMessage(
  userMessage: string,
  history: ChatMessage[],
  client: OllamaClient,
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
      { role: "system", content: BASE_SYSTEM_PROMPT },
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
  // Try intent router first
  const intent = await detectAndExecuteIntent(userMessage, (event) => {
    // Events are yielded by the caller, we collect them via callback
    // But generators can't yield from callbacks, so we handle this differently
  });

  if (intent.handled) {
    // Emit the tool events that happened during intent detection
    if (intent.toolName) {
      yield {
        type: "tool_use",
        tool: intent.toolName,
        status: "start",
        args: intent.toolArgs,
      };

      yield {
        type: "tool_result",
        tool: intent.toolName,
        status: intent.toolResult?.success ? "complete" : "error",
        result: intent.toolResult,
      };
    }

    if (intent.summaryPrompt) {
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
        return;
      }

      yield { type: "thinking" };

      // Stream the LLM summary (no tools = streaming mode in ollama client)
      const summaryMessages: ChatMessage[] = [
        { role: "system", content: BASE_SYSTEM_PROMPT },
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
