/**
 * MCP 구조화된 로거 — .activo/mcp.log에 JSON 라인 기록
 */
import fs from "fs";
import path from "path";

export interface MCPLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  server_id: string;
  event: string;
  message: string;
  details?: unknown;
}

const LOG_DIR = ".activo";
const LOG_FILE = "mcp.log";
const MAX_LOG_SIZE = 1 * 1024 * 1024; // 1MB
const KEEP_LINES = 500;

function getLogPath(): string {
  return path.join(process.cwd(), LOG_DIR, LOG_FILE);
}

/**
 * Append a structured log entry to .activo/mcp.log.
 * Auto-rotates when file exceeds 1MB (keeps last 500 lines).
 */
export function logMCP(entry: Omit<MCPLogEntry, "timestamp">): void {
  try {
    const logPath = getLogPath();
    const dir = path.dirname(logPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check file size and rotate if needed
    if (fs.existsSync(logPath)) {
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > MAX_LOG_SIZE) {
          const content = fs.readFileSync(logPath, "utf-8");
          const lines = content.split("\n").filter(Boolean);
          const kept = lines.slice(-KEEP_LINES).join("\n") + "\n";
          fs.writeFileSync(logPath, kept, "utf-8");
        }
      } catch {
        // Ignore rotation errors
      }
    }

    const fullEntry: MCPLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    fs.appendFileSync(logPath, JSON.stringify(fullEntry) + "\n", "utf-8");
  } catch {
    // Logging should never crash the application
  }
}
