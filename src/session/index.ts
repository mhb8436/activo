import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { ChatMessage } from "../core/llm/ollama.js";

export interface Session {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
  history: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

function getSessionDir(): string {
  const sessionDir = path.join(os.homedir(), ".activo", "sessions");

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  return sessionDir;
}

export function createSession(history: ChatMessage[] = []): Session {
  const session: Session = {
    sessionId: uuidv4(),
    title: "New Session",
    workspaceDirectory: process.cwd(),
    history,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return session;
}

export function saveSession(session: Session): void {
  const sessionDir = getSessionDir();
  const sessionPath = path.join(sessionDir, `${session.sessionId}.json`);

  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

export function loadSession(sessionId: string): Session | null {
  const sessionDir = getSessionDir();
  const sessionPath = path.join(sessionDir, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(sessionPath, "utf-8");
    return JSON.parse(data) as Session;
  } catch {
    return null;
  }
}

export function loadLastSession(): Session | null {
  const sessionDir = getSessionDir();

  if (!fs.existsSync(sessionDir)) {
    return null;
  }

  const files = fs
    .readdirSync(sessionDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      path: path.join(sessionDir, f),
      mtime: fs.statSync(path.join(sessionDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (files.length === 0) {
    return null;
  }

  try {
    const data = fs.readFileSync(files[0].path, "utf-8");
    return JSON.parse(data) as Session;
  } catch {
    return null;
  }
}

export function listSessions(limit: number = 20): Array<{
  sessionId: string;
  title: string;
  updatedAt: string;
  preview: string;
}> {
  const sessionDir = getSessionDir();

  if (!fs.existsSync(sessionDir)) {
    return [];
  }

  const files = fs
    .readdirSync(sessionDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      path: path.join(sessionDir, f),
      mtime: fs.statSync(path.join(sessionDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, limit);

  return files.map((f) => {
    try {
      const data = JSON.parse(fs.readFileSync(f.path, "utf-8")) as Session;
      const firstUserMessage = data.history.find((m) => m.role === "user");
      const preview = firstUserMessage?.content.slice(0, 50) || "(empty)";

      return {
        sessionId: data.sessionId,
        title: data.title,
        updatedAt: data.updatedAt,
        preview: preview + (preview.length >= 50 ? "..." : ""),
      };
    } catch {
      return {
        sessionId: f.name.replace(".json", ""),
        title: "Unknown",
        updatedAt: f.mtime.toISOString(),
        preview: "(error loading)",
      };
    }
  });
}

export function updateSessionTitle(session: Session, title: string): void {
  session.title = title;
  saveSession(session);
}
