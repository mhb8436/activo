import { OllamaConfig } from "../config.js";
import { Tool, ToolCall } from "../tools/types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface StreamEvent {
  type: "content" | "tool_call" | "done" | "error";
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private contextLength: number;
  private keepAlive: number;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.contextLength = config.contextLength;
    this.keepAlive = config.keepAlive;
  }

  async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) throw new Error("Failed to list models");
    const data = (await response.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  }

  async chat(
    messages: ChatMessage[],
    tools?: Tool[]
  ): Promise<ChatMessage> {
    const ollamaMessages = this.convertMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: {
        num_ctx: this.contextLength,
      },
      keep_alive: this.keepAlive,
    };

    // Always add tools if provided (needed for multi-turn tool use)
    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${error}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return this.parseResponse(data);
  }

  async *streamChat(
    messages: ChatMessage[],
    tools?: Tool[],
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    const ollamaMessages = this.convertMessages(messages);

    // Use non-streaming mode when tools are provided to avoid hallucination
    // (LLM often outputs fake results before tool calls in streaming mode)
    const useStreaming = !tools?.length;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: useStreaming,
      options: {
        num_ctx: this.contextLength,
      },
      keep_alive: this.keepAlive,
    };

    // Always add tools if provided (needed for multi-turn tool use)
    if (tools?.length) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: "error", error: `Ollama error: ${error}` };
      return;
    }

    // Non-streaming mode for tool calls (avoids hallucination where LLM outputs text before calling tools)
    if (!useStreaming) {
      const data = (await response.json()) as OllamaChatResponse;

      // Handle tool calls first (ignore content when tools are called)
      if (data.message?.tool_calls?.length) {
        for (const tc of data.message.tool_calls) {
          const toolCall: ToolCall = {
            id: `tc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name: tc.function.name,
            arguments: tc.function.arguments,
          };
          yield { type: "tool_call", toolCall };
        }
      } else if (data.message?.content) {
        // Only yield content if no tool calls
        yield { type: "content", content: data.message.content };
      }

      yield { type: "done" };
      return;
    }

    // Streaming mode (no tools)
    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: "error", error: "No response body" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line) as OllamaChatResponse;

          if (data.message?.content) {
            yield { type: "content", content: data.message.content };
          }

          if (data.done) {
            yield { type: "done" };
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  private convertMessages(messages: ChatMessage[]): Array<{
    role: string;
    content: string;
  }> {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool",
          content: msg.content,
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  private parseResponse(data: OllamaChatResponse): ChatMessage {
    const result: ChatMessage = {
      role: "assistant",
      content: data.message.content || "",
    };

    if (data.message.tool_calls?.length) {
      result.toolCalls = data.message.tool_calls.map((tc, idx) => ({
        id: `tc_${Date.now()}_${idx}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }

    return result;
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  // Generate embeddings for text
  async embed(text: string, model?: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || "nomic-embed-text",
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding error: ${error}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  // Generate embeddings for multiple texts (batch)
  async embedBatch(texts: string[], model?: string): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text, model);
      embeddings.push(embedding);
    }
    return embeddings;
  }
}
