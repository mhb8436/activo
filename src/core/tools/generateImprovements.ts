import fs from "fs";
import path from "path";
import { Tool, ToolResult } from "./types.js";
import { loadApexReport, ApexReport, ApexIssue, createLLMClient } from "./apexUtils.js";

// ─── Constants ───

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const CONTEXT_LINES = 7;
const MAX_PROMPT_CHARS = 4000;

// ─── Helpers ───

function formatDate(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function detectLang(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".java": "java", ".py": "python", ".go": "go",
    ".css": "css", ".scss": "scss",
    ".html": "html", ".jsp": "jsp", ".vue": "vue",
    ".xml": "xml", ".sql": "sql",
  };
  return langMap[ext] || "text";
}

function readSourceLines(filepath: string): string[] | null {
  try {
    return fs.readFileSync(filepath, "utf-8").split("\n");
  } catch {
    return null;
  }
}

function extractContext(lines: string[], issueLine: number, context: number = CONTEXT_LINES): string {
  const start = Math.max(0, issueLine - 1 - context);
  const end = Math.min(lines.length, issueLine + context);
  return lines
    .slice(start, end)
    .map((line, i) => `${start + i + 1}: ${line}`)
    .join("\n");
}

// ─── Types ───

interface RuleGroup {
  rule_id: string;
  severity: string;
  category: string;
  message: string;
  issues: ApexIssue[];
  frequency: number;
  impactScore: number;
  affectedFiles: string[];
  representative: ApexIssue;
}

interface ImprovementResult {
  rule_id: string;
  improvements: string; // markdown from LLM
  error?: string;
}

// ─── Feature 1: Representative Case Report ───

/**
 * Group issues by rule_id and select a representative for each.
 */
function groupByRuleId(issues: ApexIssue[]): RuleGroup[] {
  const map = new Map<string, ApexIssue[]>();
  for (const issue of issues) {
    const key = issue.rule_id || "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(issue);
  }

  const groups: RuleGroup[] = [];
  for (const [rule_id, ruleIssues] of map) {
    const severity = ruleIssues[0].severity;
    const weight = SEVERITY_WEIGHT[severity] ?? 1;
    const frequency = ruleIssues.length;
    const affectedFiles = [...new Set(ruleIssues.map((i) => i.file))];

    // Select representative: prefer file with most issues of this rule
    const fileCounts = new Map<string, number>();
    for (const issue of ruleIssues) {
      fileCounts.set(issue.file, (fileCounts.get(issue.file) || 0) + 1);
    }

    // Sort files by count descending
    const sortedFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);

    // Pick representative from the file with most occurrences, preferring existing files
    let representative = ruleIssues[0];
    for (const [file] of sortedFiles) {
      try {
        if (fs.existsSync(file)) {
          representative = ruleIssues.find((i) => i.file === file)!;
          break;
        }
      } catch { /* skip */ }
    }

    groups.push({
      rule_id,
      severity,
      category: ruleIssues[0].category,
      message: ruleIssues[0].message,
      issues: ruleIssues,
      frequency,
      impactScore: weight * frequency,
      affectedFiles,
      representative,
    });
  }

  // Sort by impact score descending
  groups.sort((a, b) => b.impactScore - a.impactScore);
  return groups;
}

/**
 * Generate improvement for a single rule_id using its representative issue.
 */
async function generateRuleImprovement(group: RuleGroup): Promise<ImprovementResult> {
  const { representative, rule_id } = group;
  const filepath = representative.file;

  const sourceLines = readSourceLines(filepath);
  if (!sourceLines) {
    return { rule_id, improvements: "", error: "파일 없음" };
  }

  const lang = detectLang(filepath);
  const codeContext = extractContext(sourceLines, representative.line);

  let prompt = `당신은 코드 품질 개선 전문가입니다.
아래 코드에서 발견된 이슈에 대해 개선된 코드를 작성해주세요.

[파일: ${filepath}:${representative.line}]
[규칙: ${rule_id}] ${representative.message}
[심각도: ${representative.severity}]

\`\`\`${lang}
${codeContext}
\`\`\`

다음 형식으로 답변하세요:
**문제 코드:**
\`\`\`${lang}
{이슈가 있는 부분만}
\`\`\`
**개선 코드:**
\`\`\`${lang}
{수정된 코드}
\`\`\`
**설명:** {왜 이렇게 바꿔야 하는지 1-2문장}`;

  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + "\n// ... (truncated)";
  }

  try {
    const client = createLLMClient();
    const response = await client.chat([{ role: "user", content: prompt }]);
    return { rule_id, improvements: response.content };
  } catch (err) {
    return { rule_id, improvements: "", error: `LLM 오류: ${err}` };
  }
}

