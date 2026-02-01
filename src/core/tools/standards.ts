import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { Tool, ToolResult } from "./types.js";
import { OllamaClient } from "../llm/ollama.js";
import { loadConfig } from "../config.js";

// Import PDF Tool
export const importPdfTool: Tool = {
  name: "import_pdf_standards",
  description: "Import development standards from a PDF file and convert to markdown (PDF를 마크다운으로 변환). Use when user asks: 'PDF 변환', 'PDF를 md로', 'PDF 마크다운', 'convert PDF'.",
  parameters: {
    type: "object",
    required: ["pdfPath"],
    properties: {
      pdfPath: {
        type: "string",
        description: "Path to the PDF file",
      },
      outputDir: {
        type: "string",
        description: "Output directory (default: .activo/standards)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const pdfPath = path.resolve(args.pdfPath as string);
      const outputDir = path.resolve((args.outputDir as string) || ".activo/standards");

      if (!fs.existsSync(pdfPath)) {
        return { success: false, content: "", error: `PDF not found: ${pdfPath}` };
      }

      // Parse PDF
      const dataBuffer = fs.readFileSync(pdfPath);
      const data = await pdfParse(dataBuffer);

      // Create output directory
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Split into chunks (simple approach: by paragraphs)
      const chunks = splitIntoChunks(data.text, 3000);
      const filename = path.basename(pdfPath, ".pdf");
      const extractionDate = new Date().toISOString().split("T")[0];

      // Save chunks as markdown
      const results: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkFilename = `${String(i + 1).padStart(2, "0")}_${sanitize(filename)}.md`;
        const chunkPath = path.join(outputDir, chunkFilename);

        let md = `# ${filename} - Part ${i + 1}\n\n`;
        md += `> Source: ${path.basename(pdfPath)}\n`;
        md += `> Extracted: ${extractionDate}\n`;
        md += `> Pages: ${data.numpages}\n\n`;
        md += `---\n\n`;
        md += chunks[i];
        md += `\n\n---\n`;
        md += `[Edit this file to add structured rules]\n`;

        fs.writeFileSync(chunkPath, md);
        results.push(chunkFilename);
      }

      // Create index
      const indexPath = path.join(outputDir, "_index.md");
      let indexMd = `# Development Standards Index\n\n`;
      indexMd += `> Source: ${path.basename(pdfPath)}\n`;
      indexMd += `> Extracted: ${extractionDate}\n`;
      indexMd += `> Files: ${results.length}\n\n`;
      indexMd += `## Files\n\n`;
      for (const r of results) {
        indexMd += `- [${r}](./${r})\n`;
      }
      fs.writeFileSync(indexPath, indexMd);

      return {
        success: true,
        content: `Imported ${results.length} files to ${outputDir}\n\nFiles:\n${results.join("\n")}\n\nNext: Edit the files to add structured rules with format:\n## RULE-001: Title\n- 심각도: error|warning|info\n- 규칙: description`,
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
      const dir = path.resolve((args.directory as string) || ".activo/standards");

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
      const standardsDir = path.resolve((args.standardsDir as string) || ".activo/standards");

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

// All standards tools
export const standardsTools: Tool[] = [
  importPdfTool,
  listStandardsTool,
  checkQualityTool,
];
