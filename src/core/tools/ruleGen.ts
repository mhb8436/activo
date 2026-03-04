import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Tool, ToolResult } from "./types.js";
import { createLLMClient } from "./apexUtils.js";
import type { LLMClient } from "../llm/types.js";

// ─── Interfaces ───

interface PatternTypeInfo {
  type: string;
  description: string;
  languages: string[];
  example: string; // YAML example text
}

interface ExistingRule {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface StandardItem {
  filepath: string;
  section: string;
  ruleId?: string;
  content: string;
}

interface ClassificationResult {
  classification: "yaml" | "manual" | "matched";
  ruleYaml?: string;      // for "yaml"
  reason?: string;         // for "manual"
  matchedRule?: string;    // for "matched"
  standardItem: StandardItem;
}

interface GenerationSummary {
  totalItems: number;
  yamlRules: number;
  manualRules: number;
  matchedRules: number;
  errors: number;
  outputDir: string;
}

// ─── YAML Validation ───

const VALID_PATTERN_TYPES = [
  "regex", "regex-multiline", "ast-filtered-regex", "annotation-missing-attr",
  "line-length", "ast-method-call", "ast-annotation", "ast-import",
  "ast-variable", "ast-try-catch", "ast-class", "ast-method",
  "ast-multi-cud", "ast-dead-code",
  "ast-sql-table", "ast-sql-join", "ast-sql-select", "ast-sql-where",
  "ast-sql-subquery", "ast-sql-hint", "ast-sql-setop", "ast-sql-orderby",
];

const VALID_SEVERITIES = ["low", "medium", "high", "critical"];

function validateRuleYaml(yamlText: string): { valid: boolean; error?: string; parsed?: Record<string, unknown> } {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (e) {
    return { valid: false, error: `YAML 파싱 실패: ${e}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { valid: false, error: "YAML이 객체가 아닙니다" };
  }

  const rule = parsed as Record<string, unknown>;

  // Required fields
  for (const field of ["id", "name", "severity", "category", "description", "enabled", "pattern"]) {
    if (rule[field] === undefined) {
      return { valid: false, error: `필수 필드 누락: ${field}` };
    }
  }

  // ID convention
  if (typeof rule.id !== "string" || !rule.id.startsWith("custom-")) {
    return { valid: false, error: `ID는 'custom-' 접두사 필요: ${rule.id}` };
  }

  // Severity
  if (!VALID_SEVERITIES.includes(rule.severity as string)) {
    return { valid: false, error: `잘못된 severity: ${rule.severity}` };
  }

  // Pattern type
  const pattern = rule.pattern as Record<string, unknown>;
  if (!pattern || typeof pattern !== "object" || !pattern.type) {
    return { valid: false, error: "pattern.type 누락" };
  }
  if (!VALID_PATTERN_TYPES.includes(pattern.type as string)) {
    return { valid: false, error: `잘못된 pattern.type: ${pattern.type}` };
  }

  // Regex validation (for regex-based types)
  if (["regex", "regex-multiline", "ast-filtered-regex"].includes(pattern.type as string)) {
    if (!pattern.regex || typeof pattern.regex !== "string") {
      return { valid: false, error: "regex 타입에 regex 필드 필요" };
    }
    try {
      new RegExp(pattern.regex as string);
    } catch (e) {
      return { valid: false, error: `잘못된 정규식: ${e}` };
    }
  }

  return { valid: true, parsed: rule };
}

// ─── Context Size Profiles ───

const REGEX_ONLY_TYPES = ["regex", "regex-multiline", "ast-filtered-regex"];

interface ContextProfile {
  strategy: "one-step" | "two-step";  // one-step: 분류+생성 동시, two-step: 선별→생성
  schemaFilterTypes: string[] | null; // null = all types
  maxExistingRules: number;
  existingRulesCompact: boolean;      // true = ID only, false = full
  maxItemsChars: number;
  maxItemContentChars: number;
}

const CONTEXT_PROFILES: Record<string, ContextProfile> = {
  full: {
    strategy: "one-step",
    schemaFilterTypes: null,
    maxExistingRules: 30,
    existingRulesCompact: false,
    maxItemsChars: 4000,
    maxItemContentChars: 1200,
  },
  compact: {
    strategy: "two-step",
    schemaFilterTypes: REGEX_ONLY_TYPES,
    maxExistingRules: 50,
    existingRulesCompact: true,
    maxItemsChars: 1500,
    maxItemContentChars: 300,
  },
};

function getContextProfile(provider: string): ContextProfile {
  return provider === "ollama" ? CONTEXT_PROFILES.compact : CONTEXT_PROFILES.full;
}

// ─── Schema Loading ───

function loadRuleSchema(schemaPath: string, filterTypes?: string[]): PatternTypeInfo[] {
  const content = fs.readFileSync(schemaPath, "utf-8");
  const schema = yaml.load(content) as Record<string, unknown>;
  const patternTypes = schema.pattern_types as Array<Record<string, unknown>>;

  if (!Array.isArray(patternTypes)) {
    return [];
  }

  let result = patternTypes.map((pt) => ({
    type: pt.type as string,
    description: pt.description as string,
    languages: (pt.languages as string[]) || [],
    example: typeof pt.example === "string"
      ? pt.example
      : yaml.dump(pt.example, { lineWidth: 120 }),
  }));

  if (filterTypes) {
    result = result.filter((pt) => filterTypes.includes(pt.type));
  }

  return result;
}

// ─── Existing Rules Loading ───

function loadExistingRules(rulesetsDir: string): ExistingRule[] {
  const rules: ExistingRule[] = [];

  if (!fs.existsSync(rulesetsDir)) return rules;

  const files = fs.readdirSync(rulesetsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(rulesetsDir, file), "utf-8");
      const data = yaml.load(content) as Record<string, unknown>;
      const languages = data.languages as Array<Record<string, unknown>>;

      if (!Array.isArray(languages)) continue;

      for (const lang of languages) {
        const langRules = lang.rules as Array<Record<string, unknown>>;
        if (!Array.isArray(langRules)) continue;

        for (const r of langRules) {
          rules.push({
            id: r.id as string,
            name: r.name as string,
            description: (r.description as string) || "",
            category: (r.category as string) || "",
          });
        }
      }
    } catch {
      // Skip invalid YAML files
    }
  }

  return rules;
}

// ─── Standards Loading ───

function loadStandardItems(standardsDir: string): StandardItem[] {
  const items: StandardItem[] = [];

  if (!fs.existsSync(standardsDir)) return items;

  const files = fs.readdirSync(standardsDir)
    .filter((f) => f.endsWith(".md") && f !== "_index.md")
    .sort();

  // Group files by PDF source: strip leading number prefix to get base name
  // e.g., "01_FTSS-DES-D299--v01.md" ~ "08_FTSS-DES-D299--v01.md" → "FTSS-DES-D299--v01.md"
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const baseName = file.replace(/^\d+[_-]/, "");
    if (!groups.has(baseName)) groups.set(baseName, []);
    groups.get(baseName)!.push(file);
  }

  for (const [baseName, groupFiles] of groups) {
    if (groupFiles.length > 1) {
      // Multiple parts from same PDF — merge into one string
      const merged = groupFiles.map((f) => {
        return fs.readFileSync(path.join(standardsDir, f), "utf-8");
      }).join("\n");
      const filepath = path.join(standardsDir, baseName);
      console.log(`[ruleGen] merged ${groupFiles.length} parts for ${baseName}`);
      const chunks = splitStandardsIntoChunks(merged, filepath);
      items.push(...chunks);
    } else {
      // Single file — process as-is
      const filepath = path.join(standardsDir, groupFiles[0]);
      const content = fs.readFileSync(filepath, "utf-8");
      const chunks = splitStandardsIntoChunks(content, filepath);
      items.push(...chunks);
    }
  }

  return items;
}

function splitStandardsIntoChunks(content: string, filepath: string): StandardItem[] {
  // ── Step 1: Remove noise lines ──
  const cleanedLines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    // Remove "# Part N" titles
    if (/^#\s+.*Part\s+\d+/i.test(trimmed)) return false;
    // Remove "> Source:" and "> Extracted:" metadata
    if (/^>\s*(Source|Extracted|Page|Date):/.test(trimmed)) return false;
    // Remove "---" separators
    if (trimmed === "---") return false;
    // Remove page numbers like "8 / 23"
    if (/^\d+\s*\/\s*\d+$/.test(trimmed)) return false;
    // Remove "[Edit this file...]" placeholders
    if (/^\[Edit\s+this\s+file/i.test(trimmed)) return false;
    // Remove TOC lines with dots (2.1 주석 규칙 ·····  3)
    if (/·{5,}/.test(trimmed)) return false;
    return true;
  });

  const cleanedContent = cleanedLines.join("\n");

  // ── Step 2: Split by numbered sections (2.1, 2.3.4, etc.) ──
  // Pattern: line starts with digit.digit (at least one dot), then Korean/English title
  const sectionPattern = /^(\d+(?:\.\d+)+)\s+([가-힣A-Za-z].*)/;

  const chunks: StandardItem[] = [];
  let currentSection = "";
  let currentRuleId: string | undefined;
  let currentContent: string[] = [];

  for (const line of cleanedContent.split("\n")) {
    // Pattern 1: Structured rule ID (## NR-001: Title)
    const ruleMatch = line.match(/^##\s+([A-Z]+-\d+):\s*(.+)/i);
    // Pattern 2: Numbered section heading (2.1 주석 규칙, 2.3.4 각종 선언)
    const numberedMatch = line.match(sectionPattern);

    if (ruleMatch) {
      flushChunk();
      currentRuleId = ruleMatch[1];
      currentSection = ruleMatch[2];
      currentContent = [line];
    } else if (numberedMatch) {
      const sectionNumber = numberedMatch[1];
      const title = numberedMatch[2].trim();
      // Skip section 1.x (overview, not coding rules)
      if (!sectionNumber.startsWith("1.")) {
        flushChunk();
        currentRuleId = undefined;
        currentSection = `${sectionNumber} ${title}`;
        currentContent = [line];
      } else {
        currentContent.push(line);
      }
    } else {
      currentContent.push(line);
    }
  }

  flushChunk();

  // ── Step 3: Filter out empty/useless chunks ──
  return chunks.filter((c) => {
    // Actual text content (strip markdown formatting and whitespace)
    const textOnly = c.content.replace(/[>\-#*`\s\n]/g, "");
    // Must have at least 20 chars of real content
    if (textOnly.length < 20) return false;
    // Skip section 1.x (overview)
    if (/^1\.\d/.test(c.section)) return false;
    // Skip chunks with no section name (metadata/cover page before first numbered section)
    if (!c.section && !c.ruleId) return false;
    // Skip metadata content (Document ID, Document Version, 승인내역, etc.)
    if (/Document\s+(ID|Version)\s*:/.test(c.content)) return false;
    // Skip TOC-only content (all meaningful lines contain ·····)
    const nonEmptyLines = c.content.split("\n").filter((l) => l.trim().length > 0);
    const tocLines = nonEmptyLines.filter((l) => /·{3,}/.test(l));
    if (tocLines.length > nonEmptyLines.length * 0.5) return false;
    return true;
  });

  function flushChunk() {
    if (currentContent.length > 0) {
      const text = currentContent.join("\n").trim();
      if (text) {
        chunks.push({ filepath, section: currentSection, ruleId: currentRuleId, content: text });
      }
    }
  }
}

