import { Tool, ToolCall, ToolResult } from "./types.js";
import { builtInTools } from "./builtIn.js";
import { standardsTools } from "./standards.js";
import { cacheTools } from "./cache.js";
import { astTools } from "./ast.js";
import { embeddingTools } from "./embeddings.js";
import { memoryTools } from "./memory.js";
import { javaTools } from "./javaAst.js";
import { frontendTools } from "./frontendAst.js";
import { sqlTools } from "./sqlAnalysis.js";
import { mybatisTools } from "./mybatisAnalysis.js";
import { cssTools } from "./cssAnalysis.js";
import { htmlTools } from "./htmlAnalysis.js";
import { dependencyTools } from "./dependencyAnalysis.js";
import { openapiTools } from "./openapiAnalysis.js";
import { pythonTools } from "./pythonAnalysis.js";

export * from "./types.js";
export * from "./builtIn.js";
export * from "./standards.js";
export * from "./cache.js";
export * from "./ast.js";
export * from "./embeddings.js";
export * from "./memory.js";
export * from "./javaAst.js";
export * from "./frontendAst.js";
export * from "./sqlAnalysis.js";
export * from "./mybatisAnalysis.js";
export * from "./cssAnalysis.js";
export * from "./htmlAnalysis.js";
export * from "./dependencyAnalysis.js";
export * from "./openapiAnalysis.js";
export * from "./pythonAnalysis.js";

// All available tools
export function getAllTools(): Tool[] {
  return [...builtInTools, ...standardsTools, ...cacheTools, ...astTools, ...embeddingTools, ...memoryTools, ...javaTools, ...frontendTools, ...sqlTools, ...mybatisTools, ...cssTools, ...htmlTools, ...dependencyTools, ...openapiTools, ...pythonTools];
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
