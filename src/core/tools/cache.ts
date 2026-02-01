import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Tool, ToolResult } from "./types.js";
import { OllamaClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";

// Cache directory (project-level)
const CACHE_DIR = ".activo/cache";

// Cache entry interface
export interface FileCacheEntry {
  filepath: string;
  hash: string; // File content hash for invalidation
  summary: string;
  outline: string;
  exports: string[];
  imports: string[];
  lastUpdated: string;
  model: string;
}

// Cache index interface
interface CacheIndex {
  version: string;
  entries: Record<string, FileCacheEntry>;
}

// Get cache directory path
function getCacheDir(): string {
  return path.resolve(process.cwd(), CACHE_DIR);
}

// Get cache index path
function getCacheIndexPath(): string {
  return path.join(getCacheDir(), "index.json");
}

// Ensure cache directory exists
function ensureCacheDir(): void {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

// Load cache index
function loadCacheIndex(): CacheIndex {
  const indexPath = getCacheIndexPath();
  if (fs.existsSync(indexPath)) {
    try {
      const data = fs.readFileSync(indexPath, "utf-8");
      return JSON.parse(data);
    } catch {
      return { version: "1.0", entries: {} };
    }
  }
  return { version: "1.0", entries: {} };
}

// Save cache index
function saveCacheIndex(index: CacheIndex): void {
  ensureCacheDir();
  const indexPath = getCacheIndexPath();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Calculate file hash
function calculateFileHash(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// Extract code outline (functions, classes, types) without LLM
function extractOutline(content: string, filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const lines = content.split("\n");
  const outline: string[] = [];

  // TypeScript/JavaScript patterns
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const patterns = [
      /^export\s+(default\s+)?(async\s+)?function\s+(\w+)/,
      /^export\s+(default\s+)?class\s+(\w+)/,
      /^export\s+(default\s+)?(const|let|var)\s+(\w+)/,
      /^export\s+(type|interface)\s+(\w+)/,
      /^(async\s+)?function\s+(\w+)/,
      /^class\s+(\w+)/,
      /^(const|let|var)\s+(\w+)\s*[:=]\s*(async\s+)?\(/,
      /^(const|let|var)\s+(\w+)\s*[:=]\s*\{/,
      /^(type|interface)\s+(\w+)/,
    ];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
          outline.push(`L${idx + 1}: ${trimmed.slice(0, 80)}${trimmed.length > 80 ? "..." : ""}`);
          break;
        }
      }
    });
  }
  // Python patterns
  else if ([".py"].includes(ext)) {
    const patterns = [
      /^(async\s+)?def\s+(\w+)/,
      /^class\s+(\w+)/,
    ];

    lines.forEach((line, idx) => {
      const trimmed = line.trimStart();
      // Only top-level definitions (no indentation)
      if (line === trimmed || line.startsWith("    ") && !line.startsWith("        ")) {
        for (const pattern of patterns) {
          if (pattern.test(trimmed)) {
            outline.push(`L${idx + 1}: ${trimmed.slice(0, 80)}${trimmed.length > 80 ? "..." : ""}`);
            break;
          }
        }
      }
    });
  }
  // Go patterns
  else if ([".go"].includes(ext)) {
    const patterns = [
      /^func\s+(\w+|\(\w+\s+\*?\w+\)\s+\w+)/,
      /^type\s+(\w+)\s+(struct|interface)/,
    ];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
          outline.push(`L${idx + 1}: ${trimmed.slice(0, 80)}${trimmed.length > 80 ? "..." : ""}`);
          break;
        }
      }
    });
  }

  return outline.length > 0 ? outline.join("\n") : "(No outline extracted)";
}

// Extract imports
function extractImports(content: string, filepath: string): string[] {
  const ext = path.extname(filepath).toLowerCase();
  const imports: string[] = [];

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const importRegex = /import\s+.*?from\s+["'](.+?)["']/g;
    const requireRegex = /require\s*\(\s*["'](.+?)["']\s*\)/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
  } else if ([".py"].includes(ext)) {
    const importRegex = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1] || match[2]);
    }
  }

  return [...new Set(imports)];
}

// Extract exports
function extractExports(content: string, filepath: string): string[] {
  const ext = path.extname(filepath).toLowerCase();
  const exports: string[] = [];

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const exportRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+(\w+)/g;
    const exportFromRegex = /export\s+\{([^}]+)\}/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
    while ((match = exportFromRegex.exec(content)) !== null) {
      const names = match[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
      exports.push(...names);
    }
  }

  return [...new Set(exports)].filter((e) => e);
}