// ─── Category Grouping ───

function groupByCategory(items: StandardItem[]): Map<string, StandardItem[]> {
  const groups = new Map<string, StandardItem[]>();

  const categoryPatterns: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /naming|명명|네이밍|이름/i, category: "naming" },
    { pattern: /security|보안|시큐어|취약/i, category: "security" },
    { pattern: /exception|예외|에러|error/i, category: "exception" },
    { pattern: /performance|성능|퍼포먼스/i, category: "performance" },
    { pattern: /transaction|트랜잭션/i, category: "transaction" },
    { pattern: /logging|로그|로깅/i, category: "logging" },
    { pattern: /sql|쿼리|query|mybatis/i, category: "sql" },
    { pattern: /design|설계|구조|아키텍처|architecture/i, category: "design" },
    { pattern: /format|포맷|들여쓰기|indent/i, category: "format" },
    { pattern: /document|주석|comment|javadoc/i, category: "documentation" },
    { pattern: /deprecated|비추천|폐기/i, category: "deprecated" },
    { pattern: /import|패키지|package/i, category: "import" },
    { pattern: /resource|리소스|자원/i, category: "resource" },
    { pattern: /api|REST|엔드포인트/i, category: "api" },
  ];

  for (const item of items) {
    const text = `${item.section} ${item.content}`.toLowerCase();
    let matched = false;

    for (const { pattern, category } of categoryPatterns) {
      if (pattern.test(text)) {
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category)!.push(item);
        matched = true;
        break;
      }
    }

    if (!matched) {
      if (!groups.has("general")) groups.set("general", []);
      groups.get("general")!.push(item);
    }
  }

  return groups;
}

