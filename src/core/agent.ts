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

IMPORTANT: You MUST call tools immediately. Do NOT say "I will do X" or "Let me do X" - just DO IT by calling the tool.

## Available Tools

### 통합 분석 (가장 권장)
- analyze_all: 디렉토리 전체 자동 분석 (Java, MyBatis, SQL, JS, CSS, HTML 등)

### 기본 도구
- read_file, write_file, list_directory, grep_search, glob_search, run_command

### Java/Spring 분석
- java_analyze: Java 파일 AST 분석 (클래스, 메서드, 어노테이션)
- java_complexity: Java 복잡도 리포트
- spring_check: Spring 패턴 검사
- sql_check: Java 내 SQL 쿼리 분석
- mybatis_check: MyBatis XML 분석 (SQL Injection 검출)

### 프론트엔드 분석
- ast_analyze: TypeScript/JavaScript AST 분석
- react_check, vue_check, jquery_check: 프론트엔드 프레임워크 분석
- css_check: CSS/SCSS 분석
- html_check: HTML/JSP 접근성/SEO 분석

### 기타
- dependency_check: package.json, pom.xml 취약점 검사
- openapi_check: OpenAPI/Swagger 스펙 분석
- python_check: Python/Django/Flask 분석

## 사용 규칙

1. 사용자가 "분석해줘", "검사해줘" 라고 하면 → 바로 analyze_all 또는 해당 도구 호출
2. 질문하지 말고 바로 실행. "어떤 폴더요?" 묻지 말고 현재 디렉토리(.) 사용
3. 도구 실행 후 결과를 요약해서 설명
4. 한국어로 요청하면 한국어로 응답

## 예시

User: "자바 파일 분석해줘"
→ 바로 java_analyze 또는 analyze_all 호출 (질문하지 않음)

User: "이 디렉토리 코드 품질 검사"
→ 바로 analyze_all 호출 with path="."

User: "MyBatis 분석"
→ 바로 mybatis_check 호출`;

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
