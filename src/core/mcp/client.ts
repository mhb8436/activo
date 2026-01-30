import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPServerConfig } from "../config.js";
import { Tool, ToolResult } from "../tools/types.js";

export interface MCPConnection {
  id: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
}

export class MCPManager {
  private connections: Map<string, MCPConnection> = new Map();

  async connect(id: string, config: MCPServerConfig): Promise<MCPConnection> {
    // Check if already connected
    if (this.connections.has(id)) {
      return this.connections.get(id)!;
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    const client = new Client({
      name: "activo",
      version: "0.2.0",
    });

    await client.connect(transport);

    // Get available tools
    const toolsResult = await client.listTools();
    const tools: Tool[] = toolsResult.tools.map((t) => ({
      name: `mcp_${id}_${t.name}`,
      description: t.description || `MCP tool: ${t.name}`,
      parameters: {
        type: "object" as const,
        properties: (t.inputSchema as any)?.properties || {},
        required: (t.inputSchema as any)?.required,
      },
      handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
        return this.callTool(id, t.name, args);
      },
    }));

    const connection: MCPConnection = {
      id,
      client,
      transport,
      tools,
    };

    this.connections.set(id, connection);
    return connection;
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (connection) {
      await connection.client.close();
      this.connections.delete(id);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.connections.keys()) {
      await this.disconnect(id);
    }
  }

  async callTool(connectionId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return {
        success: false,
        content: "",
        error: `MCP connection not found: ${connectionId}`,
      };
    }

    try {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: args,
      });

      if (result.isError) {
        return {
          success: false,
          content: "",
          error: JSON.stringify(result.content),
        };
      }

      const contentArray = result.content as Array<{ type: string; text?: string }>;
      const content = contentArray
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n");

      return {
        success: true,
        content,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: String(error),
      };
    }
  }

  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const connection of this.connections.values()) {
      tools.push(...connection.tools);
    }
    return tools;
  }

  getConnection(id: string): MCPConnection | undefined {
    return this.connections.get(id);
  }

  isConnected(id: string): boolean {
    return this.connections.has(id);
  }
}

// Singleton instance
let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}