/**
 * Assemble the representative-case markdown report.
 */
function assembleRepresentativeReport(
  report: ApexReport,
  groups: RuleGroup[],
  results: Map<string, ImprovementResult>,
): string {
  const dateStr = formatDate();

  let md = `# 코드 개선 보고서\n\n`;
  md += `- 생성일시: ${dateStr}\n`;
  md += `- 분석 대상: ${report.summary.files_analyzed}개 파일, 총 ${report.summary.total_issues}건\n`;
  md += `- 개선 유형: ${groups.length}종류\n`;
  md += `\n---\n\n`;

  let idx = 0;
  for (const group of groups) {
    idx++;
    const result = results.get(group.rule_id);
    const filesStr = group.affectedFiles
      .map((f) => {
        const count = group.issues.filter((i) => i.file === f).length;
        return `${f}(${count}건)`;
      })
      .join(", ");

    md += `## ${idx}. ${group.rule_id} (${group.frequency}건, ${group.affectedFiles.length}개 파일) — ${group.severity}\n`;
    md += `> ${group.message}\n\n`;
    md += `**임팩트:** ${group.category} 관련 이슈 ${group.frequency}곳\n`;
    md += `**영향 파일:** ${filesStr}\n\n`;

    if (result?.error) {
      md += `> ⚠️ ${result.error}\n\n`;
    } else if (result?.improvements) {
      md += `**대표 사례: ${group.representative.file}:${group.representative.line}**\n\n`;
      md += result.improvements;
      md += `\n\n`;
    }

    md += `---\n\n`;
  }

  md += `*Generated by ACTIVO*\n`;
  return md;
}

// ─── Feature 2: Excel Paste Mode ───

interface ParsedPasteIssue {
  rule_id: string;
  severity: string;
  category: string;
  file: string;
  line: number;
  message: string;
}

/**
 * Detect if input is tab-separated Excel paste.
 */
export function isExcelPaste(text: string): boolean {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return false;
  // Must have tabs and at least one rule_id pattern
  const hasTab = lines.some((l) => l.includes("\t"));
  const hasRuleId = /[a-zA-Z]+-[a-zA-Z]+-\w+/.test(text);
  return hasTab && hasRuleId;
}

/**
 * Parse tab-separated Excel paste into issues.
 * Auto-detects column positions by content patterns.
 */
export function parseExcelPaste(text: string): ParsedPasteIssue[] {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const results: ParsedPasteIssue[] = [];

  for (const line of lines) {
    const cols = line.split("\t").map((c) => c.trim());
    if (cols.length < 3) continue;

    // Auto-detect columns
    let rule_id = "";
    let severity = "";
    let category = "";
    let file = "";
    let lineNum = 0;
    let message = "";

    for (const col of cols) {
      if (!col) continue;

      // rule_id pattern: word-word-word or word-word-digits
      if (!rule_id && /^[a-zA-Z]+-[a-zA-Z]+-\w+$/.test(col)) {
        rule_id = col;
        continue;
      }
      // severity
      if (!severity && /^(critical|high|medium|low)$/i.test(col)) {
        severity = col.toLowerCase();
        continue;
      }
      // file path (contains / or \)
      if (!file && (col.includes("/") || col.includes("\\"))) {
        file = col;
        continue;
      }
      // line number (pure digits)
      if (!lineNum && /^\d+$/.test(col)) {
        lineNum = parseInt(col, 10);
        continue;
      }
      // category (short alphanumeric word)
      if (!category && /^[a-zA-Z_-]+$/.test(col) && col.length < 20) {
        category = col;
        continue;
      }
      // message (remaining text)
      if (!message && col.length > 2) {
        message = col;
      }
    }

    // Skip header rows or incomplete rows
    if (!rule_id || !file) continue;

    results.push({
      rule_id,
      severity: severity || "medium",
      category: category || "",
      file,
      line: lineNum || 1,
      message: message || rule_id,
    });
  }

  return results;
}

/**
 * Generate improvements for paste-mode issues.
 * Groups by file for efficient LLM calls.
 */
