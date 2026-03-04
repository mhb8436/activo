import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "../tools/types.js";
import type { ChatMessage, StreamEvent, LLMClient } from "./types.js";

interface AnthropicClientConfig {
  apiKey?: string;
  model: string;
  maxTokens: number;
  timeout?: number; // per-request timeout in ms (default: 120000)
}

// Convert activo Tool format to Anthropic tool format
function convertTools(
  tools: Tool[]
): Anthropic.Messages.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: (tool.parameters || { type: "object", properties: {} }) as Anthropic.Messages.Tool.InputSchema,
  }));
}

// Convert ChatMessage[] to Anthropic message params
function convertMessages(messages: ChatMessage[]): {
  system: string | undefined;
  anthropicMessages: Anthropic.Messages.MessageParam[];
} {
  let system: string | undefined;
  const anthropicMessages: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = msg.content;
      continue;
    }

    if (msg.role === "user") {
      anthropicMessages.push({
        role: "user",
        content: msg.content,
      });
      continue;
    }

    if (msg.role === "assistant") {
      const content: Anthropic.Messages.ContentBlockParam[] = [];

      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }

      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
      }

      if (content.length > 0) {
        anthropicMessages.push({ role: "assistant", content });
      }
      continue;
    }

    if (msg.role === "tool") {
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId || "",
            content: msg.content,
          },
        ],
      });
      continue;
    }
  }

  return { system, anthropicMessages };
}

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private timeout: number;

  constructor(config: AnthropicClientConfig) {
    this.timeout = config.timeout || 120000; // 2 min default
    // SDK auto-reads ANTHROPIC_API_KEY from env if apiKey not provided
    this.client = new Anthropic({
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      timeout: this.timeout,
    });
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async isConnected(): Promise<boolean> {
    try {
      // Check if API key exists (don't make a billing API call)
      const apiKey =
        (this.client as any).apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return false;

      // Validate key format (sk-ant-api03-...)
      if (!apiKey.startsWith("sk-ant-")) return false;

      return true;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], tools?: Tool[]): Promise<ChatMessage> {
    const { system, anthropicMessages } = convertMessages(messages);

    const params: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: anthropicMessages,
    };

    if (system) {
      params.system = system;
    }

    if (tools?.length) {
      params.tools = convertTools(tools);
    }

    const response = await this.client.messages.create(params);
    return this.parseResponse(response);
  }

  async *streamChat(
    messages: ChatMessage[],
    tools?: Tool[],
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent> {
    const { system, anthropicMessages } = convertMessages(messages);

    const params: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: anthropicMessages,
      stream: true,
    };

    if (system) {
      params.system = system;
    }

    if (tools?.length) {
      params.tools = convertTools(tools);
    }

    try {
      const stream = this.client.messages.stream({
        ...params,
        stream: undefined, // stream() handles this
      } as Anthropic.Messages.MessageCreateParamsNonStreaming);

      // Track tool use blocks being built
      let currentToolId = "";
      let currentToolName = "";
      let currentToolInput = "";

      for await (const event of stream) {
        if (abortSignal?.aborted) {
          stream.abort();
          yield { type: "error", error: "Operation cancelled" };
          return;
        }

        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInput = "";
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "content", content: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolName) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(currentToolInput || "{}");
            } catch {
              // Invalid JSON, use empty object
            }
            yield {
              type: "tool_call",
              toolCall: {
                id: currentToolId,
                name: currentToolName,
                arguments: args,
              },
            };
            currentToolId = "";
            currentToolName = "";
            currentToolInput = "";
          }
        } else if (event.type === "message_stop") {
          yield { type: "done" };
        }
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        yield { type: "error", error: "Operation cancelled" };
      } else {
        yield {
          type: "error",
          error: `Anthropic error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getProvider(): "ollama" | "anthropic" {
    return "anthropic";
  }

  private parseResponse(response: Anthropic.Messages.Message): ChatMessage {
    const result: ChatMessage = {
      role: "assistant",
      content: "",
    };

    const textParts: string[] = [];
    const toolCalls: ChatMessage["toolCalls"] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    result.content = textParts.join("");

    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    return result;
  }
}
