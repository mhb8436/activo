import fs from "fs";
import path from "path";
import crypto from "crypto";
import { glob } from "glob";
import { Tool, ToolResult } from "./types.js";
import { OllamaClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";

// Embeddings directory
const EMBEDDINGS_DIR = ".activo/embeddings";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";

// Code chunk for embedding
interface CodeChunk {
  filepath: string;
  startLine: number;
  endLine: number;
  content: string;
  type: "function" | "class" | "block" | "file";
  name?: string;
}

// Embedding entry
interface EmbeddingEntry {
  chunk: CodeChunk;
  embedding: number[];
  hash: string;
}

// Embeddings index
interface EmbeddingsIndex {
  version: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  files: Record<string, {
    hash: string;
    chunks: number; // count of chunks from this file
  }>;
  totalChunks: number;
}

// Get embeddings directory
function getEmbeddingsDir(): string {
  return path.resolve(process.cwd(), EMBEDDINGS_DIR);
}

// Ensure embeddings directory exists
function ensureEmbeddingsDir(): void {
  const dir = getEmbeddingsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Get index path
function getIndexPath(): string {
  return path.join(getEmbeddingsDir(), "index.json");
}

// Get embeddings data path
function getDataPath(): string {
  return path.join(getEmbeddingsDir(), "data.json");
}

// Load index
function loadIndex(): EmbeddingsIndex | null {
  const indexPath = getIndexPath();
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

// Save index
function saveIndex(index: EmbeddingsIndex): void {
  ensureEmbeddingsDir();
  fs.writeFileSync(getIndexPath(), JSON.stringify(index, null, 2));
}

// Load embeddings data
function loadData(): EmbeddingEntry[] {
  const dataPath = getDataPath();
  if (fs.existsSync(dataPath)) {
    try {
      return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

// Save embeddings data
function saveData(data: EmbeddingEntry[]): void {
  ensureEmbeddingsDir();
  fs.writeFileSync(getDataPath(), JSON.stringify(data));
}

// Calculate file hash
function calculateHash(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// Split file into semantic chunks
function splitIntoChunks(content: string, filepath: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split("\n");
  const ext = path.extname(filepath).toLowerCase();

  // For TypeScript/JavaScript, try to split by functions/classes
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    let currentChunk: string[] = [];
    let chunkStart = 0;
    let braceCount = 0;
    let inFunction = false;
    let functionName = "";
    let chunkType: "function" | "class" | "block" = "block";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentChunk.push(line);

      // Detect function/class start
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)\s*[=:]?\s*(?:async\s*)?\(/);
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
      const methodMatch = line.match(/^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/);

      if (!inFunction && (funcMatch || classMatch)) {
        if (currentChunk.length > 1) {
          // Save previous chunk
          const prevContent = currentChunk.slice(0, -1).join("\n").trim();
          if (prevContent) {
            chunks.push({
              filepath,
              startLine: chunkStart + 1,
              endLine: i,
              content: prevContent,
              type: "block",
            });
          }
        }
        chunkStart = i;
        currentChunk = [line];
        inFunction = true;
        functionName = funcMatch?.[1] || classMatch?.[1] || "";
        chunkType = classMatch ? "class" : "function";
      }

      // Count braces
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;

      // End of function/class
      if (inFunction && braceCount === 0 && currentChunk.length > 1) {
        const chunkContent = currentChunk.join("\n").trim();
        if (chunkContent) {
          chunks.push({
            filepath,
            startLine: chunkStart + 1,
            endLine: i + 1,
            content: chunkContent,
            type: chunkType,
            name: functionName,
          });
        }
        currentChunk = [];
        chunkStart = i + 1;
        inFunction = false;
        functionName = "";
        chunkType = "block";
      }
    }

    // Remaining content
    if (currentChunk.length > 0) {
      const remaining = currentChunk.join("\n").trim();
      if (remaining) {
        chunks.push({
          filepath,
          startLine: chunkStart + 1,
          endLine: lines.length,
          content: remaining,
          type: inFunction ? chunkType : "block",
          name: functionName || undefined,
        });
      }
    }
  } else {
    // For other files, split by size (around 50 lines per chunk)
    const chunkSize = 50;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, Math.min(i + chunkSize, lines.length));
      const chunkContent = chunkLines.join("\n").trim();
      if (chunkContent) {
        chunks.push({
          filepath,
          startLine: i + 1,
          endLine: Math.min(i + chunkSize, lines.length),
          content: chunkContent,
          type: "block",
        });
      }
    }
  }

  // If no chunks or only small chunks, treat whole file as one chunk
  if (chunks.length === 0 || (chunks.length === 1 && chunks[0].content.length < 100)) {
    return [{
      filepath,
      startLine: 1,
      endLine: lines.length,
      content: content.trim(),
      type: "file",
    }];
  }

  // Split large chunks into smaller ones (max 1500 chars per chunk)
  const maxChunkChars = 1500;
  const finalChunks: CodeChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.content.length <= maxChunkChars) {
      finalChunks.push(chunk);
    } else {
      // Split by lines
      const chunkLines = chunk.content.split("\n");
      let subChunk: string[] = [];
      let subStart = chunk.startLine;

      for (let i = 0; i < chunkLines.length; i++) {
        subChunk.push(chunkLines[i]);
        const subContent = subChunk.join("\n");

        if (subContent.length >= maxChunkChars || i === chunkLines.length - 1) {
          if (subContent.trim()) {
            finalChunks.push({
              filepath: chunk.filepath,
              startLine: subStart,
              endLine: chunk.startLine + i,
              content: subContent.trim(),
              type: chunk.type,
              name: chunk.name ? `${chunk.name} (part)` : undefined,
            });
          }
          subChunk = [];
          subStart = chunk.startLine + i + 1;
        }
      }
    }
  }

  return finalChunks;
}