async function generatePasteImprovements(issues: ParsedPasteIssue[]): Promise<string> {
  const dateStr = formatDate();
  let md = `# 코드 개선 보고서 (선택 이슈)\n\n`;
  md += `- 생성일시: ${dateStr}\n`;
  md += `- 선택 이슈: ${issues.length}건\n`;
  md += `\n---\n\n`;

  // Group by file
  const fileGroups = new Map<string, ParsedPasteIssue[]>();
  for (const issue of issues) {
    if (!fileGroups.has(issue.file)) fileGroups.set(issue.file, []);
    fileGroups.get(issue.file)!.push(issue);
  }

  let idx = 0;
  for (const [filepath, fileIssues] of fileGroups) {
    const sourceLines = readSourceLines(filepath);
    const lang = detectLang(filepath);

    for (const issue of fileIssues) {
      idx++;

      if (!sourceLines) {
        md += `## ${idx}. ${issue.rule_id} — ${filepath}:${issue.line}\n`;
        md += `> ⚠️ 파일 없음\n\n---\n\n`;
        continue;
      }

      const codeContext = extractContext(sourceLines, issue.line);

      let prompt = `당신은 코드 품질 개선 전문가입니다.
아래 코드에서 발견된 이슈에 대해 개선된 코드를 작성해주세요.

[파일: ${filepath}:${issue.line}]
[규칙: ${issue.rule_id}] ${issue.message}
[심각도: ${issue.severity}]

\`\`\`${lang}
${codeContext}
\`\`\`

다음 형식으로 답변하세요:
**문제 코드:**
\`\`\`${lang}
{이슈가 있는 부분만}
\`\`\`
**개선 코드:**
\`\`\`${lang}
{수정된 코드}
\`\`\`
**설명:** {왜 이렇게 바꿔야 하는지 1-2문장}`;

      if (prompt.length > MAX_PROMPT_CHARS) {
        prompt = prompt.slice(0, MAX_PROMPT_CHARS) + "\n// ... (truncated)";
      }

      md += `## ${idx}. ${issue.rule_id} — ${filepath}:${issue.line}\n`;
      md += `> ${issue.message} (${issue.severity})\n\n`;

      try {
        const client = createLLMClient();
        const response = await client.chat([{ role: "user", content: prompt }]);
        md += response.content;
        md += `\n\n`;
      } catch (err) {
        md += `> ⚠️ LLM 오류: ${err}\n\n`;
      }

      md += `---\n\n`;
    }
  }

  md += `*Generated by ACTIVO*\n`;
  return md;
}

// ─── Input Mode Detection ───

type InputMode = "file" | "json" | "paste";

function detectInputMode(report: string): InputMode {
  const trimmed = report.trim();
  // JSON string
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  // Tab-separated paste with rule_id pattern
  if (isExcelPaste(trimmed)) {
    return "paste";
  }
  // File path
  return "file";
}

// ─── Feature 3: File-Batch Mode (모든 이슈 처리) ───

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * Filter issues by minimum severity.
 */
function filterBySeverity(issues: ApexIssue[], minSeverity: string): ApexIssue[] {
  const minScore = SEVERITY_ORDER[minSeverity.toLowerCase()] ?? 0;
  return issues.filter((i) => (SEVERITY_ORDER[i.severity?.toLowerCase()] ?? 0) >= minScore);
}

interface FileBatchResult {
  filepath: string;
  issueCount: number;
  markdown: string;
  error?: string;
}

/**
 * Generate improvements for all issues in a single file via one LLM call.
 * Returns structured markdown with before/after for each issue.
 */
