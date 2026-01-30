import chalk from "chalk";
import fs from "fs";
import path from "path";
import ora from "ora";
import { parsePDF } from "../../core/standards/pdf-parser.js";
import { splitIntoChunks } from "../../core/standards/chunk-splitter.js";
import {
  extractRulesFromChunk,
  generateMarkdown,
  generateIndexMarkdown,
  sanitizeFilename,
  ExtractionResult,
} from "../../core/standards/rule-extractor.js";
import { OllamaClient } from "../../core/llm/ollama.js";

export async function standards(action: string, targetPath?: string): Promise<void> {
  switch (action) {
    case "import":
      await importStandards(targetPath);
      break;
    case "list":
      await listStandards();
      break;
    case "validate":
      await validateStandards();
      break;
    default:
      console.log(chalk.yellow("Usage:"));
      console.log("  activo standards import <pdf>  Import standards from PDF");
      console.log("  activo standards list          List loaded standards");
      console.log("  activo standards validate      Validate standards files");
  }
}

async function importStandards(pdfPath?: string): Promise<void> {
  if (!pdfPath) {
    console.log(chalk.red("Error: PDF path required"));
    console.log(chalk.yellow("Usage: activo standards import <pdf>"));
    return;
  }

  if (!fs.existsSync(pdfPath)) {
    console.log(chalk.red(`Error: File not found: ${pdfPath}`));
    return;
  }

  console.log(chalk.bold.cyan("\n📄 PDF Import\n"));

  // Step 1: Parse PDF
  const parseSpinner = ora("Parsing PDF...").start();
  let pdfResult;

  try {
    pdfResult = await parsePDF(pdfPath);
    parseSpinner.succeed(`Parsed: ${pdfResult.filename} (${pdfResult.totalPages} pages)`);
  } catch (error) {
    parseSpinner.fail("Failed to parse PDF");
    console.log(chalk.red(`Error: ${error}`));
    return;
  }

  // Step 2: Split into chunks
  const chunkSpinner = ora("Splitting into chunks...").start();
  const chunks = splitIntoChunks(pdfResult, {
    maxChunkSize: 4000,
    preferTocSplit: true,
  });
  chunkSpinner.succeed(`Split into ${chunks.length} chunks`);

  // Show chunk preview
  console.log(chalk.dim("\nChunks:"));
  for (const chunk of chunks) {
    console.log(chalk.dim(`  ${chunk.id}. ${chunk.title} (${chunk.charCount} chars)`));
  }

  // Step 3: Initialize Ollama
  const client = new OllamaClient();
  const isConnected = await client.isConnected();

  if (!isConnected) {
    console.log(chalk.red("\n✗ Cannot connect to Ollama"));
    console.log(chalk.yellow("Make sure Ollama is running: ollama serve"));
    console.log(chalk.yellow("\nSaving raw chunks without rule extraction..."));

    // Save raw chunks without extraction
    await saveRawChunks(chunks, pdfResult.filename);
    return;
  }

  // Step 4: Extract rules from each chunk
  console.log(chalk.cyan("\nExtracting rules with Ollama...\n"));

  const results: ExtractionResult[] = [];

  for (const chunk of chunks) {
    const spinner = ora(`Processing chunk ${chunk.id}/${chunks.length}: ${chunk.title}`).start();

    try {
      const result = await extractRulesFromChunk(chunk, client);
      results.push(result);
      spinner.succeed(
        `Chunk ${chunk.id}: ${result.rules.length} rules extracted`
      );
    } catch (error) {
      spinner.fail(`Chunk ${chunk.id}: Error`);
      console.log(chalk.red(`  ${error}`));

      // Add empty result
      results.push({
        chunkId: chunk.id,
        chunkTitle: chunk.title,
        rules: [],
        rawContent: chunk.content,
      });
    }
  }

  // Step 5: Save to .activo/standards/
  await saveResults(results, pdfResult.filename);

  // Summary
  const totalRules = results.reduce((sum, r) => sum + r.rules.length, 0);
  console.log(chalk.bold.green("\n✓ Import complete!"));
  console.log(chalk.cyan(`  Files: ${results.length + 1}`));
  console.log(chalk.cyan(`  Rules: ${totalRules}`));
  console.log(chalk.cyan(`  Location: .activo/standards/`));

  console.log(chalk.yellow("\n[다음 단계]"));
  console.log("1. 생성된 MD 파일을 에디터로 확인하세요");
  console.log("2. 잘못 추출된 규칙은 직접 수정/삭제하세요");
  console.log("3. 누락된 규칙은 수동으로 추가하세요");
  console.log(chalk.dim("\n$ code .activo/standards/  # VS Code로 열기"));
}

