import fs from "fs";
import path from "path";
import { ChatMessage, OllamaClient } from "./llm/ollama.js";

// Conversation storage directory
const CONVERSATION_DIR = ".activo/conversations";

// Session data interface
interface SessionData {
  id: string;
  startedAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  summary?: string;
}

// Get conversation directory path
function getConversationDir(): string {
  return path.resolve(process.cwd(), CONVERSATION_DIR);
}

// Ensure conversation directory exists
function ensureConversationDir(): void {
  const dir = getConversationDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Generate session ID
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Get session file path
function getSessionPath(sessionId: string): string {
  return path.join(getConversationDir(), `${sessionId}.json`);
}

// Get latest session file
function getLatestSessionPath(): string | null {
  const dir = getConversationDir();
  if (!fs.existsSync(dir)) {
    return null;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("session_") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  return path.join(dir, files[0]);
}

// Load session data
export function loadSession(sessionId: string): SessionData | null {
  const sessionPath = getSessionPath(sessionId);
  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
  } catch {
    return null;
  }
}

// Load latest session
export function loadLatestSession(): SessionData | null {
  const latestPath = getLatestSessionPath();
  if (!latestPath) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(latestPath, "utf-8"));
  } catch {
    return null;
  }
}

// Save session data
export function saveSession(session: SessionData): void {
  ensureConversationDir();
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(getSessionPath(session.id), JSON.stringify(session, null, 2));
}

// Create new session
export function createSession(): SessionData {
  return {
    id: generateSessionId(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

// Add message to session
export function addMessageToSession(session: SessionData, message: ChatMessage): void {
  session.messages.push(message);
  saveSession(session);
}

// Summarize old messages using LLM
async function summarizeMessages(
  messages: ChatMessage[],
  client: OllamaClient
): Promise<string> {
  if (messages.length === 0) {
    return "";
  }

  // Format messages for summarization
  const conversationText = messages
    .filter(m => m.role !== "system" && m.role !== "tool")
    .map(m => {
      if (m.role === "user") {
        return `사용자: ${m.content}`;
      } else if (m.role === "assistant") {
        const toolInfo = m.toolCalls?.length
          ? ` [도구 호출: ${m.toolCalls.map(t => t.name).join(", ")}]`
          : "";
        return `어시스턴트: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}${toolInfo}`;
      }
      return "";
    })
    .filter(s => s)
    .join("\n");

  const summaryPrompt = `다음 대화를 3-5개의 핵심 포인트로 요약해주세요. 한국어로 작성하고, 각 포인트는 한 줄로 작성하세요.

대화:
${conversationText}

요약 (핵심 포인트만):`;

  try {
    const response = await client.chat([
      { role: "user", content: summaryPrompt }
    ]);
    return response.content.trim();
  } catch (error) {
    // Fallback: simple extraction
    const userMessages = messages
      .filter(m => m.role === "user")
      .map(m => m.content.slice(0, 50))
      .slice(-3);
    return `이전 요청: ${userMessages.join(", ")}`;
  }
}

// Get context for new session (hybrid approach)
export async function getSessionContext(
  client: OllamaClient,
  recentCount: number = 5
): Promise<{ summary: string; recentMessages: ChatMessage[] }> {
  const latestSession = loadLatestSession();

  if (!latestSession || latestSession.messages.length === 0) {
    return { summary: "", recentMessages: [] };
  }

  const allMessages = latestSession.messages;

  // Filter out system messages for context
  const contextMessages = allMessages.filter(m => m.role !== "system");

  if (contextMessages.length <= recentCount) {
    // Not enough messages to summarize, return all as recent
    return {
      summary: latestSession.summary || "",
      recentMessages: contextMessages
    };
  }

  // Split: old messages for summary, recent messages to keep
  const oldMessages = contextMessages.slice(0, -recentCount);
  const recentMessages = contextMessages.slice(-recentCount);

  // Generate or use existing summary
  let summary = latestSession.summary || "";

  if (oldMessages.length > 0 && !summary) {
    summary = await summarizeMessages(oldMessages, client);
    // Save summary back to session
    latestSession.summary = summary;
    saveSession(latestSession);
  }

  return { summary, recentMessages };
}

// Build context string for system prompt
export function buildContextPrompt(summary: string): string {
  if (!summary) {
    return "";
  }

  return `
## 이전 대화 컨텍스트

${summary}

---
위 내용은 이전 세션에서의 대화 요약입니다. 필요시 참고하세요.
`;
}

// Clean old sessions (keep only last N)
export function cleanOldSessions(keepCount: number = 10): void {
  const dir = getConversationDir();
  if (!fs.existsSync(dir)) {
    return;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("session_") && f.endsWith(".json"))
    .sort()
    .reverse();

  // Delete old sessions beyond keepCount
  for (let i = keepCount; i < files.length; i++) {
    try {
      fs.unlinkSync(path.join(dir, files[i]));
    } catch {
      // Ignore deletion errors
    }
  }
}