// ─── Pattern Type Selection ───

function selectPatternTypes(category: string, allTypes: PatternTypeInfo[]): PatternTypeInfo[] {
  const categoryTypeMap: Record<string, string[]> = {
    naming: ["regex", "ast-variable", "ast-class"],
    security: ["ast-filtered-regex", "ast-method-call", "regex"],
    exception: ["ast-try-catch", "ast-method-call", "regex"],
    performance: ["ast-method-call", "ast-sql-select", "regex"],
    transaction: ["ast-multi-cud", "ast-annotation", "regex-multiline"],
    logging: ["regex", "ast-filtered-regex", "ast-method-call"],
    sql: ["ast-sql-table", "ast-sql-join", "ast-sql-where", "regex-multiline"],
    design: ["ast-class", "ast-method", "ast-annotation"],
    format: ["line-length", "regex", "regex-multiline"],
    documentation: ["regex", "ast-class", "ast-method"],
    deprecated: ["ast-import", "ast-method-call", "regex"],
    import: ["ast-import", "regex"],
    resource: ["ast-try-catch", "ast-method-call", "regex"],
    api: ["ast-annotation", "annotation-missing-attr", "regex"],
    general: ["regex", "ast-filtered-regex", "ast-method-call"],
  };

  const typeNames = categoryTypeMap[category] || categoryTypeMap.general;
  return typeNames
    .map((name) => allTypes.find((t) => t.type === name))
    .filter((t): t is PatternTypeInfo => t !== undefined)
    .slice(0, 3);
}

// ─── LLM Prompt & Parsing ───

