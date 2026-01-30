import { loadConfig } from "../../cli/commands/config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      required?: string[];
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
    };
  };
}

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
  stream?: boolean;
  tools?: Tool[];
}

export interface OllamaChatResponse {
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

  constructor(options: OllamaOptions = {}) {
    const config = loadConfig();
    this.baseUrl = options.baseUrl || config.ollama.baseUrl;
    this.model = options.model || config.ollama.model;
  }

  async chat(
    messages: ChatMessage[],
    options: { tools?: Tool[]; stream?: boolean } = {}
  ): Promise<ChatMessage> {
    const ollamaMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: options.stream ?? false,
    };

    // Add tools if the last message is from user
    if (options.tools?.length && messages[messages.length - 1]?.role === "user") {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
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

    const result: ChatMessage = {
      role: "assistant",
      content: data.message.content,
    };

    // Handle tool calls
    if (data.message.tool_calls?.length) {
      result.toolCalls = data.message.tool_calls.map((tc, idx) => ({
        id: `call_${idx}`,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments),
        },
      }));
    }

    return result;
  }

  async *streamChat(
    messages: ChatMessage[],
    options: { tools?: Tool[] } = {}
  ): AsyncGenerator<string> {
    const ollamaMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: true,
    };

    if (options.tools?.length && messages[messages.length - 1]?.role === "user") {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
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

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line) as OllamaChatResponse;
            if (data.message?.content) {
              yield data.message.content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
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
    if (!response.ok) {
      throw new Error("Failed to list models");
    }
    const data = (await response.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  }
}