// Summarize file using Ollama
async function summarizeWithLLM(content: string, filepath: string): Promise<string> {
  const config = loadConfig();
  const client = new OllamaClient(config.ollama);

  // Truncate very large files
  const maxChars = 8000;
  const truncated = content.length > maxChars
    ? content.slice(0, maxChars) + "\n\n... (truncated)"
    : content;

  const prompt = `다음 코드 파일을 분석하고 간결하게 요약해주세요.

파일: ${filepath}

코드:
\`\`\`
${truncated}
\`\`\`

다음 형식으로 답변해주세요:
1. 목적: (이 파일의 주요 목적, 1-2문장)
2. 주요 기능: (핵심 함수/클래스 설명, 3-5개)
3. 의존성: (주요 외부 의존성)
4. 참고: (특이사항이나 주의점)

간결하고 핵심적인 정보만 포함하세요.`;

  try {
    const response = await client.chat([
      { role: "user", content: prompt }
    ]);
    return response.content;
  } catch (error) {
    return `(요약 생성 실패: ${error})`;
  }
}

// Summarize File Tool
export const summarizeFileTool: Tool = {
  name: "summarize_file",
  description: "Summarize/analyze a code file (파일 요약, 분석). Uses LLM to explain what the file does. Caches result for faster retrieval. Use when user asks: 'summarize', 'explain', 'what does this file do', '요약', '분석', '설명'.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to the file to summarize",
      },
      force: {
        type: "boolean",
        description: "Force regenerate summary even if cached",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const force = args.force as boolean || false;

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }

      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        return { success: false, content: "", error: "Path is a directory" };
      }

      const content = fs.readFileSync(filepath, "utf-8");
      const hash = calculateFileHash(content);
      const relativePath = path.relative(process.cwd(), filepath);

      // Check cache
      const index = loadCacheIndex();
      const cached = index.entries[relativePath];

      if (!force && cached && cached.hash === hash) {
        return {
          success: true,
          content: `[캐시됨 - ${cached.lastUpdated}]\n\n${cached.summary}\n\n--- 아웃라인 ---\n${cached.outline}`,
        };
      }

      // Generate new summary
      const summary = await summarizeWithLLM(content, relativePath);
      const outline = extractOutline(content, filepath);
      const imports = extractImports(content, filepath);
      const exports = extractExports(content, filepath);
      const config = loadConfig();

      // Update cache
      const entry: FileCacheEntry = {
        filepath: relativePath,
        hash,
        summary,
        outline,
        imports,
        exports,
        lastUpdated: new Date().toISOString(),
        model: config.ollama.model,
      };

      index.entries[relativePath] = entry;
      saveCacheIndex(index);

      return {
        success: true,
        content: `[새로 생성됨]\n\n${summary}\n\n--- 아웃라인 ---\n${outline}`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Get File Outline Tool (no LLM, fast)
export const getFileOutlineTool: Tool = {
  name: "get_file_outline",
  description: "List functions, classes, imports, exports in a file (함수 목록, 구조, 아웃라인). Fast - no LLM needed. Use when user asks: 'list functions', 'show structure', 'what functions', '함수 목록', '구조', '아웃라인'.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to the file",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }

      const content = fs.readFileSync(filepath, "utf-8");
      const outline = extractOutline(content, filepath);
      const imports = extractImports(content, filepath);
      const exports = extractExports(content, filepath);

      const result = [
        `=== ${path.basename(filepath)} ===`,
        "",
        "📤 Exports:",
        exports.length > 0 ? exports.map((e) => `  - ${e}`).join("\n") : "  (none)",
        "",
        "📥 Imports:",
        imports.length > 0 ? imports.map((i) => `  - ${i}`).join("\n") : "  (none)",
        "",
        "📋 Outline:",
        outline,
      ].join("\n");

      return { success: true, content: result };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Get Cached Summary Tool
export const getCachedSummaryTool: Tool = {
  name: "get_cached_summary",
  description: "Retrieve previously cached file summary (캐시된 요약 조회). Returns JSON with summary, outline, imports, exports. Use when checking if summary exists.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to the file",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const relativePath = path.relative(process.cwd(), filepath);

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }

      const content = fs.readFileSync(filepath, "utf-8");
      const currentHash = calculateFileHash(content);

      const index = loadCacheIndex();
      const cached = index.entries[relativePath];

      if (cached && cached.hash === currentHash) {
        return {
          success: true,
          content: JSON.stringify(cached, null, 2),
        };
      }

      return {
        success: true,
        content: "(캐시 없음 또는 파일이 변경됨)",
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// List Cached Files Tool
export const listCacheTool: Tool = {
  name: "list_cache",
  description: "Show all cached/summarized files (캐시 목록). Use when user asks: 'show cache', 'what files are cached', '캐시 목록', '캐시된 파일'.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async (): Promise<ToolResult> => {
    try {
      const index = loadCacheIndex();
      const entries = Object.values(index.entries);

      if (entries.length === 0) {
        return { success: true, content: "캐시된 파일이 없습니다." };
      }

      const result = entries.map((e) => {
        return `📄 ${e.filepath}\n   해시: ${e.hash.slice(0, 8)}... | 모델: ${e.model} | 갱신: ${e.lastUpdated.slice(0, 10)}`;
      }).join("\n\n");

      return {
        success: true,
        content: `=== 캐시된 파일 (${entries.length}개) ===\n\n${result}`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Clear Cache Tool
export const clearCacheTool: Tool = {
  name: "clear_cache",
  description: "Delete cached summaries (캐시 삭제/초기화). Can clear all or specific file. Use when user asks: 'clear cache', 'delete cache', '캐시 삭제', '캐시 초기화'.",
  parameters: {
    type: "object",
    properties: {
      filepath: {
        type: "string",
        description: "Optional: clear only this file's cache",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const specificFile = args.filepath as string | undefined;
      const index = loadCacheIndex();

      if (specificFile) {
        const relativePath = path.relative(process.cwd(), path.resolve(specificFile));
        if (index.entries[relativePath]) {
          delete index.entries[relativePath];
          saveCacheIndex(index);
          return { success: true, content: `캐시 삭제됨: ${relativePath}` };
        }
        return { success: true, content: `캐시에 없음: ${relativePath}` };
      }

      const count = Object.keys(index.entries).length;
      saveCacheIndex({ version: "1.0", entries: {} });
      return { success: true, content: `전체 캐시 삭제됨 (${count}개 파일)` };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Batch Summarize Tool
export const batchSummarizeTool: Tool = {
  name: "batch_summarize",
  description: "Summarize multiple files at once (여러 파일 일괄 요약). Use glob pattern like 'src/**/*.ts'. Use when user asks: 'summarize all files', 'analyze folder', '전체 요약', '폴더 분석', '모든 파일'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.ts)",
      },
      skipCached: {
        type: "boolean",
        description: "Skip files that already have valid cache",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;
      const skipCached = args.skipCached !== false; // default true

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      });

      if (files.length === 0) {
        return { success: true, content: "매칭되는 파일이 없습니다." };
      }

      const index = loadCacheIndex();
      const results: string[] = [];
      let processed = 0;
      let skipped = 0;

      for (const file of files.slice(0, 20)) { // Limit to 20 files
        const filepath = path.resolve(file);
        const relativePath = path.relative(process.cwd(), filepath);

        try {
          const content = fs.readFileSync(filepath, "utf-8");
          const hash = calculateFileHash(content);
          const cached = index.entries[relativePath];

          if (skipCached && cached && cached.hash === hash) {
            skipped++;
            continue;
          }

          const summary = await summarizeWithLLM(content, relativePath);
          const outline = extractOutline(content, filepath);
          const imports = extractImports(content, filepath);
          const exports = extractExports(content, filepath);
          const config = loadConfig();

          index.entries[relativePath] = {
            filepath: relativePath,
            hash,
            summary,
            outline,
            imports,
            exports,
            lastUpdated: new Date().toISOString(),
            model: config.ollama.model,
          };

          results.push(`✅ ${relativePath}`);
          processed++;
        } catch (err) {
          results.push(`❌ ${relativePath}: ${err}`);
        }
      }

      saveCacheIndex(index);

      const summary = [
        `=== 배치 요약 완료 ===`,
        `처리됨: ${processed}개`,
        `스킵됨 (캐시): ${skipped}개`,
        `전체 파일: ${files.length}개${files.length > 20 ? " (최대 20개 처리)" : ""}`,
        "",
        ...results,
      ].join("\n");

      return { success: true, content: summary };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// All cache tools
export const cacheTools: Tool[] = [
  summarizeFileTool,
  getFileOutlineTool,
  getCachedSummaryTool,
  listCacheTool,
  clearCacheTool,
  batchSummarizeTool,
];