function buildBatchPrompt(
  items: StandardItem[],
  patternTypes: PatternTypeInfo[],
  existingRules: ExistingRule[],
  profile: ContextProfile,
): string {
  // Combine items text (profile-aware max chars)
  let itemsText = items.map((item, i) => {
    const id = item.ruleId || `ITEM-${i + 1}`;
    return `[${id}] ${item.section}\n${item.content.slice(0, profile.maxItemContentChars)}`;
  }).join("\n---\n");

  if (itemsText.length > profile.maxItemsChars) {
    itemsText = itemsText.slice(0, profile.maxItemsChars) + "\n...(truncated)";
  }

  // Pattern types info
  const typesText = patternTypes.map((pt) => {
    return `### ${pt.type}\n${pt.description}\nExample:\n${pt.example}`;
  }).join("\n\n");

  // Existing rules — compact (ID only) or full
  let existingText: string;
  if (profile.existingRulesCompact) {
    // Compact: group IDs by category, no name/description
    const byCategory = new Map<string, string[]>();
    for (const r of existingRules.slice(0, profile.maxExistingRules)) {
      const cat = r.category || "other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(r.id);
    }
    existingText = Array.from(byCategory.entries())
      .map(([cat, ids]) => `${cat}: ${ids.join(", ")}`)
      .join("\n");
  } else {
    existingText = existingRules.slice(0, profile.maxExistingRules).map((r) => {
      return `- ${r.id}: ${r.name} (${r.category})`;
    }).join("\n");
  }

  const prompt = `You are an APEX rule generator. For each standard item below, classify it and optionally generate a YAML rule.

## Standard Items
${itemsText}

## Available Pattern Types (use ONLY these)
${typesText}

## Existing Rules (check for duplicates)
${existingText}

## Instructions
For EACH standard item (identified by [RULE-XXX] or [ITEM-N]), output ONE classification:

A) If the item can be detected with a YAML pattern:
ITEM: [id]
CLASSIFICATION: yaml
RULE_YAML:
\`\`\`yaml
- id: "custom-{category}-{number}"
  name: "규칙 이름"
  severity: "low|medium|high|critical"
  category: "카테고리"
  description: "설명"
  enabled: true
  pattern:
    type: "{pattern_type}"
    ...pattern params...
\`\`\`

B) If the item requires Go code or complex logic:
ITEM: [id]
CLASSIFICATION: manual
REASON: (why it can't be YAML)

C) If an existing rule already covers this:
ITEM: [id]
CLASSIFICATION: matched
MATCHED_RULE: (existing rule ID)

## IMPORTANT
- Skip items that are document metadata, table of contents, or overview/purpose sections — classify them as "matched" with MATCHED_RULE: "N/A (metadata)"
- Focus ONLY on items with concrete coding rules that show OK/NOT OK examples
- Generate a UNIQUE sequential ID for each rule: custom-{category}-001, custom-{category}-002, ...
- DO NOT reuse IDs from existing rules or from other items in this batch
- Include the full code example from the standard when building regex patterns
- id MUST start with "custom-"
- severity MUST be one of: low, medium, high, critical
- pattern.type MUST be one of the available types above
- regex must be valid (escape special chars with double backslash)
- Output ALL items, one classification per item

## Example for Korean dev standard "한 줄에 하나의 문장":
ITEM: [ITEM-1]
CLASSIFICATION: yaml
RULE_YAML:
\`\`\`yaml
- id: "custom-format-001"
  name: "한 줄에 하나의 문장만 작성"
  severity: "low"
  category: "format"
  description: "세미콜론 뒤에 같은 줄에서 새 문장이 시작되면 안 됩니다"
  enabled: true
  pattern:
    type: "regex"
    regex: ";\\\\s*\\\\w+\\\\s*[=+\\\\-]"
\`\`\``;

  console.log(`[ruleGen] prompt size: ${prompt.length} chars (items: ${itemsText.length}, types: ${typesText.length}, rules: ${existingText.length})`);
  return prompt;
}

// ─── Two-Step Strategy (Ollama) ───

interface CandidateItem {
  item: StandardItem;
  patternType: string;  // regex | regex-multiline | ast-filtered-regex
  reason: string;       // 왜 regex로 잡을 수 있는지
}

/**
 * Step 1: MD 표준 항목 중 regex로 검출 가능한 후보를 선별
 */
function buildStep1Prompt(items: StandardItem[], existingRuleIds: string[]): string {
  const itemsText = items.map((item, i) => {
    const id = item.ruleId || `ITEM-${i + 1}`;
    return `[${id}] ${item.section}\n${item.content.slice(0, 300)}`;
  }).join("\n---\n");

  // 기존 규칙 ID만 간결하게
  const existingText = existingRuleIds.slice(0, 30).join(", ");

  const prompt = `You select coding standards that can be detected by regex.

## Standards
${itemsText}

## Already covered rule IDs (skip these)
${existingText}

## Task
For each standard [ID], answer YES or NO.
- YES = can detect with a single-line regex or multi-line regex on source code
- NO = too complex, needs AST analysis, or already covered

Output format (one per line):
[ID] YES regex "reason"
[ID] YES regex-multiline "reason"
[ID] NO "reason"

Rules:
- Only answer YES if a simple regex pattern can catch violations
- Use "regex" for single-line patterns, "regex-multiline" for multi-line
- Keep reasons short (under 20 words)`;

  console.log(`[ruleGen] step1 prompt: ${prompt.length} chars`);
  return prompt;
}

function findItemById(itemId: string, items: StandardItem[]): StandardItem | undefined {
  // Direct match by ruleId
  const byRuleId = items.find((i) => i.ruleId === itemId);
  if (byRuleId) return byRuleId;

  // Match by section containing the ID
  const bySection = items.find((i) => i.section.includes(itemId));
  if (bySection) return bySection;

  // ITEM-N index-based match (fallback numbering from prompt)
  const indexMatch = itemId.match(/^ITEM-(\d+)$/);
  if (indexMatch) {
    const idx = parseInt(indexMatch[1]) - 1;
    if (idx >= 0 && idx < items.length) return items[idx];
  }

  return undefined;
}

function parseStep1Results(response: string, items: StandardItem[]): { candidates: CandidateItem[]; rejected: Array<{ item: StandardItem; reason: string }> } {
  const candidates: CandidateItem[] = [];
  const rejected: Array<{ item: StandardItem; reason: string }> = [];

  for (const line of response.split("\n")) {
    // Match: [ID] YES regex "reason" or [ID] YES regex-multiline "reason"
    const yesMatch = line.match(/\[([^\]]+)\]\s*YES\s+(regex(?:-multiline)?|ast-filtered-regex)\s+"?([^"]*)"?/i);
    if (yesMatch) {
      const itemId = yesMatch[1];
      const patternType = yesMatch[2].toLowerCase();
      const reason = yesMatch[3].trim();
      const item = findItemById(itemId, items);
      if (item) {
        candidates.push({ item, patternType, reason });
      }
      continue;
    }

    // Match: [ID] NO "reason"
    const noMatch = line.match(/\[([^\]]+)\]\s*NO\s+"?([^"]*)"?/i);
    if (noMatch) {
      const itemId = noMatch[1];
      const reason = noMatch[2].trim();
      const item = findItemById(itemId, items);
      if (item) {
        rejected.push({ item, reason: reason || "regex로 검출 불가" });
      }
    }
  }

  return { candidates, rejected };
}

