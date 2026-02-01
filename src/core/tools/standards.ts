import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { toMarkdown as hwpToMarkdown } from "@ohah/hwpjs";
import { Tool, ToolResult } from "./types.js";
import { OllamaClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";

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

// All standards tools
export const standardsTools: Tool[] = [
  importPdfTool,
  importHwpTool,
  listStandardsTool,
  checkQualityTool,
];
