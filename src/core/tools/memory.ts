import fs from "fs";
import path from "path";
import { Tool, ToolResult } from "./types.js";

// Memory directory
const MEMORY_DIR = ".activo/memory";

// Project context interface
interface ProjectContext {
  name: string;
  rootPath: string;
  description?: string;
  techStack: string[];
  keyFiles: Array<{
    path: string;
    description: string;
  }>;
  conventions: string[];
  lastUpdated: string;
}

// Conversation summary interface
interface ConversationSummary {
  id: string;
  date: string;
  topics: string[];
  keyFindings: string[];
  decisions: string[];
  todos: string[];
}

// Memory store interface
interface MemoryStore {
  version: string;
  project: ProjectContext;
  conversations: ConversationSummary[];
  notes: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
    createdAt: string;
  }>;
  facts: Array<{
    key: string;
    value: string;
    source: string;
    createdAt: string;
  }>;
}

// Get memory directory path
function getMemoryDir(): string {
  return path.resolve(process.cwd(), MEMORY_DIR);
}

// Get memory file path
function getMemoryPath(): string {
  return path.join(getMemoryDir(), "store.json");
}

// Ensure memory directory exists
function ensureMemoryDir(): void {
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Load memory store
function loadMemory(): MemoryStore {
  const memoryPath = getMemoryPath();
  if (fs.existsSync(memoryPath)) {
    try {
      return JSON.parse(fs.readFileSync(memoryPath, "utf-8"));
    } catch {
      return createDefaultMemory();
    }
  }
  return createDefaultMemory();
}

// Create default memory
function createDefaultMemory(): MemoryStore {
  return {
    version: "1.0",
    project: {
      name: path.basename(process.cwd()),
      rootPath: process.cwd(),
      techStack: [],
      keyFiles: [],
      conventions: [],
      lastUpdated: new Date().toISOString(),
    },
    conversations: [],
    notes: [],
    facts: [],
  };
}

// Save memory store
function saveMemory(memory: MemoryStore): void {
  ensureMemoryDir();
  fs.writeFileSync(getMemoryPath(), JSON.stringify(memory, null, 2));
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Initialize/Update Project Context Tool
export const initProjectTool: Tool = {
  name: "init_project_memory",
  description: "Initialize or update project context in memory (프로젝트 컨텍스트 초기화). Stores project info like tech stack, key files. Use when user asks: 'remember project', 'init memory', '프로젝트 기억', '컨텍스트 저장'.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Project description",
      },
      techStack: {
        type: "string",
        description: "Comma-separated tech stack (e.g., 'TypeScript, React, Node.js')",
      },
      conventions: {
        type: "string",
        description: "Comma-separated coding conventions",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const memory = loadMemory();

      if (args.description) {
        memory.project.description = args.description as string;
      }

      if (args.techStack) {
        memory.project.techStack = (args.techStack as string)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
      }

      if (args.conventions) {
        memory.project.conventions = (args.conventions as string)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
      }

      memory.project.lastUpdated = new Date().toISOString();
      saveMemory(memory);

      const lines: string[] = [];
      lines.push("=== 프로젝트 컨텍스트 저장됨 ===");
      lines.push("");
      lines.push(`📁 프로젝트: ${memory.project.name}`);
      if (memory.project.description) {
        lines.push(`📝 설명: ${memory.project.description}`);
      }
      if (memory.project.techStack.length > 0) {
        lines.push(`🛠️ 기술 스택: ${memory.project.techStack.join(", ")}`);
      }
      if (memory.project.conventions.length > 0) {
        lines.push(`📋 컨벤션: ${memory.project.conventions.join(", ")}`);
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Add Key File Tool
export const addKeyFileTool: Tool = {
  name: "add_key_file",
  description: "Mark a file as important with description (중요 파일 등록). Use when user asks: 'remember this file', 'mark as important', '이 파일 기억', '중요 파일'.",
  parameters: {
    type: "object",
    required: ["filepath", "description"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to the file",
      },
      description: {
        type: "string",
        description: "What this file does / why it's important",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = args.filepath as string;
      const description = args.description as string;

      const memory = loadMemory();

      // Remove if already exists
      memory.project.keyFiles = memory.project.keyFiles.filter(
        (f) => f.path !== filepath
      );

      // Add new
      memory.project.keyFiles.push({ path: filepath, description });
      memory.project.lastUpdated = new Date().toISOString();
      saveMemory(memory);

      return {
        success: true,
        content: `✅ 중요 파일 등록됨: ${filepath}\n   설명: ${description}`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Add Note Tool
export const addNoteTool: Tool = {
  name: "add_note",
  description: "Save a note/finding about the codebase (노트 저장). Use when user asks: 'remember this', 'save note', 'note that', '기억해', '메모해', '노트'.",
  parameters: {
    type: "object",
    required: ["title", "content"],
    properties: {
      title: {
        type: "string",
        description: "Note title",
      },
      content: {
        type: "string",
        description: "Note content",
      },
      tags: {
        type: "string",
        description: "Comma-separated tags",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const title = args.title as string;
      const content = args.content as string;
      const tags = args.tags
        ? (args.tags as string).split(",").map((t) => t.trim())
        : [];

      const memory = loadMemory();
      memory.notes.push({
        id: generateId(),
        title,
        content,
        tags,
        createdAt: new Date().toISOString(),
      });
      saveMemory(memory);

      return {
        success: true,
        content: `✅ 노트 저장됨: "${title}"\n   태그: ${tags.length > 0 ? tags.join(", ") : "(없음)"}`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Add Fact Tool
export const addFactTool: Tool = {
  name: "add_fact",
  description: "Store a fact about the codebase (사실 저장). Key-value pairs like 'main entry point = src/index.ts'. Use when user asks: 'remember that X is Y', '기억해', 'store fact'.",
  parameters: {
    type: "object",
    required: ["key", "value"],
    properties: {
      key: {
        type: "string",
        description: "Fact key/name",
      },
      value: {
        type: "string",
        description: "Fact value",
      },
      source: {
        type: "string",
        description: "Where this fact came from (file, conversation, etc.)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const key = args.key as string;
      const value = args.value as string;
      const source = (args.source as string) || "user";

      const memory = loadMemory();

      // Update if exists, otherwise add
      const existingIdx = memory.facts.findIndex((f) => f.key === key);
      if (existingIdx >= 0) {
        memory.facts[existingIdx] = {
          key,
          value,
          source,
          createdAt: new Date().toISOString(),
        };
      } else {
        memory.facts.push({
          key,
          value,
          source,
          createdAt: new Date().toISOString(),
        });
      }
      saveMemory(memory);

      return {
        success: true,
        content: `✅ 사실 저장됨: ${key} = ${value}`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Save Conversation Summary Tool
export const saveConversationTool: Tool = {
  name: "save_conversation",
  description: "Save a summary of the current conversation (대화 요약 저장). Use at end of session or when switching topics. Use when user asks: 'save session', 'remember conversation', '대화 저장', '세션 저장'.",
  parameters: {
    type: "object",
    required: ["topics", "keyFindings"],
    properties: {
      topics: {
        type: "string",
        description: "Comma-separated topics discussed",
      },
      keyFindings: {
        type: "string",
        description: "Comma-separated key findings or insights",
      },
      decisions: {
        type: "string",
        description: "Comma-separated decisions made",
      },
      todos: {
        type: "string",
        description: "Comma-separated todo items",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const topics = (args.topics as string).split(",").map((t) => t.trim());
      const keyFindings = (args.keyFindings as string).split(",").map((t) => t.trim());
      const decisions = args.decisions
        ? (args.decisions as string).split(",").map((t) => t.trim())
        : [];
      const todos = args.todos
        ? (args.todos as string).split(",").map((t) => t.trim())
        : [];

      const memory = loadMemory();
      memory.conversations.push({
        id: generateId(),
        date: new Date().toISOString(),
        topics,
        keyFindings,
        decisions,
        todos,
      });

      // Keep only last 20 conversations
      if (memory.conversations.length > 20) {
        memory.conversations = memory.conversations.slice(-20);
      }

      saveMemory(memory);

      return {
        success: true,
        content: `✅ 대화 요약 저장됨\n   주제: ${topics.join(", ")}\n   발견: ${keyFindings.length}개\n   결정: ${decisions.length}개\n   TODO: ${todos.length}개`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Get Project Context Tool
export const getContextTool: Tool = {
  name: "get_project_context",
  description: "Get stored project context and memory (프로젝트 컨텍스트 조회). Returns project info, key files, notes, facts. Use when starting session or user asks: 'what do you remember', 'project context', '기억하는거', '컨텍스트'.",
  parameters: {
    type: "object",
    properties: {
      section: {
        type: "string",
        description: "Specific section: 'project', 'files', 'notes', 'facts', 'conversations', or 'all'",
        enum: ["project", "files", "notes", "facts", "conversations", "all"],
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const section = (args.section as string) || "all";
      const memory = loadMemory();

      const lines: string[] = [];

      if (section === "all" || section === "project") {
        lines.push("=== 프로젝트 컨텍스트 ===");
        lines.push(`📁 이름: ${memory.project.name}`);
        if (memory.project.description) {
          lines.push(`📝 설명: ${memory.project.description}`);
        }
        if (memory.project.techStack.length > 0) {
          lines.push(`🛠️ 기술: ${memory.project.techStack.join(", ")}`);
        }
        if (memory.project.conventions.length > 0) {
          lines.push(`📋 컨벤션: ${memory.project.conventions.join(", ")}`);
        }
        lines.push(`🕐 갱신: ${memory.project.lastUpdated.slice(0, 10)}`);
        lines.push("");
      }

      if (section === "all" || section === "files") {
        if (memory.project.keyFiles.length > 0) {
          lines.push("=== 중요 파일 ===");
          for (const file of memory.project.keyFiles) {
            lines.push(`📄 ${file.path}`);
            lines.push(`   ${file.description}`);
          }
          lines.push("");
        }
      }

      if (section === "all" || section === "notes") {
        if (memory.notes.length > 0) {
          lines.push("=== 노트 ===");
          for (const note of memory.notes.slice(-5)) {
            lines.push(`📌 ${note.title}`);
            lines.push(`   ${note.content.slice(0, 100)}${note.content.length > 100 ? "..." : ""}`);
            if (note.tags.length > 0) {
              lines.push(`   태그: ${note.tags.join(", ")}`);
            }
          }
          if (memory.notes.length > 5) {
            lines.push(`   ... 외 ${memory.notes.length - 5}개`);
          }
          lines.push("");
        }
      }

      if (section === "all" || section === "facts") {
        if (memory.facts.length > 0) {
          lines.push("=== 저장된 사실 ===");
          for (const fact of memory.facts) {
            lines.push(`💡 ${fact.key}: ${fact.value}`);
          }
          lines.push("");
        }
      }

      if (section === "all" || section === "conversations") {
        if (memory.conversations.length > 0) {
          lines.push("=== 최근 대화 ===");
          for (const conv of memory.conversations.slice(-3)) {
            lines.push(`📅 ${conv.date.slice(0, 10)}`);
            lines.push(`   주제: ${conv.topics.join(", ")}`);
            if (conv.todos.length > 0) {
              lines.push(`   TODO: ${conv.todos.join(", ")}`);
            }
          }
          lines.push("");
        }
      }

      if (lines.length === 0) {
        return { success: true, content: "저장된 메모리가 없습니다." };
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Search Memory Tool
export const searchMemoryTool: Tool = {
  name: "search_memory",
  description: "Search through stored notes and facts (메모리 검색). Use when user asks: 'find in memory', 'what did we say about', '기억에서 찾아', '메모리 검색'.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "Search query",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const query = (args.query as string).toLowerCase();
      const memory = loadMemory();

      const results: string[] = [];
      results.push(`=== 메모리 검색: "${args.query}" ===`);
      results.push("");

      // Search notes
      const matchingNotes = memory.notes.filter(
        (n) =>
          n.title.toLowerCase().includes(query) ||
          n.content.toLowerCase().includes(query) ||
          n.tags.some((t) => t.toLowerCase().includes(query))
      );
      if (matchingNotes.length > 0) {
        results.push("📌 노트:");
        for (const note of matchingNotes) {
          results.push(`   ${note.title}`);
          results.push(`   ${note.content.slice(0, 80)}...`);
        }
        results.push("");
      }

      // Search facts
      const matchingFacts = memory.facts.filter(
        (f) =>
          f.key.toLowerCase().includes(query) ||
          f.value.toLowerCase().includes(query)
      );
      if (matchingFacts.length > 0) {
        results.push("💡 사실:");
        for (const fact of matchingFacts) {
          results.push(`   ${fact.key}: ${fact.value}`);
        }
        results.push("");
      }

      // Search key files
      const matchingFiles = memory.project.keyFiles.filter(
        (f) =>
          f.path.toLowerCase().includes(query) ||
          f.description.toLowerCase().includes(query)
      );
      if (matchingFiles.length > 0) {
        results.push("📄 중요 파일:");
        for (const file of matchingFiles) {
          results.push(`   ${file.path}: ${file.description}`);
        }
        results.push("");
      }

      // Search conversations
      const matchingConvs = memory.conversations.filter(
        (c) =>
          c.topics.some((t) => t.toLowerCase().includes(query)) ||
          c.keyFindings.some((f) => f.toLowerCase().includes(query))
      );
      if (matchingConvs.length > 0) {
        results.push("📅 대화:");
        for (const conv of matchingConvs) {
          results.push(`   ${conv.date.slice(0, 10)}: ${conv.topics.join(", ")}`);
        }
        results.push("");
      }

      if (results.length === 3) {
        // Only header, no results
        return { success: true, content: `"${args.query}"에 대한 검색 결과가 없습니다.` };
      }

      return { success: true, content: results.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Clear Memory Tool
export const clearMemoryTool: Tool = {
  name: "clear_memory",
  description: "Clear stored memory (메모리 삭제). Use when user asks: 'forget everything', 'clear memory', '메모리 삭제', '기억 삭제'.",
  parameters: {
    type: "object",
    properties: {
      section: {
        type: "string",
        description: "Section to clear: 'notes', 'facts', 'conversations', or 'all'",
        enum: ["notes", "facts", "conversations", "all"],
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const section = (args.section as string) || "all";
      const memory = loadMemory();

      if (section === "all") {
        const dir = getMemoryDir();
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true });
        }
        return { success: true, content: "✅ 전체 메모리가 삭제되었습니다." };
      }

      if (section === "notes") {
        const count = memory.notes.length;
        memory.notes = [];
        saveMemory(memory);
        return { success: true, content: `✅ ${count}개 노트가 삭제되었습니다.` };
      }

      if (section === "facts") {
        const count = memory.facts.length;
        memory.facts = [];
        saveMemory(memory);
        return { success: true, content: `✅ ${count}개 사실이 삭제되었습니다.` };
      }

      if (section === "conversations") {
        const count = memory.conversations.length;
        memory.conversations = [];
        saveMemory(memory);
        return { success: true, content: `✅ ${count}개 대화 기록이 삭제되었습니다.` };
      }

      return { success: false, content: "", error: `알 수 없는 섹션: ${section}` };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Export all memory tools
export const memoryTools: Tool[] = [
  initProjectTool,
  addKeyFileTool,
  addNoteTool,
  addFactTool,
  saveConversationTool,
  getContextTool,
  searchMemoryTool,
  clearMemoryTool,
];