/**
 * Step 2: 선별된 항목 1개에 대해 regex 규칙 YAML 생성
 */
function buildStep2Prompt(candidate: CandidateItem, category: string, ruleNumber: number): string {
  const patternExample = candidate.patternType === "regex-multiline"
    ? `    type: "regex-multiline"\n    regex: "\\\\bSELECT\\\\s+DISTINCT\\\\b[\\\\s\\\\S]*?\\\\bGROUP\\\\s+BY\\\\b"\n    flags: "i"`
    : candidate.patternType === "ast-filtered-regex"
      ? `    type: "ast-filtered-regex"\n    regex: "System\\\\.(out|err)\\\\.(print|println)"`
      : `    type: "regex"\n    regex: "System\\\\.(out|err)\\\\.(print|println)"`;

  const prompt = `Generate one APEX YAML rule.

## Standard
${candidate.item.section}
${candidate.item.content.slice(0, 400)}

## Why regex works
${candidate.reason}

## Output exactly this YAML format (nothing else):
\`\`\`yaml
id: "custom-${category}-${String(ruleNumber).padStart(3, "0")}"
name: "규칙 이름"
severity: "low|medium|high|critical"
category: "${category}"
description: "설명"
enabled: true
pattern:
${patternExample}
\`\`\`

Rules:
- id MUST start with "custom-"
- severity: low, medium, high, or critical
- regex must be valid (double-escape backslashes)
- Output ONLY the yaml block, nothing else`;

  console.log(`[ruleGen] step2 prompt: ${prompt.length} chars (${candidate.item.ruleId || candidate.item.section})`);
  return prompt;
}

function parseStep2Result(response: string): string | null {
  const yamlMatch = response.match(/```yaml\s*\n([\s\S]*?)```/);
  if (yamlMatch) return yamlMatch[1].trim();

  // Fallback: try parsing the whole response as YAML if it starts with id:
  const trimmed = response.trim();
  if (trimmed.startsWith("id:") || trimmed.startsWith("- id:")) {
    return trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;
  }

  return null;
}

/**
 * Ollama 2단계 전략 실행
 */
async function processTwoStep(
  client: LLMClient,
  standardItems: StandardItem[],
  existingRules: ExistingRule[],
  groups: Map<string, StandardItem[]>,
): Promise<{
  yamlRules: Array<{ yaml: string; parsed: Record<string, unknown> }>;
  manual: ClassificationResult[];
  matched: ClassificationResult[];
  errors: number;
}> {
  const allYamlRules: Array<{ yaml: string; parsed: Record<string, unknown> }> = [];
  const allManual: ClassificationResult[] = [];
  const allMatched: ClassificationResult[] = [];
  let errorCount = 0;

  const existingRuleIds = existingRules.map((r) => r.id);
  let globalRuleNumber = 1;

  for (const [category, items] of groups) {
    console.log(`[ruleGen] step1: category="${category}", ${items.length} items`);

    // ── Step 1: 후보 선별 ──
    // 배치 분할 (한 번에 최대 1500자)
    const step1Batches: StandardItem[][] = [];
    let batch: StandardItem[] = [];
    let batchLen = 0;
    for (const item of items) {
      const len = item.content.length + (item.section?.length || 0) + 50;
      if (batchLen + len > 1500 && batch.length > 0) {
        step1Batches.push(batch);
        batch = [];
        batchLen = 0;
      }
      batch.push(item);
      batchLen += len;
    }
    if (batch.length > 0) step1Batches.push(batch);

    const allCandidates: CandidateItem[] = [];

    for (const batchItems of step1Batches) {
      try {
        const prompt = buildStep1Prompt(batchItems, existingRuleIds);
        const response = await client.chat([{ role: "user", content: prompt }]);
        const { candidates, rejected } = parseStep1Results(response.content, batchItems);

        allCandidates.push(...candidates);

        // rejected → manual
        for (const r of rejected) {
          allManual.push({
            classification: "manual",
            reason: r.reason,
            standardItem: r.item,
          });
        }

        // 응답에 포함되지 않은 항목도 manual 처리
        const handledIds = new Set([
          ...candidates.map((c) => c.item.ruleId || c.item.section),
          ...rejected.map((r) => r.item.ruleId || r.item.section),
        ]);
        for (const item of batchItems) {
          const itemId = item.ruleId || item.section;
          if (!handledIds.has(itemId)) {
            allManual.push({
              classification: "manual",
              reason: "Step 1 분류 누락",
              standardItem: item,
            });
          }
        }
      } catch (e) {
        errorCount++;
        for (const item of batchItems) {
          allManual.push({
            classification: "manual",
            reason: `Step 1 오류: ${e}`,
            standardItem: item,
          });
        }
      }
    }

    console.log(`[ruleGen] step1 result: ${allCandidates.length} candidates selected`);

    // ── Step 2: 후보별 regex 생성 ──
    for (const candidate of allCandidates) {
      try {
        const prompt = buildStep2Prompt(candidate, category, globalRuleNumber);
        const response = await client.chat([{ role: "user", content: prompt }]);
        const ruleYaml = parseStep2Result(response.content);

        if (ruleYaml) {
          const validation = validateRuleYaml(ruleYaml);
          if (validation.valid && validation.parsed) {
            allYamlRules.push({ yaml: ruleYaml, parsed: validation.parsed });
            globalRuleNumber++;
            console.log(`[ruleGen] step2: ✓ ${validation.parsed.id}`);
          } else {
            console.log(`[ruleGen] step2: ✗ validation failed: ${validation.error}`);
            errorCount++;
            // 검증 실패 → manual로 fallback
            allManual.push({
              classification: "manual",
              reason: `YAML 검증 실패: ${validation.error}`,
              standardItem: candidate.item,
            });
          }
        } else {
          errorCount++;
          allManual.push({
            classification: "manual",
            reason: "Step 2 YAML 파싱 실패",
            standardItem: candidate.item,
          });
        }
      } catch (e) {
        errorCount++;
        allManual.push({
          classification: "manual",
          reason: `Step 2 오류: ${e}`,
          standardItem: candidate.item,
        });
      }
    }
  }

  return { yamlRules: allYamlRules, manual: allManual, matched: allMatched, errors: errorCount };
}

