import { getMCPManager } from "./client.js";
import { Config } from "../config.js";
import { logMCP } from "./logger.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Initialize all configured MCP servers with retry logic.
 * Non-fatal: logs errors and continues with other servers.
 * Retries up to 3 times per server with 2s delay between attempts.
 */
export async function initMCPServers(config: Config): Promise<void> {
  const servers = config.mcp?.servers;
  if (!servers || Object.keys(servers).length === 0) {
    return;
  }

  const manager = getMCPManager();

  for (const [id, serverConfig] of Object.entries(servers)) {
    let connected = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await manager.connect(id, serverConfig);
        logMCP({ level: "info", server_id: id, event: "connected", message: `Connected (attempt ${attempt})` });
        console.error(`[MCP] Connected: ${id}`);
        connected = true;
        break;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logMCP({ level: "warn", server_id: id, event: "retry", message: `Attempt ${attempt}/${MAX_RETRIES} failed: ${errorMsg}` });
        console.error(`[MCP] Attempt ${attempt}/${MAX_RETRIES} for '${id}' failed: ${errorMsg}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    if (!connected) {
      logMCP({ level: "error", server_id: id, event: "failed", message: `All ${MAX_RETRIES} attempts failed` });
      console.error(`[MCP] Failed to connect '${id}' after ${MAX_RETRIES} attempts`);
    }
  }
}

/**
 * Shutdown all MCP server connections.
 */
export async function shutdownMCPServers(): Promise<void> {
  try {
    await getMCPManager().disconnectAll();
  } catch {
    // Ignore shutdown errors
  }
}
