import { Tool, ToolCall, ToolResult } from "./types.js";
import { builtInTools } from "./builtIn.js";
import { standardsTools } from "./standards.js";

export * from "./types.js";
export * from "./builtIn.js";
export * from "./standards.js";

// All available tools
export function getAllTools(): Tool[] {
  return [...builtInTools, ...standardsTools];
}

// Get tool by name
export function getTool(name: string): Tool | undefined {
  return getAllTools().find((t) => t.name === name);
}

// Execute a tool call
export async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const tool = getTool(toolCall.name);

  if (!tool) {
    return {
      success: false,
      content: "",
      error: `Unknown tool: ${toolCall.name}`,
    };
  }

  try {
    return await tool.handler(toolCall.arguments);
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Tool execution error: ${error}`,
    };
  }
}

// Get tool definitions for LLM
export function getToolDefinitions(): Array<{
  name: string;
  description: string;
  parameters: Tool["parameters"];
}> {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
