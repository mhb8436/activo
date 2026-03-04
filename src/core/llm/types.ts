import type { ToolCall, Tool } from "../tools/types.js";

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

export interface LLMClient {
  chat(messages: ChatMessage[], tools?: Tool[]): Promise<ChatMessage>;
  streamChat(
    messages: ChatMessage[],
    tools?: Tool[],
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent>;
  isConnected(): Promise<boolean>;
  getModel(): string;
  setModel(model: string): void;
  getProvider(): "ollama" | "anthropic";
}