// ─── One-Step Parsing (Anthropic) ───

function parseClassificationResults(
  response: string,
  items: StandardItem[],
): ClassificationResult[] {
  const results: ClassificationResult[] = [];

  // Split by ITEM: markers
  const itemBlocks = response.split(/\nITEM:\s*/);

  for (const block of itemBlocks) {
    if (!block.trim()) continue;

    // Extract item ID
    const idMatch = block.match(/^\[([^\]]+)\]/);
    if (!idMatch) continue;
    const itemId = idMatch[1];

    // Find corresponding StandardItem (use findItemById to avoid partial matching)
    const item = findItemById(itemId, items);
    if (!item) continue;

    // Extract classification
    const classMatch = block.match(/CLASSIFICATION:\s*(yaml|manual|matched)/i);
    if (!classMatch) continue;
    const classification = classMatch[1].toLowerCase() as "yaml" | "manual" | "matched";

    if (classification === "yaml") {
      const yamlMatch = block.match(/```yaml\s*\n([\s\S]*?)```/);
      if (yamlMatch) {
        results.push({ classification, ruleYaml: yamlMatch[1].trim(), standardItem: item });
      }
    } else if (classification === "manual") {
      const reasonMatch = block.match(/REASON:\s*(.+)/i);
      results.push({
        classification,
        reason: reasonMatch ? reasonMatch[1].trim() : "복잡한 로직 필요",
        standardItem: item,
      });
    } else if (classification === "matched") {
      const matchedMatch = block.match(/MATCHED_RULE:\s*(.+)/i);
      results.push({
        classification,
        matchedRule: matchedMatch ? matchedMatch[1].trim() : "unknown",
        standardItem: item,
      });
    }
  }

  return results;
}

/**
 * Fallback parser for single-item batches where LLM omits ITEM: prefix.
 * Tries to extract classification directly from the response.
 */
function parseSingleItemFallback(response: string, item: StandardItem): ClassificationResult[] {
  const classMatch = response.match(/CLASSIFICATION:\s*(yaml|manual|matched)/i);
  if (!classMatch) {
    // Even without CLASSIFICATION: marker, check if there's a YAML block
    const yamlMatch = response.match(/```yaml\s*\n([\s\S]*?)```/);
    if (yamlMatch) {
      return [{ classification: "yaml", ruleYaml: yamlMatch[1].trim(), standardItem: item }];
    }
    // Check for REASON: (manual classification)
    const reasonMatch = response.match(/REASON:\s*(.+)/i);
    if (reasonMatch) {
      return [{ classification: "manual", reason: reasonMatch[1].trim(), standardItem: item }];
    }
    return [];
  }

  const classification = classMatch[1].toLowerCase() as "yaml" | "manual" | "matched";

  if (classification === "yaml") {
    const yamlMatch = response.match(/```yaml\s*\n([\s\S]*?)```/);
    if (yamlMatch) {
      return [{ classification, ruleYaml: yamlMatch[1].trim(), standardItem: item }];
    }
  } else if (classification === "manual") {
    const reasonMatch = response.match(/REASON:\s*(.+)/i);
    return [{
      classification,
      reason: reasonMatch ? reasonMatch[1].trim() : "복잡한 로직 필요",
      standardItem: item,
    }];
  } else if (classification === "matched") {
    const matchedMatch = response.match(/MATCHED_RULE:\s*(.+)/i);
    return [{
      classification,
      matchedRule: matchedMatch ? matchedMatch[1].trim() : "unknown",
      standardItem: item,
    }];
  }

  return [];
}

// ─── Output Generation ───

function generateCustomYaml(rules: Array<{ yaml: string; parsed: Record<string, unknown> }>): string {
  const javaRules: Record<string, unknown>[] = [];
  const sqlRules: Record<string, unknown>[] = [];
  const otherRules: Record<string, unknown>[] = [];

  for (const r of rules) {
    const patternType = (r.parsed.pattern as Record<string, unknown>)?.type as string;
    if (patternType?.startsWith("ast-sql-")) {
      sqlRules.push(r.parsed);
    } else if (["regex", "regex-multiline"].includes(patternType) && !(r.parsed.id as string)?.includes("sql")) {
      javaRules.push(r.parsed);
    } else {
      javaRules.push(r.parsed);
    }
  }

  const ruleset: Record<string, unknown> = {
    version: "1.0",
    profile: "custom",
    languages: [] as Array<Record<string, unknown>>,
  };

  if (javaRules.length > 0 || otherRules.length > 0) {
    (ruleset.languages as Array<Record<string, unknown>>).push({
      language: "java",
      rules: [...javaRules, ...otherRules],
    });
  }

  if (sqlRules.length > 0) {
    (ruleset.languages as Array<Record<string, unknown>>).push({
      language: "sql",
      rules: sqlRules,
    });
  }

  return yaml.dump(ruleset, { lineWidth: 120, noRefs: true, sortKeys: false });
}