async function saveRawChunks(
  chunks: Array<{ id: number; title: string; content: string; startPage: number; endPage: number }>,
  sourceFilename: string
): Promise<void> {
  const standardsDir = path.join(process.cwd(), ".activo", "standards");

  if (!fs.existsSync(standardsDir)) {
    fs.mkdirSync(standardsDir, { recursive: true });
  }

  const extractionDate = new Date().toISOString().split("T")[0];

  // Save each chunk as raw markdown
  for (const chunk of chunks) {
    const filename = `${String(chunk.id).padStart(2, "0")}_${sanitizeFilename(chunk.title)}.md`;
    const filepath = path.join(standardsDir, filename);

    let md = `# ${chunk.title}\n\n`;
    md += `> 원본: ${sourceFilename} (페이지 ${chunk.startPage}-${chunk.endPage})\n`;
    md += `> 추출일: ${extractionDate}\n`;
    md += `> 상태: 규칙 추출 미완료 (수동 편집 필요)\n\n`;
    md += `---\n\n`;
    md += chunk.content;
    md += `\n\n---\n`;
    md += `[이 파일을 편집하여 규칙을 추가하세요]\n`;

    fs.writeFileSync(filepath, md);
  }

  // Save index
  const indexPath = path.join(standardsDir, "_index.md");
  let indexMd = `# 개발 표준 규칙 목록\n\n`;
  indexMd += `> 원본: ${sourceFilename}\n`;
  indexMd += `> 추출일: ${extractionDate}\n`;
  indexMd += `> 상태: 규칙 추출 미완료 (Ollama 연결 필요)\n\n`;
  indexMd += `## 파일 목록\n\n`;

  for (const chunk of chunks) {
    const filename = `${String(chunk.id).padStart(2, "0")}_${sanitizeFilename(chunk.title)}.md`;
    indexMd += `- [${chunk.title}](./${filename})\n`;
  }

  fs.writeFileSync(indexPath, indexMd);

  console.log(chalk.green(`\n✓ Saved ${chunks.length + 1} files to .activo/standards/`));
}

async function saveResults(
  results: ExtractionResult[],
  sourceFilename: string
): Promise<void> {
  const standardsDir = path.join(process.cwd(), ".activo", "standards");

  if (!fs.existsSync(standardsDir)) {
    fs.mkdirSync(standardsDir, { recursive: true });
  }

  const extractionDate = new Date().toISOString().split("T")[0];

  // Save each chunk as markdown
  for (const result of results) {
    const filename = `${String(result.chunkId).padStart(2, "0")}_${sanitizeFilename(result.chunkTitle)}.md`;
    const filepath = path.join(standardsDir, filename);
    const content = generateMarkdown(result, sourceFilename, extractionDate);
    fs.writeFileSync(filepath, content);
  }

  // Save index
  const indexPath = path.join(standardsDir, "_index.md");
  const indexContent = generateIndexMarkdown(results, sourceFilename, extractionDate);
  fs.writeFileSync(indexPath, indexContent);
}