async function generateFileBatchImprovement(
  filepath: string,
  issues: ApexIssue[],
): Promise<FileBatchResult> {
  const sourceLines = readSourceLines(filepath);
  if (!sourceLines) {
    return { filepath, issueCount: issues.length, markdown: "", error: "파일 없음" };
  }

  const lang = detectLang(filepath);

  // Build issue list with code context for each
  const issueDescs = issues.map((issue, idx) => {
    const ctx = extractContext(sourceLines, issue.line, 5);
    return `### 이슈 ${idx + 1} [line ${issue.line}] ${issue.rule_id} (${issue.severity})
설명: ${issue.message}
${issue.suggestion ? `권장: ${issue.suggestion}` : ""}
\`\`\`${lang}
${ctx}
\`\`\``;
  }).join("\n\n");

  const prompt = `당신은 코드 품질 개선 전문가입니다. 아래 파일에서 발견된 모든 이슈에 대해 개선 코드를 작성해주세요.

파일: ${filepath}
언어: ${lang}
이슈 수: ${issues.length}건

${issueDescs}

각 이슈에 대해 다음 형식으로 답변하세요:

### 이슈 1 개선
**문제 코드:**
\`\`\`${lang}
{이슈가 있는 코드 부분}
\`\`\`
**개선 코드:**
\`\`\`${lang}
{수정된 코드}
\`\`\`
**설명:** {1-2문장}

### 이슈 2 개선
...

모든 이슈(${issues.length}건)에 대해 순서대로 답변해주세요.`;

  const truncated = prompt.length > 6000 ? prompt.slice(0, 6000) + "\n// ... (truncated)" : prompt;

  try {
    const client = createLLMClient();
    const response = await client.chat([{ role: "user", content: truncated }]);

    // Assemble per-file markdown
    let md = `## 📄 ${path.basename(filepath)} (${issues.length}건)\n`;
    md += `> 경로: \`${filepath}\`\n\n`;

    // Add issue table
    md += "| # | 라인 | 규칙ID | 심각도 | 메시지 |\n";
    md += "|---|------|--------|--------|--------|\n";
    for (let i = 0; i < issues.length; i++) {
      const iss = issues[i];
      md += `| ${i + 1} | ${iss.line} | ${iss.rule_id} | ${iss.severity} | ${iss.message.slice(0, 60)} |\n`;
    }
    md += "\n";
    md += response.content;
    md += "\n\n---\n\n";

    return { filepath, issueCount: issues.length, markdown: md };
  } catch (err) {
    return { filepath, issueCount: issues.length, markdown: "", error: `LLM 오류: ${err}` };
  }
}

/**
 * Generate full improvement report (all issues, file-batch mode).
 */
async function generateFullImprovementReport(
  report: ApexReport,
  minSeverity: string,
  maxFiles: number,
): Promise<{ markdown: string; stats: Record<string, number> }> {
  const dateStr = formatDate();

  // Filter by severity
  const filtered = filterBySeverity(report.issues, minSeverity);

  // Group by file, sort by issue count descending (hotspots first)
  const fileMap = new Map<string, ApexIssue[]>();
  for (const issue of filtered) {
    const f = issue.file || "unknown";
    if (!fileMap.has(f)) fileMap.set(f, []);
    fileMap.get(f)!.push(issue);
  }
  const sortedFiles = [...fileMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxFiles);

  const totalFiles = sortedFiles.length;
  const totalIssues = sortedFiles.reduce((sum, [, iss]) => sum + iss.length, 0);

  let md = `# 코드 개선 보고서 (전체)\n\n`;
  md += `- 생성일시: ${dateStr}\n`;
  md += `- 분석 대상: ${report.summary.files_analyzed}개 파일, 총 ${report.summary.total_issues}건\n`;
  md += `- 처리 범위: ${minSeverity} 이상, ${totalFiles}개 파일, ${totalIssues}건\n`;
  md += `- 처리 방식: 파일별 배치 (LLM ${totalFiles}회 호출)\n`;
  md += `\n---\n\n`;

  // TOC
  md += "## 목차\n\n";
  for (let i = 0; i < sortedFiles.length; i++) {
    const [fp, iss] = sortedFiles[i];
    md += `${i + 1}. [${path.basename(fp)}](#) — ${iss.length}건\n`;
  }
  md += "\n---\n\n";

  let successCount = 0;
  let failCount = 0;

  for (const [filepath, issues] of sortedFiles) {
    // Sort issues within file by line number
    const sorted = [...issues].sort((a, b) => a.line - b.line);
    const result = await generateFileBatchImprovement(filepath, sorted);

    if (result.error) {
      md += `## 📄 ${path.basename(filepath)} (${issues.length}건)\n`;
      md += `> ⚠️ ${result.error}\n\n---\n\n`;
      failCount++;
    } else {
      md += result.markdown;
      successCount++;
    }
  }

  md += `*Generated by ACTIVO — 파일 ${successCount}/${totalFiles} 성공, ${failCount} 실패*\n`;

  return {
    markdown: md,
    stats: { totalFiles, totalIssues, successCount, failCount },
  };
}

// ─── Tool Definition ───