// Maximum characters for embedding (nomic-embed-text context limit)
const MAX_EMBED_CHARS = 2000;

// Prepare text for embedding (add context)
function prepareForEmbedding(chunk: CodeChunk): string {
  const parts: string[] = [];

  // Add file context
  parts.push(`File: ${chunk.filepath}`);

  if (chunk.name) {
    parts.push(`${chunk.type}: ${chunk.name}`);
  }

  parts.push(`Lines: ${chunk.startLine}-${chunk.endLine}`);
  parts.push("");

  // Truncate content if too long
  let content = chunk.content;
  if (content.length > MAX_EMBED_CHARS) {
    content = content.slice(0, MAX_EMBED_CHARS) + "\n... (truncated)";
  }
  parts.push(content);

  return parts.join("\n");
}

// Calculate cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Index Codebase Tool
export const indexCodebaseTool: Tool = {
  name: "index_codebase",
  description: "Index codebase for semantic search (코드베이스 인덱싱). Creates embeddings for all code files. Run this before using semantic_search. Use when user asks: 'index', 'prepare search', '인덱싱', '검색 준비'.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern for files (default: **/*.{ts,js,tsx,jsx,py,go})",
      },
      force: {
        type: "boolean",
        description: "Force re-index all files (default: only changed files)",
      },
      model: {
        type: "string",
        description: "Embedding model (default: nomic-embed-text)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const pattern = (args.pattern as string) || "**/*.{ts,js,tsx,jsx,py,go,java,rs}";
      const force = args.force as boolean || false;
      const embedModel = (args.model as string) || DEFAULT_EMBED_MODEL;

      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      // Check if embedding model is available
      const models = await client.listModels();
      if (!models.some((m) => m.includes(embedModel.split(":")[0]))) {
        return {
          success: false,
          content: "",
          error: `임베딩 모델 '${embedModel}'을 찾을 수 없습니다. 'ollama pull ${embedModel}'로 설치하세요.`,
        };
      }

      // Find files
      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/*.min.js"],
      });

      if (files.length === 0) {
        return { success: true, content: "인덱싱할 파일이 없습니다." };
      }

      // Load existing index and data
      const existingIndex = loadIndex();
      const existingData = force ? [] : loadData();

      const newIndex: EmbeddingsIndex = {
        version: "1.0",
        model: embedModel,
        createdAt: existingIndex?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        files: {},
        totalChunks: 0,
      };

      const newData: EmbeddingEntry[] = [];
      let processed = 0;
      let skipped = 0;
      let errors = 0;

      const results: string[] = [];
      results.push(`=== 코드베이스 인덱싱 ===`);
      results.push(`모델: ${embedModel}`);
      results.push(`파일: ${files.length}개`);
      results.push("");

      for (const file of files) {
        try {
          const content = fs.readFileSync(file, "utf-8");
          const hash = calculateHash(content);
          const relativePath = path.relative(process.cwd(), file);

          // Check if file unchanged
          if (!force && existingIndex?.files[relativePath]?.hash === hash) {
            // Keep existing embeddings
            const existing = existingData.filter((e) => e.chunk.filepath === relativePath);
            newData.push(...existing);
            newIndex.files[relativePath] = existingIndex.files[relativePath];
            skipped++;
            continue;
          }

          // Split into chunks
          const chunks = splitIntoChunks(content, relativePath);

          // Generate embeddings for each chunk
          for (const chunk of chunks) {
            const text = prepareForEmbedding(chunk);
            const embedding = await client.embed(text, embedModel);

            newData.push({
              chunk,
              embedding,
              hash: calculateHash(chunk.content),
            });
          }

          newIndex.files[relativePath] = { hash, chunks: chunks.length };
          processed++;
          results.push(`✅ ${relativePath} (${chunks.length} chunks)`);
        } catch (err) {
          errors++;
          results.push(`❌ ${file}: ${err}`);
        }
      }

      newIndex.totalChunks = newData.length;

      // Save index and data
      saveIndex(newIndex);
      saveData(newData);

      results.push("");
      results.push(`=== 완료 ===`);
      results.push(`처리됨: ${processed}개 파일`);
      results.push(`스킵됨: ${skipped}개 파일 (변경없음)`);
      results.push(`에러: ${errors}개`);
      results.push(`총 청크: ${newData.length}개`);

      return { success: true, content: results.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Semantic Search Tool
export const semanticSearchTool: Tool = {
  name: "semantic_search",
  description: "Search code by meaning/description (의미 기반 검색). Finds relevant code based on natural language query. Requires index_codebase first. Use when user asks: 'find code that', 'where is the code for', '관련 코드 찾아', '이런 코드 어디'.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "Natural language query describing what you're looking for",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 5)",
      },
      threshold: {
        type: "number",
        description: "Minimum similarity score 0-1 (default: 0.3)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const query = args.query as string;
      const limit = (args.limit as number) || 5;
      const threshold = (args.threshold as number) || 0.3;

      // Load index and data
      const index = loadIndex();
      if (!index) {
        return {
          success: false,
          content: "",
          error: "인덱스가 없습니다. 먼저 'index_codebase'를 실행하세요.",
        };
      }

      const data = loadData();
      if (data.length === 0) {
        return {
          success: false,
          content: "",
          error: "임베딩 데이터가 없습니다. 먼저 'index_codebase'를 실행하세요.",
        };
      }

      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      // Generate query embedding
      const queryEmbedding = await client.embed(query, index.model);

      // Calculate similarities
      const results: Array<{
        entry: EmbeddingEntry;
        similarity: number;
      }> = [];

      for (const entry of data) {
        const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
        if (similarity >= threshold) {
          results.push({ entry, similarity });
        }
      }

      // Sort by similarity
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, limit);

      if (topResults.length === 0) {
        return {
          success: true,
          content: `"${query}"와 관련된 코드를 찾지 못했습니다. (threshold: ${threshold})`,
        };
      }

      const lines: string[] = [];
      lines.push(`=== 검색 결과: "${query}" ===`);
      lines.push(`(${topResults.length}개 결과, 유사도 >= ${threshold})`);
      lines.push("");

      for (let i = 0; i < topResults.length; i++) {
        const { entry, similarity } = topResults[i];
        const chunk = entry.chunk;
        const score = Math.round(similarity * 100);

        lines.push(`📍 #${i + 1} [${score}%] ${chunk.filepath}:${chunk.startLine}-${chunk.endLine}`);
        if (chunk.name) {
          lines.push(`   ${chunk.type}: ${chunk.name}`);
        }
        lines.push("   ```");
        // Show first 10 lines of content
        const contentLines = chunk.content.split("\n").slice(0, 10);
        contentLines.forEach((l) => lines.push(`   ${l}`));
        if (chunk.content.split("\n").length > 10) {
          lines.push("   ...");
        }
        lines.push("   ```");
        lines.push("");
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Find Similar Code Tool
export const findSimilarCodeTool: Tool = {
  name: "find_similar_code",
  description: "Find code similar to a given snippet or file (유사 코드 찾기). Use when user asks: 'find similar', 'code like this', '비슷한 코드', '이런 패턴'.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "Code snippet to find similar code for",
      },
      filepath: {
        type: "string",
        description: "Or specify a file path to find similar files",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 5)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      let codeToSearch = args.code as string | undefined;
      const filepath = args.filepath as string | undefined;
      const limit = (args.limit as number) || 5;

      if (!codeToSearch && !filepath) {
        return {
          success: false,
          content: "",
          error: "code 또는 filepath 중 하나를 지정하세요.",
        };
      }

      if (filepath) {
        const fullPath = path.resolve(filepath);
        if (!fs.existsSync(fullPath)) {
          return { success: false, content: "", error: `파일을 찾을 수 없음: ${filepath}` };
        }
        codeToSearch = fs.readFileSync(fullPath, "utf-8");
      }

      const index = loadIndex();
      if (!index) {
        return {
          success: false,
          content: "",
          error: "인덱스가 없습니다. 먼저 'index_codebase'를 실행하세요.",
        };
      }

      const data = loadData();
      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      // Generate embedding for the search code
      const searchEmbedding = await client.embed(codeToSearch!, index.model);

      // Find similar
      const results: Array<{
        entry: EmbeddingEntry;
        similarity: number;
      }> = [];

      const searchFilepath = filepath ? path.relative(process.cwd(), path.resolve(filepath)) : null;

      for (const entry of data) {
        // Skip the same file if searching by filepath
        if (searchFilepath && entry.chunk.filepath === searchFilepath) continue;

        const similarity = cosineSimilarity(searchEmbedding, entry.embedding);
        if (similarity > 0.5) { // Higher threshold for similarity search
          results.push({ entry, similarity });
        }
      }

      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, limit);

      if (topResults.length === 0) {
        return { success: true, content: "유사한 코드를 찾지 못했습니다." };
      }

      const lines: string[] = [];
      lines.push(`=== 유사 코드 검색 결과 ===`);
      lines.push("");

      for (let i = 0; i < topResults.length; i++) {
        const { entry, similarity } = topResults[i];
        const chunk = entry.chunk;
        const score = Math.round(similarity * 100);

        lines.push(`📍 #${i + 1} [${score}%] ${chunk.filepath}:${chunk.startLine}-${chunk.endLine}`);
        if (chunk.name) {
          lines.push(`   ${chunk.type}: ${chunk.name}`);
        }
        lines.push("   ```");
        const contentLines = chunk.content.split("\n").slice(0, 8);
        contentLines.forEach((l) => lines.push(`   ${l}`));
        if (chunk.content.split("\n").length > 8) {
          lines.push("   ...");
        }
        lines.push("   ```");
        lines.push("");
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Embeddings Status Tool
export const embeddingsStatusTool: Tool = {
  name: "embeddings_status",
  description: "Show embeddings index status (임베딩 상태). Shows indexed files and statistics. Use when user asks: 'index status', 'embeddings info', '인덱스 상태'.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async (): Promise<ToolResult> => {
    try {
      const index = loadIndex();

      if (!index) {
        return {
          success: true,
          content: "임베딩 인덱스가 없습니다. 'index_codebase'를 실행하여 생성하세요.",
        };
      }

      const files = Object.keys(index.files);
      const totalChunks = Object.values(index.files).reduce((sum, f) => sum + f.chunks, 0);

      const lines: string[] = [];
      lines.push(`=== 임베딩 인덱스 상태 ===`);
      lines.push("");
      lines.push(`📊 통계:`);
      lines.push(`   모델: ${index.model}`);
      lines.push(`   파일: ${files.length}개`);
      lines.push(`   청크: ${totalChunks}개`);
      lines.push(`   생성: ${index.createdAt.slice(0, 10)}`);
      lines.push(`   갱신: ${index.updatedAt.slice(0, 10)}`);
      lines.push("");
      lines.push(`📁 인덱싱된 파일:`);

      // Group by directory
      const byDir: Record<string, string[]> = {};
      for (const file of files) {
        const dir = path.dirname(file) || ".";
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(path.basename(file));
      }

      for (const [dir, fileList] of Object.entries(byDir)) {
        lines.push(`   ${dir}/`);
        fileList.slice(0, 10).forEach((f) => lines.push(`      ${f}`));
        if (fileList.length > 10) {
          lines.push(`      ... 외 ${fileList.length - 10}개`);
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Clear Embeddings Tool
export const clearEmbeddingsTool: Tool = {
  name: "clear_embeddings",
  description: "Clear embeddings index (임베딩 삭제). Removes all indexed data. Use when user asks: 'clear index', 'reset embeddings', '인덱스 삭제'.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async (): Promise<ToolResult> => {
    try {
      const dir = getEmbeddingsDir();
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
      return { success: true, content: "임베딩 인덱스가 삭제되었습니다." };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Export all embedding tools
export const embeddingTools: Tool[] = [
  indexCodebaseTool,
  semanticSearchTool,
  findSimilarCodeTool,
  embeddingsStatusTool,
  clearEmbeddingsTool,
];