function generateManualRulesMd(manualItems: ClassificationResult[]): string {
  // Filter out noise items before generating output
  const filtered = manualItems.filter((item) => {
    const content = item.standardItem.content;
    // TOC lines only → exclude
    if (/^[\d.]+\s+.*·{5,}/.test(content)) return false;
    // Placeholder → exclude
    if (content.includes("[Edit this file")) return false;
    // Too short (less than 50 chars of actual text) → exclude
    if (content.replace(/[\s\n]/g, "").length < 50) return false;
    // Metadata-only reason → exclude
    if (item.reason?.includes('N/A (metadata)')) return false;
    return true;
  });

  let md = "# 수동 규칙 구현 필요 목록\n\n";
  md += "이 항목들은 YAML 패턴으로 표현할 수 없어 Go 코드 수정이 필요합니다.\n\n";

  for (const item of filtered) {
    const id = item.standardItem.ruleId || item.standardItem.section;
    md += `## ${id}\n`;
    md += `- **섹션**: ${item.standardItem.section}\n`;
    md += `- **사유**: ${item.reason || "복잡한 로직 필요"}\n`;
    md += `- **내용**: ${item.standardItem.content.slice(0, 200)}\n\n`;
  }

  return md;
}

function generateMatchedMd(matchedItems: ClassificationResult[]): string {
  let md = "# 기존 규칙 매핑 목록\n\n";
  md += "이 항목들은 기존 apex 규칙으로 이미 검출됩니다.\n\n";
  md += "| 표준 항목 | 매핑된 규칙 ID |\n";
  md += "|-----------|---------------|\n";

  for (const item of matchedItems) {
    const id = item.standardItem.ruleId || item.standardItem.section;
    md += `| ${id} | ${item.matchedRule || "?"} |\n`;
  }

  return md;
}

// ─── Main Tool ───