const generateImprovementReportTool: Tool = {
  name: "generate_improvement_report",
  description:
    "apex 분석 결과(JSON)에서 이슈별 '문제 코드 → 개선 코드' 보고서를 생성합니다. " +
    "mode='representative'(기본): rule_id별 대표사례 (빠름). " +
    "mode='full': 파일별 배치로 모든 이슈 처리 (LLM 호출 = 이슈 있는 파일 수). " +
    "엑셀 행 복붙도 지원합니다. " +
    "Use when user asks: '개선', '코드개선', '개선보고서', '전체개선', 'improvement', 'before after', '감리'.",
  parameters: {
    type: "object",
    required: ["report"],
    properties: {
      report: {
        type: "string",
        description: "apex 분석 결과 JSON 파일 경로, 인라인 JSON, 또는 엑셀에서 복사한 탭 구분 텍스트",
      },
      output_dir: {
        type: "string",
        description: "출력 디렉토리 (기본: 현재 디렉토리)",
      },
      mode: {
        type: "string",
        description: "'representative'(기본, 빠름) | 'full'(모든 이슈, 파일별 배치)",
      },
      min_severity: {
        type: "string",
        description: "최소 심각도 필터: 'low'(기본) | 'medium' | 'high' | 'critical'",
      },
      max_files: {
        type: "number",
        description: "full 모드에서 처리할 최대 파일 수 (기본: 50)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const reportArg = args.report as string;
      const outputDir = (args.output_dir as string) || ".";
      const generationMode = (args.mode as string) || "representative";
      const minSeverity = (args.min_severity as string) || "low";
      const maxFiles = (args.max_files as number) || 50;
      const inputMode = detectInputMode(reportArg);

      fs.mkdirSync(outputDir, { recursive: true });
      const timestamp = formatTimestamp();

      // ── Paste mode ──
      if (inputMode === "paste") {
        const pasteIssues = parseExcelPaste(reportArg);
        if (pasteIssues.length === 0) {
          return { success: false, content: "", error: "인식할 수 없는 형식입니다. 탭 구분 텍스트에 rule_id와 파일 경로가 필요합니다." };
        }

        const markdown = await generatePasteImprovements(pasteIssues);
        const mdPath = path.join(outputDir, `improvement_${timestamp}.md`);
        fs.writeFileSync(mdPath, markdown, "utf-8");

        return {
          success: true,
          content: JSON.stringify({
            mode: "paste",
            report_path: mdPath,
            issues_processed: pasteIssues.length,
            message: `선택 이슈 ${pasteIssues.length}건의 개선 보고서가 생성되었습니다: ${mdPath}`,
          }, null, 2),
        };
      }

      const report = loadApexReport(reportArg);

      if (report.issues.length === 0) {
        return {
          success: true,
          content: JSON.stringify({ message: "개선할 이슈가 없습니다." }),
        };
      }

      // ── Full mode: 파일별 배치, 모든 이슈 처리 ──
      if (generationMode === "full") {
        const { markdown, stats } = await generateFullImprovementReport(report, minSeverity, maxFiles);
        const mdPath = path.join(outputDir, `improvement_full_${timestamp}.md`);
        fs.writeFileSync(mdPath, markdown, "utf-8");

        return {
          success: true,
          content: JSON.stringify({
            mode: "full",
            report_path: mdPath,
            total_issues: report.summary.total_issues,
            processed_issues: stats.totalIssues,
            processed_files: stats.totalFiles,
            llm_calls: stats.totalFiles,
            successful: stats.successCount,
            failed: stats.failCount,
            min_severity: minSeverity,
            message: `전체 개선 보고서가 생성되었습니다: ${mdPath} (${stats.totalFiles}개 파일, ${stats.totalIssues}건, LLM ${stats.totalFiles}회 호출)`,
          }, null, 2),
        };
      }

      // ── Representative mode (기존, 기본값) ──
      const groups = groupByRuleId(report.issues);

      const results = new Map<string, ImprovementResult>();
      for (const group of groups) {
        const result = await generateRuleImprovement(group);
        results.set(group.rule_id, result);
      }

      const markdown = assembleRepresentativeReport(report, groups, results);
      const mdPath = path.join(outputDir, `improvement_${timestamp}.md`);
      fs.writeFileSync(mdPath, markdown, "utf-8");

      const successCount = [...results.values()].filter((r) => !r.error).length;

      return {
        success: true,
        content: JSON.stringify({
          mode: "representative",
          report_path: mdPath,
          total_issues: report.summary.total_issues,
          rule_types: groups.length,
          llm_calls: groups.length,
          successful: successCount,
          failed: groups.length - successCount,
          message: `대표사례 개선 보고서가 생성되었습니다: ${mdPath} (${groups.length}종 rule_id, LLM ${groups.length}회 호출)`,
        }, null, 2),
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

export const generateImprovementTools: Tool[] = [generateImprovementReportTool];
