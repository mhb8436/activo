import chalk from "chalk";
import fs from "fs";
import path from "path";
import ora from "ora";
import { OllamaClient } from "../../core/llm/ollama.js";

interface CheckOptions {
  strict?: boolean;
  focus?: string;
}

function loadStandards(): string {
  const standardsDir = path.join(process.cwd(), ".activo", "standards");

  if (!fs.existsSync(standardsDir)) {
    return "";
  }

  const files = fs.readdirSync(standardsDir).filter((f) => f.endsWith(".md"));
  let content = "";

  for (const file of files) {
    const filepath = path.join(standardsDir, file);
    content += fs.readFileSync(filepath, "utf-8") + "\n\n";
  }

  return content;
}

function buildPrompt(code: string, filepath: string, standards: string, options: CheckOptions): string {
  const ext = path.extname(filepath);
  const language = getLanguageFromExt(ext);

  let prompt = `당신은 코드 품질 전문가입니다.
아래 개발표준 규칙에 따라 코드를 점검하세요.

`;

  if (standards) {
    prompt += `[개발표준 규칙]
${standards}

`;
  }

  prompt += `[분석 대상 코드]
파일: ${filepath}
언어: ${language}

\`\`\`${language}
${code}
\`\`\`

[점검 요청]
위 코드가 개발표준을 위반하는 부분을 찾고, 각 위반에 대해 다음을 설명하세요:
1. 위반 규칙 ID (없으면 일반적인 규칙명)
2. 위반 위치 (라인 번호)
3. 위반 이유
4. 수정 방안

`;

  if (options.strict) {
    prompt += `엄격 모드: 사소한 스타일 위반도 모두 보고하세요.\n`;
  }

  if (options.focus) {
    prompt += `집중 영역: ${options.focus} 관련 규칙만 점검하세요.\n`;
  }

  prompt += `
결과는 다음 형식으로 출력하세요:

## 점검 결과

### [심각도] 규칙ID: 요약
- 위치: 라인 N
- 문제: 설명
- 해결: 제안

위반 사항이 없으면 "✓ 모든 규칙을 준수합니다"라고 출력하세요.`;

  return prompt;
}

function getLanguageFromExt(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".java": "java",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".c": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
  };

  return map[ext] || "text";
}

export async function check(targetPath: string, options: CheckOptions = {}): Promise<void> {
  // Resolve path
  const resolvedPath = path.resolve(targetPath);

  if (!fs.existsSync(resolvedPath)) {
    console.log(chalk.red(`Error: Path not found: ${resolvedPath}`));
    return;
  }

  const stat = fs.statSync(resolvedPath);
  const files: string[] = [];

  if (stat.isDirectory()) {
    // Find all code files in directory
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".java", ".py", ".go"];
    const findFiles = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          findFiles(fullPath);
        } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };
    findFiles(resolvedPath);
  } else {
    files.push(resolvedPath);
  }

  if (files.length === 0) {
    console.log(chalk.yellow("No code files found to check."));
    return;
  }

  console.log(chalk.bold.cyan("\n🔍 Code Quality Check\n"));
  console.log(chalk.dim(`Files to check: ${files.length}`));
  if (options.strict) console.log(chalk.dim("Mode: Strict"));
  if (options.focus) console.log(chalk.dim(`Focus: ${options.focus}`));
  console.log("");

  // Load standards
  const standards = loadStandards();
  if (!standards) {
    console.log(chalk.yellow("⚠️  No development standards loaded."));
    console.log(chalk.dim("Run 'activo standards import <pdf>' to import standards\n"));
  }

  // Initialize Ollama
  const client = new OllamaClient();
  const isConnected = await client.isConnected();

  if (!isConnected) {
    console.log(chalk.red("✗ Cannot connect to Ollama"));
    console.log(chalk.yellow("Make sure Ollama is running: ollama serve"));
    return;
  }

  // Check each file
  for (const file of files) {
    const relativePath = path.relative(process.cwd(), file);
    const spinner = ora(`Checking ${relativePath}`).start();

    try {
      const code = fs.readFileSync(file, "utf-8");

      // Skip very large files
      if (code.length > 50000) {
        spinner.warn(`${relativePath} (skipped - too large)`);
        continue;
      }

      const prompt = buildPrompt(code, relativePath, standards, options);

      const response = await client.chat([
        { role: "user", content: prompt },
      ]);

      spinner.stop();
      console.log(chalk.cyan(`\n📄 ${relativePath}`));
      console.log(chalk.dim("─".repeat(50)));
      console.log(response.content);
      console.log("");
    } catch (error) {
      spinner.fail(`${relativePath} (error)`);
      console.log(chalk.red(`  Error: ${error}`));
    }
  }

  console.log(chalk.bold.cyan("\n✓ Check complete\n"));
}
