import chalk from "chalk";
import fs from "fs";
import path from "path";

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

  console.log(chalk.cyan("\n📄 PDF Import"));
  console.log(chalk.dim(`Source: ${pdfPath}`));
  console.log(chalk.yellow("\n⚠️  PDF import will be implemented in Phase 2"));
  console.log(chalk.dim("For now, you can manually create MD files in .activo/standards/"));

  // Create standards directory
  const standardsDir = path.join(process.cwd(), ".activo", "standards");
  if (!fs.existsSync(standardsDir)) {
    fs.mkdirSync(standardsDir, { recursive: true });
    console.log(chalk.green(`\n✓ Created: ${standardsDir}`));
  }

  console.log(chalk.cyan("\nExpected MD format:"));
  console.log(chalk.dim(`
# 규칙 카테고리명

## RULE-001: 규칙 제목
- 심각도: error | warning | info
- 규칙: 규칙 설명
- 예시: 좋은 예시 (O), 나쁜 예시 (X)
`));
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

  for (const file of files) {
    const filepath = path.join(standardsDir, file);
    const content = fs.readFileSync(filepath, "utf-8");

    // Count rules (lines starting with ## followed by rule ID pattern)
    const rules = content.match(/^## [A-Z]+-\d+/gm) || [];
    totalRules += rules.length;

    console.log(chalk.cyan(`📄 ${file}`));
    console.log(chalk.dim(`   ${rules.length} rules`));
  }

  console.log(chalk.bold(`\nTotal: ${files.length} files, ${totalRules} rules`));
}

async function validateStandards(): Promise<void> {
  const standardsDir = path.join(process.cwd(), ".activo", "standards");

  if (!fs.existsSync(standardsDir)) {
    console.log(chalk.red("\nNo standards directory found."));
    return;
  }

  const files = fs.readdirSync(standardsDir).filter((f) => f.endsWith(".md"));

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

    // Check for rule ID format
    const rules = content.match(/^## ([A-Z]+-\d+)/gm) || [];

    for (const rule of rules) {
      const id = rule.replace("## ", "");
      if (ruleIds.has(id)) {
        duplicates.push(id);
      }
      ruleIds.add(id);
    }

    // Check for severity
    const severityPattern = /심각도:\s*(error|warning|info)/g;
    const severities = content.match(severityPattern) || [];

    if (rules.length > 0 && severities.length < rules.length) {
      errors.push(`Missing severity for some rules (${severities.length}/${rules.length})`);
    }

    if (errors.length > 0) {
      hasErrors = true;
      console.log(chalk.red(`✗ ${file}`));
      errors.forEach((e) => console.log(chalk.dim(`  - ${e}`)));
    } else {
      console.log(chalk.green(`✓ ${file}`));
    }
  }

  if (duplicates.length > 0) {
    hasErrors = true;
    console.log(chalk.red(`\n⚠️  Duplicate rule IDs found:`));
    duplicates.forEach((id) => console.log(chalk.dim(`  - ${id}`)));
  }

  if (!hasErrors) {
    console.log(chalk.green("\n✓ All standards files are valid"));
  }
}