const generateApexRulesTool: Tool = {
  name: "generate_apex_rules",
  description: "개발표준 마크다운에서 APEX 커스텀 규칙 YAML을 자동 생성합니다. Use when user asks: '규칙 생성', 'generate rules', '커스텀 규칙', 'custom rule', '표준 → 규칙'.",
  parameters: {
    type: "object",
    required: ["standards_dir", "schema_path", "existing_rulesets_dir"],
    properties: {
      standards_dir: {
        type: "string",
        description: "표준 문서 마크다운 디렉토리 (예: .activo/standards)",
      },
      schema_path: {
        type: "string",
        description: "apex rule-schema.yaml 경로",
      },
      existing_rulesets_dir: {
        type: "string",
        description: "apex configs/rulesets/ 디렉토리 경로",
      },
      output_dir: {
        type: "string",
        description: "출력 디렉토리 (기본: .activo/generated-rules)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const standardsDir = args.standards_dir as string;
      const schemaPath = args.schema_path as string;
      const existingRulesetsDir = args.existing_rulesets_dir as string;
      const outputDir = (args.output_dir as string) || ".activo/generated-rules";

      // Validate inputs
      if (!fs.existsSync(standardsDir)) {
        return { success: false, content: "", error: `표준 디렉토리 없음: ${standardsDir}` };
      }
      if (!fs.existsSync(schemaPath)) {
        return { success: false, content: "", error: `스키마 파일 없음: ${schemaPath}` };
      }
      if (!fs.existsSync(existingRulesetsDir)) {
        return { success: false, content: "", error: `규칙셋 디렉토리 없음: ${existingRulesetsDir}` };
      }

      // 0. Create LLM client and determine context profile
      const client = createLLMClient();
      const profile = getContextProfile(client.getProvider());
      const profileName = profile === CONTEXT_PROFILES.compact ? "compact" : "full";
      console.log(`[ruleGen] provider: ${client.getProvider()}, context profile: ${profileName}, schema filter: ${profile.schemaFilterTypes?.join(",") || "all"}`);

      // 1. Load schema (filtered by profile)
      const patternTypes = loadRuleSchema(schemaPath, profile.schemaFilterTypes ?? undefined);
      console.log(`[ruleGen] loaded ${patternTypes.length} pattern types`);

      // 2. Load existing rules
      const existingRules = loadExistingRules(existingRulesetsDir);
      console.log(`[ruleGen] loaded ${existingRules.length} existing rules`);

      // 3. Load standards
      const standardItems = loadStandardItems(standardsDir);
      if (standardItems.length === 0) {
        return { success: false, content: "", error: `표준 항목이 없습니다: ${standardsDir}` };
      }

      // 4. Group by category
      const groups = groupByCategory(standardItems);

      // 5. Process — strategy branching
      let allYamlRules: Array<{ yaml: string; parsed: Record<string, unknown> }>;
      let allManual: ClassificationResult[];
      let allMatched: ClassificationResult[];
      let errorCount: number;

      if (profile.strategy === "two-step") {
        // ── Ollama: 2단계 (선별 → 생성) ──
        console.log(`[ruleGen] using two-step strategy`);
        const result = await processTwoStep(client, standardItems, existingRules, groups);
        allYamlRules = result.yamlRules;
        allManual = result.manual;
        allMatched = result.matched;
        errorCount = result.errors;
      } else {
        // ── Anthropic: 1단계 (분류+생성 동시) ──
        console.log(`[ruleGen] using one-step strategy`);
        allYamlRules = [];
        allManual = [];
        allMatched = [];
        errorCount = 0;
        const usedIds = new Set<string>();

        for (const [category, items] of groups) {
          const selectedTypes = selectPatternTypes(category, patternTypes);

          // Split into batches (profile-aware max chars)
          const batches: StandardItem[][] = [];
          let currentBatch: StandardItem[] = [];
          let currentLength = 0;

          for (const item of items) {
            // Use truncated length (what actually appears in the prompt) for budget
            const itemLength = Math.min(item.content.length, profile.maxItemContentChars) + (item.section?.length || 0) + 50;
            if (currentLength + itemLength > profile.maxItemsChars && currentBatch.length > 0) {
              batches.push(currentBatch);
              currentBatch = [];
              currentLength = 0;
            }
            currentBatch.push(item);
            currentLength += itemLength;
          }
          if (currentBatch.length > 0) batches.push(currentBatch);

          console.log(`[ruleGen] category="${category}": ${items.length} items → ${batches.length} batches`);

          for (const batch of batches) {
            try {
              const prompt = buildBatchPrompt(batch, selectedTypes, existingRules, profile);
              const response = await client.chat([{ role: "user", content: prompt }]);
              let results = parseClassificationResults(response.content, batch);

              // Fallback: when batch has 1 item and parser found nothing,
              // the LLM may have responded without ITEM: prefix
              if (results.length === 0 && batch.length === 1) {
                results = parseSingleItemFallback(response.content, batch[0]);
              }

              for (const result of results) {
                if (result.classification === "yaml" && result.ruleYaml) {
                  const yamlRules = extractIndividualRules(result.ruleYaml);
                  for (let ruleYaml of yamlRules) {
                    const validation = validateRuleYaml(ruleYaml);
                    if (validation.valid && validation.parsed) {
                      // Dedup IDs
                      const ruleId = validation.parsed.id as string;
                      if (usedIds.has(ruleId)) {
                        const newId = generateUniqueId(ruleId, usedIds);
                        validation.parsed.id = newId;
                        ruleYaml = ruleYaml.replace(`id: "${ruleId}"`, `id: "${newId}"`);
                        console.log(`[ruleGen] dedup: ${ruleId} → ${newId}`);
                      }
                      usedIds.add(validation.parsed.id as string);
                      allYamlRules.push({ yaml: ruleYaml, parsed: validation.parsed });
                    } else {
                      errorCount++;
                    }
                  }
                } else if (result.classification === "manual") {
                  allManual.push(result);
                } else if (result.classification === "matched") {
                  allMatched.push(result);
                }
              }

              const classifiedIds = new Set(results.map((r) => r.standardItem.ruleId || r.standardItem.section));
              for (const item of batch) {
                const itemId = item.ruleId || item.section;
                if (!classifiedIds.has(itemId)) {
                  allManual.push({
                    classification: "manual",
                    reason: "LLM 분류 결과 누락",
                    standardItem: item,
                  });
                }
              }
            } catch (e) {
              errorCount++;
              for (const item of batch) {
                allManual.push({
                  classification: "manual",
                  reason: `LLM 호출 오류: ${e}`,
                  standardItem: item,
                });
              }
            }
          }
        }
      }

      // 6. Generate output files
      fs.mkdirSync(outputDir, { recursive: true });

      // custom.yaml
      if (allYamlRules.length > 0) {
        const customYaml = generateCustomYaml(allYamlRules);
        fs.writeFileSync(path.join(outputDir, "custom.yaml"), customYaml, "utf-8");
      }

      // manual_rules.md
      if (allManual.length > 0) {
        const manualMd = generateManualRulesMd(allManual);
        fs.writeFileSync(path.join(outputDir, "manual_rules.md"), manualMd, "utf-8");
      }

      // matched.md
      if (allMatched.length > 0) {
        const matchedMd = generateMatchedMd(allMatched);
        fs.writeFileSync(path.join(outputDir, "matched.md"), matchedMd, "utf-8");
      }

      // Summary
      const summary: GenerationSummary = {
        totalItems: standardItems.length,
        yamlRules: allYamlRules.length,
        manualRules: allManual.length,
        matchedRules: allMatched.length,
        errors: errorCount,
        outputDir,
      };

      return {
        success: true,
        content: JSON.stringify(summary, null, 2),
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Helper: extract individual rules from YAML that may be in array format
function extractIndividualRules(yamlText: string): string[] {
  const trimmed = yamlText.trim();

  // If starts with "- id:", it's an array format — split into individual rules
  if (trimmed.startsWith("- id:")) {
    const rules: string[] = [];
    const parts = trimmed.split(/\n(?=- id:)/);
    for (const part of parts) {
      // Remove leading "- " and adjust indentation
      const lines = part.split("\n");
      const adjusted = lines.map((line, i) => {
        if (i === 0) return line.replace(/^- /, "");
        return line.replace(/^  /, "");
      });
      rules.push(adjusted.join("\n"));
    }
    return rules;
  }

  // Single rule format
  return [trimmed];
}

// Helper: generate unique ID by incrementing suffix when collision detected
function generateUniqueId(baseId: string, usedIds: Set<string>): string {
  // Extract base and number: "custom-format-002" → ["custom-format-", "002"]
  const match = baseId.match(/^(.+-)(\d+)$/);
  if (!match) {
    // No numeric suffix — append -001
    let candidate = `${baseId}-001`;
    let n = 1;
    while (usedIds.has(candidate)) {
      n++;
      candidate = `${baseId}-${String(n).padStart(3, "0")}`;
    }
    return candidate;
  }

  const prefix = match[1];
  let num = parseInt(match[2]);
  let candidate = baseId;
  while (usedIds.has(candidate)) {
    num++;
    candidate = `${prefix}${String(num).padStart(3, "0")}`;
  }
  return candidate;
}

export const ruleGenTools: Tool[] = [generateApexRulesTool];
