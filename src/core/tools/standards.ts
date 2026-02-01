import fs from "fs";
import path from "path";
import crypto from "crypto";
import pdfParse from "pdf-parse";
import { toMarkdown as hwpToMarkdown } from "@ohah/hwpjs";
import { Tool, ToolResult } from "./types.js";
import { OllamaClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";

// RAG constants
const STANDARDS_EMBEDDINGS_DIR = ".activo/standards-rag";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";

// RAG interfaces
interface StandardsChunk {
  filepath: string;
  section: string;
  ruleId?: string;
  content: string;
}

interface StandardsEmbedding {
  chunk: StandardsChunk;
  embedding: number[];
  hash: string;
}

interface StandardsIndex {
  version: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  totalChunks: number;
}

// RAG helper functions
function getStandardsRagDir(): string {
  return path.resolve(process.cwd(), STANDARDS_EMBEDDINGS_DIR);
}

function ensureStandardsRagDir(): void {
  const dir = getStandardsRagDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getStandardsIndexPath(): string {
  return path.join(getStandardsRagDir(), "index.json");
}

function getStandardsDataPath(): string {
  return path.join(getStandardsRagDir(), "embeddings.json");
}

function loadStandardsIndex(): StandardsIndex | null {
  const indexPath = getStandardsIndexPath();
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveStandardsIndex(index: StandardsIndex): void {
  ensureStandardsRagDir();
  fs.writeFileSync(getStandardsIndexPath(), JSON.stringify(index, null, 2));
}

function loadStandardsEmbeddings(): StandardsEmbedding[] {
  const dataPath = getStandardsDataPath();
  if (fs.existsSync(dataPath)) {
    try {
      return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

function saveStandardsEmbeddings(data: StandardsEmbedding[]): void {
  ensureStandardsRagDir();
  fs.writeFileSync(getStandardsDataPath(), JSON.stringify(data));
}

function calculateHash(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

// Split markdown into semantic chunks (by sections/rules)
function splitStandardsIntoChunks(content: string, filepath: string): StandardsChunk[] {
  const chunks: StandardsChunk[] = [];
  const lines = content.split("\n");

  let currentSection = "";
  let currentRuleId: string | undefined;
  let currentContent: string[] = [];
  let inRule = false;

  for (const line of lines) {
    // Detect rule pattern: ## RULE-XXX: Title
    const ruleMatch = line.match(/^##\s+(RULE-\d+):\s*(.+)/i);
    // Detect section headers
    const sectionMatch = line.match(/^#+\s+(.+)/);

    if (ruleMatch) {
      // Save previous chunk
      if (currentContent.length > 0) {
        const text = currentContent.join("\n").trim();
        if (text) {
          chunks.push({
            filepath,
            section: currentSection,
            ruleId: currentRuleId,
            content: text,
          });
        }
      }
      currentRuleId = ruleMatch[1];
      currentSection = ruleMatch[2];
      currentContent = [line];
      inRule = true;
    } else if (sectionMatch && !inRule) {
      // Save previous chunk
      if (currentContent.length > 0) {
        const text = currentContent.join("\n").trim();
        if (text) {
          chunks.push({
            filepath,
            section: currentSection,
            ruleId: currentRuleId,
            content: text,
          });
        }
      }
      currentSection = sectionMatch[1];
      currentRuleId = undefined;
      currentContent = [line];
    } else if (line.match(/^##/) && inRule) {
      // End of rule, start new section
      if (currentContent.length > 0) {
        const text = currentContent.join("\n").trim();
        if (text) {
          chunks.push({
            filepath,
            section: currentSection,
            ruleId: currentRuleId,
            content: text,
          });
        }
      }
      inRule = false;
      currentRuleId = undefined;
      const newSection = line.match(/^#+\s+(.+)/);
      currentSection = newSection ? newSection[1] : "";
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }

  // Save remaining content
  if (currentContent.length > 0) {
    const text = currentContent.join("\n").trim();
    if (text) {
      chunks.push({
        filepath,
        section: currentSection,
        ruleId: currentRuleId,
        content: text,
      });
    }
  }

  // Filter out small chunks (less than 50 chars)
  return chunks.filter(c => c.content.length >= 50);
}

// Cosine similarity
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
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Resolve natural language directory paths
function resolveOutputDir(outputDir: string | undefined): string {
  if (!outputDir) {
    return path.resolve(".activo/standards");
  }

  const normalized = outputDir.trim().toLowerCase();

  // Natural language mappings
  const currentDirPatterns = [
    "현재 디렉토리", "현재 폴더", "현재디렉토리", "현재폴더",
    "이 디렉토리", "이 폴더", "여기", "here",
    "current directory", "current folder", "current dir",
    ".", "./"
  ];

  for (const pattern of currentDirPatterns) {
    if (normalized.includes(pattern)) {
      return path.resolve(".");
    }
  }

  // Handle ~ for home directory
  if (outputDir.startsWith("~")) {
    return path.resolve(outputDir.replace("~", process.env.HOME || ""));
  }

  return path.resolve(outputDir);
}

// Import PDF Tool
export const importPdfTool: Tool = {
  name: "import_pdf_standards",
  description: "Import development standards from a PDF file and convert to markdown (PDF를 마크다운으로 변환). Use when user asks: 'PDF 변환', 'PDF를 md로', 'PDF 마크다운', 'convert PDF', '현재 디렉토리에 저장'.",
  parameters: {
    type: "object",
    required: ["pdfPath"],
    properties: {
      pdfPath: {
        type: "string",
        description: "Path to the PDF file (PDF 파일 경로)",
      },
      outputDir: {
        type: "string",
        description: "Output directory. Use '.' or '현재 디렉토리' for current dir. Default: .activo/standards",
      },
      singleFile: {
        type: "boolean",
        description: "Save as single markdown file instead of chunks (default: false)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      // Resolve PDF path (handle ~)
      let pdfPath = args.pdfPath as string;
      if (pdfPath.startsWith("~")) {
        pdfPath = pdfPath.replace("~", process.env.HOME || "");
      }
      pdfPath = path.resolve(pdfPath);

      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      const singleFile = args.singleFile as boolean || false;

      if (!fs.existsSync(pdfPath)) {
        return { success: false, content: "", error: `PDF not found: ${pdfPath}` };
      }

      // Extract text from PDF using pdf-parse
      const dataBuffer = fs.readFileSync(pdfPath);
      const pdfData = await pdfParse(dataBuffer);
      const text = pdfData.text;
      const numpages = pdfData.numpages;

      // Create output directory
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = path.basename(pdfPath, ".pdf");
      const extractionDate = new Date().toISOString().split("T")[0];
      const results: string[] = [];

      if (singleFile) {
        // Save as single file
        const outputFilename = `${sanitize(filename)}.md`;
        const outputPath = path.join(outputDir, outputFilename);

        let md = `# ${filename}\n\n`;
        md += `> Source: ${path.basename(pdfPath)}\n`;
        md += `> Extracted: ${extractionDate}\n`;
        md += `> Pages: ${numpages}\n`;
        md += `> Method: pdf-parse\n\n`;
        md += `---\n\n`;
        md += text;
        md += `\n\n---\n`;
        md += `[Edit this file to add structured rules]\n`;

        fs.writeFileSync(outputPath, md, "utf-8");
        results.push(outputFilename);
      } else {
        // Split into chunks
        const chunks = splitIntoChunks(text, 3000);

        for (let i = 0; i < chunks.length; i++) {
          const chunkFilename = `${String(i + 1).padStart(2, "0")}_${sanitize(filename)}.md`;
          const chunkPath = path.join(outputDir, chunkFilename);

          let md = `# ${filename} - Part ${i + 1}\n\n`;
          md += `> Source: ${path.basename(pdfPath)}\n`;
          md += `> Extracted: ${extractionDate}\n`;
          md += `> Pages: ${numpages}\n`;
          md += `> Method: pdf-parse\n\n`;
          md += `---\n\n`;
          md += chunks[i];
          md += `\n\n---\n`;
          md += `[Edit this file to add structured rules]\n`;

          fs.writeFileSync(chunkPath, md, "utf-8");
          results.push(chunkFilename);
        }

        // Create index
        const indexPath = path.join(outputDir, "_index.md");
        let indexMd = `# Development Standards Index\n\n`;
        indexMd += `> Source: ${path.basename(pdfPath)}\n`;
        indexMd += `> Extracted: ${extractionDate}\n`;
        indexMd += `> Files: ${results.length}\n`;
        indexMd += `> Method: pdf-parse\n\n`;
        indexMd += `## Files\n\n`;
        for (const r of results) {
          indexMd += `- [${r}](./${r})\n`;
        }
        fs.writeFileSync(indexPath, indexMd, "utf-8");
      }

      return {
        success: true,
        content: `PDF 변환 완료!\n\n` +
          `📂 저장 위치: ${outputDir}\n` +
          `📄 파일 수: ${results.length}\n` +
          `📖 페이지: ${numpages}\n` +
          `🔧 추출 방법: pdf-parse\n\n` +
          `파일 목록:\n${results.map(r => `  - ${r}`).join("\n")}\n\n` +
          `다음 단계: 파일을 편집하여 구조화된 규칙 추가\n` +
          `형식: ## RULE-001: Title\n- 심각도: error|warning|info\n- 규칙: description`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// List Standards Tool
export const listStandardsTool: Tool = {
  name: "list_standards",
  description: "List all loaded development standards and rules.",
  parameters: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "Standards directory (default: .activo/standards)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const dir = resolveOutputDir(args.directory as string | undefined);

      if (!fs.existsSync(dir)) {
        return { success: true, content: "No standards directory found. Import a PDF first." };
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "_index.md");
      if (files.length === 0) {
        return { success: true, content: "No standard files found." };
      }

      let totalRules = 0;
      const results: string[] = [];

      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const rules = content.match(/^## [A-Z]+-\d+/gm) || [];
        totalRules += rules.length;
        results.push(`📄 ${file}: ${rules.length} rules`);
      }

      return {
        success: true,
        content: `Standards Directory: ${dir}\n\n${results.join("\n")}\n\nTotal: ${files.length} files, ${totalRules} rules`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Check Code Quality Tool
export const checkQualityTool: Tool = {
  name: "check_code_quality",
  description: "Check code against loaded development standards.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "File or directory to check",
      },
      standardsDir: {
        type: "string",
        description: "Standards directory (default: .activo/standards)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const standardsDir = resolveOutputDir(args.standardsDir as string | undefined);

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `Path not found: ${filepath}` };
      }

      // Load standards
      let standards = "";
      if (fs.existsSync(standardsDir)) {
        const files = fs.readdirSync(standardsDir).filter((f) => f.endsWith(".md") && f !== "_index.md");
        for (const file of files) {
          standards += fs.readFileSync(path.join(standardsDir, file), "utf-8") + "\n\n";
        }
      }

      // Get code
      let code = "";
      const stat = fs.statSync(filepath);
      if (stat.isFile()) {
        code = fs.readFileSync(filepath, "utf-8");
      } else {
        return { success: false, content: "", error: "Directory check not yet supported. Specify a file." };
      }

      // Build analysis prompt
      const prompt = buildAnalysisPrompt(code, filepath, standards);

      // Call Ollama
      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      const response = await client.chat([{ role: "user", content: prompt }]);

      return { success: true, content: response.content };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Helper functions
function splitIntoChunks(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += para + "\n\n";
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9가-힣\s-]/g, "").replace(/\s+/g, "_").slice(0, 50);
}

function buildAnalysisPrompt(code: string, filepath: string, standards: string): string {
  const ext = path.extname(filepath);
  const lang = { ".ts": "typescript", ".js": "javascript", ".java": "java", ".py": "python" }[ext] || "text";

  let prompt = `당신은 코드 품질 전문가입니다. 아래 코드를 분석하세요.\n\n`;

  if (standards) {
    prompt += `[개발 표준 규칙]\n${standards.slice(0, 4000)}\n\n`;
  }

  prompt += `[분석 대상 코드]\n파일: ${filepath}\n\`\`\`${lang}\n${code.slice(0, 8000)}\n\`\`\`\n\n`;
  prompt += `[점검 요청]\n`;
  prompt += `1. 규칙 위반 사항 (있다면)\n`;
  prompt += `2. 개선 제안\n`;
  prompt += `3. 전반적인 코드 품질 평가\n`;

  return prompt;
}

// Import HWP Tool
export const importHwpTool: Tool = {
  name: "import_hwp_standards",
  description: "Import development standards from a HWP file and convert to markdown (HWP를 마크다운으로 변환). Use when user asks: 'HWP 변환', 'HWP를 md로', '한글 파일 변환', 'convert HWP'.",
  parameters: {
    type: "object",
    required: ["hwpPath"],
    properties: {
      hwpPath: {
        type: "string",
        description: "Path to the HWP file (HWP 파일 경로)",
      },
      outputDir: {
        type: "string",
        description: "Output directory. Use '.' or '현재 디렉토리' for current dir. Default: .activo/standards",
      },
      singleFile: {
        type: "boolean",
        description: "Save as single markdown file instead of chunks (default: false)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      // Resolve HWP path (handle ~)
      let hwpPath = args.hwpPath as string;
      if (hwpPath.startsWith("~")) {
        hwpPath = hwpPath.replace("~", process.env.HOME || "");
      }
      hwpPath = path.resolve(hwpPath);

      const outputDir = resolveOutputDir(args.outputDir as string | undefined);
      const singleFile = args.singleFile as boolean || false;

      if (!fs.existsSync(hwpPath)) {
        return { success: false, content: "", error: `HWP not found: ${hwpPath}` };
      }

      // Parse HWP file using @ohah/hwpjs
      const dataBuffer = fs.readFileSync(hwpPath);
      const { markdown: text } = hwpToMarkdown(dataBuffer, {
        image: "base64",
        useHtml: false,
        includeVersion: false,
        includePageInfo: false,
      });

      // Create output directory
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = path.basename(hwpPath, ".hwp");
      const extractionDate = new Date().toISOString().split("T")[0];
      const results: string[] = [];

      if (singleFile) {
        // Save as single file
        const outputFilename = `${sanitize(filename)}.md`;
        const outputPath = path.join(outputDir, outputFilename);

        let md = `# ${filename}\n\n`;
        md += `> Source: ${path.basename(hwpPath)}\n`;
        md += `> Extracted: ${extractionDate}\n`;
        md += `> Format: HWP\n`;
        md += `> Method: hwp.js\n\n`;
        md += `---\n\n`;
        md += text;
        md += `\n\n---\n`;
        md += `[Edit this file to add structured rules]\n`;

        fs.writeFileSync(outputPath, md, "utf-8");
        results.push(outputFilename);
      } else {
        // Split into chunks
        const chunks = splitIntoChunks(text, 3000);

        for (let i = 0; i < chunks.length; i++) {
          const chunkFilename = `${String(i + 1).padStart(2, "0")}_${sanitize(filename)}.md`;
          const chunkPath = path.join(outputDir, chunkFilename);

          let md = `# ${filename} - Part ${i + 1}\n\n`;
          md += `> Source: ${path.basename(hwpPath)}\n`;
          md += `> Extracted: ${extractionDate}\n`;
          md += `> Format: HWP\n`;
          md += `> Method: hwp.js\n\n`;
          md += `---\n\n`;
          md += chunks[i];
          md += `\n\n---\n`;
          md += `[Edit this file to add structured rules]\n`;

          fs.writeFileSync(chunkPath, md, "utf-8");
          results.push(chunkFilename);
        }

        // Create index
        const indexPath = path.join(outputDir, "_index.md");
        let indexMd = `# Development Standards Index\n\n`;
        indexMd += `> Source: ${path.basename(hwpPath)}\n`;
        indexMd += `> Extracted: ${extractionDate}\n`;
        indexMd += `> Files: ${results.length}\n`;
        indexMd += `> Method: hwp.js\n\n`;
        indexMd += `## Files\n\n`;
        for (const r of results) {
          indexMd += `- [${r}](./${r})\n`;
        }
        fs.writeFileSync(indexPath, indexMd, "utf-8");
      }

      return {
        success: true,
        content: `HWP 변환 완료!\n\n` +
          `📂 저장 위치: ${outputDir}\n` +
          `📄 파일 수: ${results.length}\n` +
          `📖 형식: HWP\n` +
          `🔧 추출 방법: hwp.js\n\n` +
          `파일 목록:\n${results.map(r => `  - ${r}`).join("\n")}\n\n` +
          `다음 단계: 파일을 편집하여 구조화된 규칙 추가\n` +
          `형식: ## RULE-001: Title\n- 심각도: error|warning|info\n- 규칙: description`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Index Standards for RAG
export const indexStandardsTool: Tool = {
  name: "index_standards",
  description: "Index development standards for RAG search. Run this after importing PDF/HWP files to enable semantic search.",
  parameters: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "Standards directory (default: .activo/standards)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const dir = resolveOutputDir(args.directory as string | undefined);

      if (!fs.existsSync(dir)) {
        return { success: false, content: "", error: `Standards directory not found: ${dir}` };
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "_index.md");
      if (files.length === 0) {
        return { success: false, content: "", error: "No markdown files found in standards directory" };
      }

      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      const allChunks: StandardsChunk[] = [];

      // Collect all chunks from all files
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const chunks = splitStandardsIntoChunks(content, file);
        allChunks.push(...chunks);
      }

      if (allChunks.length === 0) {
        return { success: false, content: "", error: "No valid chunks found in standards files" };
      }

      // Generate embeddings
      const embeddings: StandardsEmbedding[] = [];
      let processed = 0;

      for (const chunk of allChunks) {
        const embedding = await client.embed(chunk.content, DEFAULT_EMBED_MODEL);
        embeddings.push({
          chunk,
          embedding,
          hash: calculateHash(chunk.content),
        });
        processed++;
      }

      // Save embeddings
      saveStandardsEmbeddings(embeddings);

      // Save index
      const index: StandardsIndex = {
        version: "1.0",
        model: DEFAULT_EMBED_MODEL,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalChunks: embeddings.length,
      };
      saveStandardsIndex(index);

      return {
        success: true,
        content: `Standards indexed successfully!\n\n` +
          `📂 Directory: ${dir}\n` +
          `📄 Files: ${files.length}\n` +
          `🔖 Chunks: ${embeddings.length}\n` +
          `🧠 Model: ${DEFAULT_EMBED_MODEL}\n\n` +
          `Use 'search_standards' to find relevant rules.`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Search Standards using RAG
export const searchStandardsTool: Tool = {
  name: "search_standards",
  description: "Search development standards using semantic search (RAG). Returns relevant rules/sections based on query.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'variable naming', 'error handling', 'SQL injection')",
      },
      topK: {
        type: "number",
        description: "Number of results to return (default: 5)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const query = args.query as string;
      const topK = (args.topK as number) || 5;

      const embeddings = loadStandardsEmbeddings();
      if (embeddings.length === 0) {
        return {
          success: false,
          content: "",
          error: "No standards indexed. Run 'index_standards' first.",
        };
      }

      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      // Get query embedding
      const queryEmbedding = await client.embed(query, DEFAULT_EMBED_MODEL);

      // Calculate similarities
      const results = embeddings.map((e) => ({
        ...e,
        similarity: cosineSimilarity(queryEmbedding, e.embedding),
      }));

      // Sort by similarity and get top K
      results.sort((a, b) => b.similarity - a.similarity);
      const topResults = results.slice(0, topK);

      // Format results
      let output = `## Search Results for: "${query}"\n\n`;
      output += `Found ${topResults.length} relevant standards:\n\n`;

      for (let i = 0; i < topResults.length; i++) {
        const r = topResults[i];
        output += `### ${i + 1}. ${r.chunk.ruleId || r.chunk.section || "Section"}\n`;
        output += `📄 File: ${r.chunk.filepath}\n`;
        output += `📊 Relevance: ${(r.similarity * 100).toFixed(1)}%\n\n`;
        output += `${r.chunk.content.slice(0, 500)}${r.chunk.content.length > 500 ? "..." : ""}\n\n`;
        output += `---\n\n`;
      }

      return { success: true, content: output };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Check Code Quality with RAG
export const checkQualityWithRagTool: Tool = {
  name: "check_quality_rag",
  description: "Check code quality using RAG to find relevant standards automatically.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "File to check",
      },
      topK: {
        type: "number",
        description: "Number of relevant standards to use (default: 5)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const topK = (args.topK as number) || 5;

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }

      const embeddings = loadStandardsEmbeddings();
      if (embeddings.length === 0) {
        return {
          success: false,
          content: "",
          error: "No standards indexed. Run 'index_standards' first after importing PDF/HWP.",
        };
      }

      // Read code
      const code = fs.readFileSync(filepath, "utf-8");
      const config = loadConfig();
      const client = new OllamaClient(config.ollama);

      // Create query from code (first 1000 chars + filename)
      const queryText = `Code analysis for ${path.basename(filepath)}:\n${code.slice(0, 1000)}`;
      const queryEmbedding = await client.embed(queryText, DEFAULT_EMBED_MODEL);

      // Find relevant standards
      const results = embeddings.map((e) => ({
        ...e,
        similarity: cosineSimilarity(queryEmbedding, e.embedding),
      }));
      results.sort((a, b) => b.similarity - a.similarity);
      const relevantStandards = results.slice(0, topK);

      // Build standards context
      let standardsContext = "## Relevant Development Standards\n\n";
      for (const r of relevantStandards) {
        if (r.chunk.ruleId) {
          standardsContext += `### ${r.chunk.ruleId}: ${r.chunk.section}\n`;
        } else {
          standardsContext += `### ${r.chunk.section}\n`;
        }
        standardsContext += `${r.chunk.content}\n\n`;
      }

      // Build analysis prompt
      const ext = path.extname(filepath);
      const lang = { ".ts": "typescript", ".js": "javascript", ".java": "java", ".py": "python" }[ext] || "text";

      const prompt = `You are a code quality expert. Analyze the code based on the provided development standards.

${standardsContext}

## Code to Analyze
File: ${filepath}
\`\`\`${lang}
${code.slice(0, 6000)}
\`\`\`

## Analysis Request
1. Check for violations of the above standards
2. Provide specific line numbers if possible
3. Suggest improvements
4. Rate overall compliance (1-10)

Respond in Korean.`;

      const response = await client.chat([{ role: "user", content: prompt }]);

      return {
        success: true,
        content: `## Code Quality Analysis (RAG)\n\n` +
          `📄 File: ${filepath}\n` +
          `🔖 Standards used: ${relevantStandards.length}\n\n` +
          `---\n\n${response.content}`,
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// All standards tools
export const standardsTools: Tool[] = [
  importPdfTool,
  importHwpTool,
  listStandardsTool,
  checkQualityTool,
  indexStandardsTool,
  searchStandardsTool,
  checkQualityWithRagTool,
];