async function listStandards(): Promise<void> {
  const standardsDir = path.join(process.cwd(), ".activo", "standards");

  if (!fs.existsSync(standardsDir)) {
    console.log(chalk.yellow("\nNo standards directory found."));
    console.log(chalk.dim("Run 'activo standards import <pdf>' to import standards"));
    return;
  }

  const files = fs.readdirSync(standardsDir).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    console.log(chalk.yellow("\nNo standards files found."));
    console.log(chalk.dim(`Add .md files to ${standardsDir}`));
    return;
  }

  console.log(chalk.bold.cyan("\n📋 Development Standards\n"));
  console.log(chalk.dim(`Directory: ${standardsDir}\n`));

  let totalRules = 0;
  const categories: Record<string, number> = {};

  for (const file of files) {
    if (file === "_index.md") continue;

    const filepath = path.join(standardsDir, file);
    const content = fs.readFileSync(filepath, "utf-8");

    // Count rules (lines starting with ## followed by rule ID pattern)
    const rules = content.match(/^## [A-Z]+-\d+/gm) || [];
    totalRules += rules.length;

    // Extract categories
    const categoryMatches = content.matchAll(/카테고리:\s*(.+)/g);
    for (const match of categoryMatches) {
      const cat = match[1].trim();
      categories[cat] = (categories[cat] || 0) + 1;
    }

    const severityError = (content.match(/심각도:\s*error/gi) || []).length;
    const severityWarning = (content.match(/심각도:\s*warning/gi) || []).length;
    const severityInfo = (content.match(/심각도:\s*info/gi) || []).length;

    console.log(chalk.cyan(`📄 ${file}`));
    console.log(chalk.dim(`   ${rules.length} rules`));
    if (rules.length > 0) {
      console.log(
        chalk.dim(`   🔴 ${severityError} error | 🟡 ${severityWarning} warning | 🔵 ${severityInfo} info`)
      );
    }
  }

  console.log(chalk.bold(`\n📊 Summary`));
  console.log(`  Total files: ${files.length - (files.includes("_index.md") ? 1 : 0)}`);
  console.log(`  Total rules: ${totalRules}`);

  if (Object.keys(categories).length > 0) {
    console.log(`\n  Categories:`);
    for (const [cat, count] of Object.entries(categories)) {
      console.log(`    - ${cat}: ${count}`);
    }
  }
}

async function validateStandards(): Promise<void> {
  const standardsDir = path.join(process.cwd(), ".activo", "standards");

  if (!fs.existsSync(standardsDir)) {
    console.log(chalk.red("\nNo standards directory found."));
    return;
  }

  const files = fs.readdirSync(standardsDir).filter((f) => f.endsWith(".md") && f !== "_index.md");

  if (files.length === 0) {
    console.log(chalk.yellow("\nNo standards files to validate."));
    return;
  }

  console.log(chalk.bold.cyan("\n🔍 Validating Standards\n"));

  let hasErrors = false;
  const ruleIds = new Set<string>();
  const duplicates: string[] = [];

  for (const file of files) {
    const filepath = path.join(standardsDir, file);
    const content = fs.readFileSync(filepath, "utf-8");
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for rule ID format
    const rules = content.match(/^## ([A-Z]+-\d+)/gm) || [];

    for (const rule of rules) {
      const id = rule.replace("## ", "");
      if (ruleIds.has(id)) {
        duplicates.push(`${id} (in ${file})`);
      }
      ruleIds.add(id);
    }

    // Check for severity
    const severityPattern = /심각도:\s*(error|warning|info)/gi;
    const severities = content.match(severityPattern) || [];

    if (rules.length > 0 && severities.length < rules.length) {
      warnings.push(`Missing severity for some rules (${severities.length}/${rules.length})`);
    }

    // Check for empty content
    if (content.trim().length < 100) {
      warnings.push("File content seems too short");
    }

    // Check for required sections
    if (rules.length === 0 && !content.includes("규칙을 찾을 수 없습니다")) {
      warnings.push("No rules found in file");
    }

    if (errors.length > 0) {
      hasErrors = true;
      console.log(chalk.red(`✗ ${file}`));
      errors.forEach((e) => console.log(chalk.red(`  ✗ ${e}`)));
      warnings.forEach((w) => console.log(chalk.yellow(`  ⚠ ${w}`)));
    } else if (warnings.length > 0) {
      console.log(chalk.yellow(`⚠ ${file}`));
      warnings.forEach((w) => console.log(chalk.yellow(`  ⚠ ${w}`)));
    } else {
      console.log(chalk.green(`✓ ${file}`));
    }
  }

  if (duplicates.length > 0) {
    hasErrors = true;
    console.log(chalk.red(`\n⚠️  Duplicate rule IDs found:`));
    duplicates.forEach((id) => console.log(chalk.dim(`  - ${id}`)));
  }

  console.log("");
  if (!hasErrors) {
    console.log(chalk.green("✓ All standards files are valid"));
  } else {
    console.log(chalk.yellow("⚠ Some issues found. Please review the files."));
  }
}
