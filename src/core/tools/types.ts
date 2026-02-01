export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    required?: string[];
    properties: Record<string, ToolParameter>;
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export interface ToolEvent {
  type: "tool_use";
  tool: string;
  status: "start" | "complete" | "error";
  args?: Record<string, unknown>;
  result?: ToolResult;
}
