/**
 * Intent Router — 사용자 메시지에서 의도를 감지하고 적절한 도구를 자동 실행
 *
 * agent.ts에서 분리된 모듈 (v0.4.5)
 */
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import { getTool, executeTool, ToolCall, ToolResult, Tool } from "./tools/index.js";
import { resolveRulesetsDir, resolveSchemaPath } from "./tools/apexPaths.js";
import type { AgentEvent } from "./agent.js";

// ─── Types ───

export interface IntentResult {
  handled: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ToolResult;
  summaryPrompt?: string;
}

export interface IntentPattern {
  keywords: string[];
  tool: string;
  buildArgs: (path: string, message: string) => Record<string, unknown>;
}

// ─── Intent Patterns ───

// Intent patterns: keyword groups → tool + args builder
export const INTENT_PATTERNS: IntentPattern[] = [
  // Single file analysis (must come before directory patterns)
  {
    keywords: ["분석", "analyze", "검사", "check"],
    tool: "_single_file",  // special marker - resolved at match time
    buildArgs: (path: string) => ({ filepath: path }),
  },
  // Explain issue (must come before APEX analysis)
  {
    keywords: ["이슈설명", "규칙설명", "왜 문제", "explain issue", "rule explain"],
    tool: "explain_issue",
    buildArgs: (_path: string, message: string) => {
      // Extract rule_id from message (e.g., "이슈설명 quality-nc-001")
      const ruleMatch = message.match(/([a-zA-Z]+-[a-zA-Z]+-\d+)/);
      return { rule_id: ruleMatch ? ruleMatch[1] : message.replace(/이슈설명|규칙설명|왜\s*문제|explain\s*issue|rule\s*explain/gi, "").trim() };
    },
  },
  // Recommend profile (must come before APEX analysis)
  {
    keywords: ["프로파일 추천", "어떤 프로파일", "recommend profile", "어떤 규칙"],
    tool: "recommend_profile",
    buildArgs: (path: string) => ({ path }),
  },
  // Analyze patterns (must come before APEX analysis)
  {
    keywords: ["패턴분석", "이슈패턴", "hotspot", "핫스팟", "pattern analysis"],
    tool: "analyze_patterns",
    buildArgs: (path: string) => ({ report: path }),
  },
  // Generate improvement report (must come before generate_report)
  {
    keywords: ["개선", "코드개선", "개선보고서", "개선 보고서", "improvement", "fix report", "감리", "before after"],
    tool: "generate_improvement_report",
    buildArgs: (path: string, message: string) => {
      // Check for Excel paste: tab-separated text with rule_id pattern
      if (message.includes("\t") && /[a-zA-Z]+-[a-zA-Z]+-\w+/.test(message)) {
        // Extract paste text: everything after the first keyword match
        const keywords = ["개선", "코드개선", "개선보고서", "improvement", "fix report", "감리", "before after", "이거"];
        let pasteText = message;
        for (const kw of keywords) {
          const idx = message.toLowerCase().indexOf(kw);
          if (idx >= 0) {
            // Find the first line with a tab after the keyword
            const afterKeyword = message.slice(idx + kw.length).trim();
            const firstTabLine = afterKeyword.split("\n").findIndex((l) => l.includes("\t"));
            if (firstTabLine >= 0) {
              pasteText = afterKeyword.split("\n").slice(firstTabLine).join("\n");
              break;
            }
          }
        }
        return { report: pasteText };
      }

      const allPaths = extractPaths(message);
      let reportPath = "";
      let outputDir = ".";

      for (const p of allPaths) {
        try {
          const stat = fs.statSync(p);
          if (stat.isFile()) {
            if (!reportPath) reportPath = p;
          } else if (stat.isDirectory()) {
            outputDir = p;
          }
        } catch { /* skip */ }
      }

      if (!reportPath) reportPath = path;
      return { report: reportPath, output_dir: outputDir };
    },
  },
  // Excel export (must come before generate_report)
  {
    keywords: ["엑셀", "excel", "xlsx", "엑셀출력", "엑셀보고서"],
    tool: "mcp_apex_export_excel",
    buildArgs: (_path: string, message: string) => {
      // Extract output file path from message if present
      const allPaths = extractPaths(message);
      const outputFile = allPaths.find((p) => p.endsWith(".xlsx") || p.endsWith(".xls")) || "apex-report.xlsx";
      return { output_file: outputFile };
    },
  },
  // Generate report (must come before APEX analysis)
  {
    keywords: ["리포트", "report", "보고서", "품질보고서"],
    tool: "generate_report",
    buildArgs: (path: string, message: string) => {
      const allPaths = extractPaths(message);
      let reportPath = "";
      let outputDir = "."; // 기본: activo 실행 디렉토리 (CWD)

      // 기존 경로 분류: 파일 → report, 디렉토리 → output_dir
      for (const p of allPaths) {
        try {
          const stat = fs.statSync(p);
          if (stat.isFile()) {
            if (!reportPath) reportPath = p;
          } else if (stat.isDirectory()) {
            outputDir = p;
          }
        } catch { /* skip */ }
      }

      if (!reportPath) reportPath = path;

      // 존재하지 않는 디렉토리 경로 추출 (새 출력 디렉토리)
      if (outputDir === ".") {
        const pathLike = message.match(/(?:^|\s)(\/[^\s,;:'"]+)/g);
        if (pathLike) {
          for (const raw of pathLike) {
            const p = raw.trim();
            if (p === reportPath) continue;
            // 부모 디렉토리가 존재하면 새 출력 경로로 사용
            const parentDir = p.substring(0, p.lastIndexOf("/")) || "/";
            try {
              if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
                outputDir = p;
                break;
              }
            } catch { /* skip */ }
          }
        }
      }

      return { report: reportPath, output_dir: outputDir };
    },
  },
  // Rule generation (must come before APEX analysis)
  {
    keywords: ["규칙생성", "규칙 생성", "generate rules", "커스텀 규칙", "custom rule", "규칙 YAML", "rule yaml"],
    tool: "generate_apex_rules",
    buildArgs: (path: string) => ({
      standards_dir: path || ".activo/standards",
      schema_path: resolveSchemaPath(),
      existing_rulesets_dir: resolveRulesetsDir(),
      output_dir: ".activo/generated-rules",
    }),
  },
  // APEX static analysis — 400+ rules, ANTLR4 AST (must come before generic patterns)
  {
    keywords: ["개발표준", "품질검사", "apex", "시큐어코딩", "secure coding", "전자정부", "egov", "정적분석", "표준검사", "코드표준"],
    tool: "mcp_apex_analyze_code",
    buildArgs: (path: string, message: string) => {
      const msg = message.toLowerCase();
      let profile = "all";
      if (/시큐어|secure|보안/.test(msg)) profile = "secure";
      else if (/sql/.test(msg)) profile = "sql-all";
      else if (/전자정부|egov/.test(msg)) profile = "egov-full";
      else if (/spring|스프링/.test(msg)) profile = "spring";
      else if (/품질|quality/.test(msg)) profile = "quality";
      else if (/모더나이즈|modernize|마이그레이션|migration/.test(msg)) profile = "migration";
      return { path, profile, max_issues: 30 };
    },
  },
  // analyze_all with Java filter
  {
    keywords: ["자바", "java"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["java"] }),
  },
  // Spring patterns
  {
    keywords: ["spring", "스프링"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["java"] }),
  },
  // Dependency analysis
  {
    keywords: ["의존성", "dependency", "dependencies", "취약점"],
    tool: "dependency_check",
    buildArgs: (path: string) => ({ path }),
  },
  // Complexity
  {
    keywords: ["복잡도", "complexity"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path }),
  },
  // Python
  {
    keywords: ["python", "파이썬", ".py"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["py"] }),
  },
  // Frontend
  {
    keywords: ["react", "리액트", "vue", "뷰", "프론트엔드", "frontend"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["js", "ts", "jsx", "tsx", "vue"] }),
  },
  // CSS
  {
    keywords: ["css", "scss", "less", "스타일"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["css"] }),
  },
  // HTML
  {
    keywords: ["html", "jsp", "접근성", "a11y", "seo"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["html"] }),
  },
  // SQL / MyBatis
  {
    keywords: ["sql", "mybatis", "마이바티스", "쿼리"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path, include: ["java", "xml"] }),
  },
  // Broad analysis (catch-all, must be last)
  {
    keywords: ["전체분석", "전체 분석", "분석해", "코드품질", "코드 품질", "analyze", "분석", "검사", "check"],
    tool: "analyze_all",
    buildArgs: (path: string) => ({ path }),
  },
];

// ─── File Extension → Tool Mapping ───

// File extension → single-file tool mapping
export const FILE_TOOL_MAP: Record<string, string> = {
  ".java": "java_analyze",
  ".js": "ast_analyze",
  ".ts": "ast_analyze",
  ".jsx": "react_check",
  ".tsx": "react_check",
  ".vue": "vue_check",
  ".py": "python_check",
  ".css": "css_check",
  ".scss": "css_check",
  ".less": "css_check",
  ".html": "html_check",
  ".htm": "html_check",
  ".jsp": "html_check",
};

// ─── Path Extraction ───

/**
 * Extract filesystem paths from user message.
 * Handles quoted paths (with spaces), simple paths, and greedy path expansion.
 */
export function extractPaths(message: string): string[] {
  const paths: string[] = [];

  // 1. Quoted paths: '...' or "..."
  const quotedMatches = message.match(/['"]([/\\][^'"]+)['"]/g);
  if (quotedMatches) {
    for (const m of quotedMatches) {
      paths.push(m.slice(1, -1)); // strip quotes
    }
  }

  // 2. Simple paths (no spaces) - Unix & Windows
  const unixMatches = message.match(/(?:^|\s)(\/[^\s,;:'"]+)/g);
  if (unixMatches) {
    for (const m of unixMatches) {
      paths.push(m.trim());
    }
  }
  const winMatches = message.match(/(?:^|\s)([A-Z]:\\[^\s,;:'"]+)/gi);
  if (winMatches) {
    for (const m of winMatches) {
      paths.push(m.trim());
    }
  }

  // 3. Greedy path expansion: if simple match doesn't exist,
  //    try extending with subsequent words until path is valid
  if (paths.length === 0 || !paths.some((p) => { try { return fs.existsSync(p); } catch { return false; } })) {
    const words = message.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      if (words[i].startsWith("/") || /^[A-Z]:\\/i.test(words[i])) {
        // Found a path start, try extending
        let candidate = words[i];
        let bestPath = "";
        // Check initial segment
        try { if (fs.existsSync(candidate)) bestPath = candidate; } catch { /* */ }
        // Extend with subsequent words
        for (let j = i + 1; j < words.length; j++) {
          const extended = candidate + " " + words[j];
          try {
            if (fs.existsSync(extended)) {
              bestPath = extended;
              candidate = extended;
            } else {
              // No more valid extensions - stop
              break;
            }
          } catch {
            break;
          }
        }
        if (bestPath) {
          paths.push(bestPath);
        }
      }
    }
  }

  // Filter to actually existing paths, deduplicate
  const seen = new Set<string>();
  return paths.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

// ─── Helper Functions ───

/**
 * Determine if a path is a single file (not a directory).
 */
export function isSingleFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the correct tool for a single file based on extension.
 */
export function resolveFileAnalysisTool(filepath: string): { tool: string; args: Record<string, unknown> } | null {
  const ext = filepath.substring(filepath.lastIndexOf(".")).toLowerCase();
  const toolName = FILE_TOOL_MAP[ext];
  if (!toolName) return null;

  // Some tools use 'filepath', others use 'path'
  const argKey = ["python_check", "css_check", "html_check"].includes(toolName) ? "path" : "filepath";
  return { tool: toolName, args: { [argKey]: filepath } };
}

// ─── Intent Detection & Execution ───

/**
 * Detect user intent from the message and automatically execute the appropriate tool.
 * Returns IntentResult with handled=true if a tool was executed, false otherwise.
 */
export async function detectAndExecuteIntent(
  userMessage: string,
  onEvent?: (event: AgentEvent) => void
): Promise<IntentResult> {
  const msg = userMessage.toLowerCase();
  const paths = extractPaths(userMessage);

  // Pipeline intent: PDF → 규칙 생성 (no explicit path needed)
  if (isPdfToRulesIntent(msg)) {
    return await executePdfToRulesPipeline(userMessage, onEvent);
  }

  // Pipeline intent: 전체 보고서 (분석 + Excel + Markdown + 개선보고서)
  if (isFullReportIntent(msg)) {
    return await executeFullReportPipeline(userMessage, onEvent);
  }

  // Excel paste detection: tab-separated text with rule_id pattern (no file path needed)
  if (paths.length === 0 && userMessage.includes("\t") && /[a-zA-Z]+-[a-zA-Z]+-\w+/.test(userMessage)) {
    const improvementKeywords = ["개선", "코드개선", "개선보고서", "improvement", "fix report", "감리", "before after"];
    if (improvementKeywords.some((kw) => msg.includes(kw)) && getTool("generate_improvement_report")) {
      const pattern = INTENT_PATTERNS.find((p) => p.tool === "generate_improvement_report");
      if (pattern) {
        const args = pattern.buildArgs("", userMessage);
        return await executeIntentTool("generate_improvement_report", args, onEvent);
      }
    }
  }

  // No path found → can't auto-route
  if (paths.length === 0) {
    return { handled: false };
  }

  const targetPath = paths[0];

  // Check if path is a single file
  if (isSingleFile(targetPath)) {
    const fileInfo = resolveFileAnalysisTool(targetPath);
    if (fileInfo) {
      return await executeIntentTool(fileInfo.tool, fileInfo.args, onEvent);
    }
    // Unknown file type → fall back to LLM
    return { handled: false };
  }

  // Path is a directory → match intent patterns
  for (const pattern of INTENT_PATTERNS) {
    // Skip the single-file marker for directories
    if (pattern.tool === "_single_file") continue;

    if (pattern.keywords.some((kw) => msg.includes(kw))) {
      // Skip if tool not available (e.g., MCP server not connected)
      if (!getTool(pattern.tool)) continue;
      const args = pattern.buildArgs(targetPath, userMessage);
      return await executeIntentTool(pattern.tool, args, onEvent);
    }
  }

  // Has a directory path but no matching keyword → default to analyze_all
  // (user likely wants some kind of analysis if they provided a path)
  const hasAnalysisHint = /분석|검사|확인|체크|check|analyze|review|scan|report/i.test(msg);
  if (hasAnalysisHint) {
    return await executeIntentTool("analyze_all", { path: targetPath }, onEvent);
  }

  return { handled: false };
}

/**
 * Execute a tool by name and return an IntentResult with the summary prompt.
 */
async function executeIntentTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  onEvent?: (event: AgentEvent) => void
): Promise<IntentResult> {
  const toolCall: ToolCall = {
    id: `intent_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: toolName,
    arguments: toolArgs,
  };

  // Emit tool_use start event
  onEvent?.({
    type: "tool_use",
    tool: toolName,
    status: "start",
    args: toolArgs,
  });

  const result = await executeTool(toolCall);

  // Emit tool_result event
  onEvent?.({
    type: "tool_result",
    tool: toolName,
    status: result.success ? "complete" : "error",
    result,
  });

  if (!result.success) {
    return {
      handled: true,
      toolName,
      toolArgs,
      toolResult: result,
      summaryPrompt: `도구 "${toolName}" 실행 중 오류가 발생했습니다: ${result.error}\n사용자에게 오류 내용을 설명해주세요.`,
    };
  }

  // Compress result to fit in context window
  const compressed = compressAnalysisResult(result.content);

  return {
    handled: true,
    toolName,
    toolArgs,
    toolResult: result,
    summaryPrompt: `아래는 "${toolName}" 도구의 실행 결과입니다. 사용자에게 한국어로 핵심 내용을 요약해주세요.\n\n${compressed}`,
  };
}

// ─── Result Compression ───

/**
 * Compress analysis result JSON to fit within LLM context window.
 * Extracts only key metrics, removing verbose raw data.
 */
export function compressAnalysisResult(resultContent: string, maxChars: number = 2000): string {
  try {
    const parsed = JSON.parse(resultContent);

    // apex MCP result (has summary + profiles_used)
    if (parsed.summary && parsed.profiles_used !== undefined) {
      const compact: Record<string, unknown> = {
        summary: parsed.summary,
        profiles_used: parsed.profiles_used,
        duration: parsed.duration,
        total_issues: parsed.total_issues,
      };
      if (parsed.top_issues) {
        compact.top_issues = parsed.top_issues.slice(0, 15);
      }
      const result = JSON.stringify(compact, null, 1);
      return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
    }

    // analyze_all result
    if (parsed.path && parsed.fileStats) {
      const compact: Record<string, unknown> = {
        path: parsed.path,
        totalFiles: parsed.totalFiles,
        fileStats: parsed.fileStats,
        analysesRun: parsed.analysesRun,
        successful: parsed.successful,
        failed: parsed.failed,
      };

      // Extract issue summaries (compact)
      if (parsed.issuesSummary?.length > 0) {
        compact.issues = parsed.issuesSummary.map((is: { tool: string; issues: string[] }) => ({
          tool: is.tool,
          issues: is.issues.slice(0, 5),
        }));
      }

      // Extract per-tool summaries (key metrics only)
      if (parsed.details?.length > 0) {
        compact.analyses = parsed.details.map((d: { tool: string; summary: Record<string, unknown> }) => {
          const s = d.summary;
          const brief: Record<string, unknown> = { tool: d.tool };

          // Extract numeric/small fields only
          for (const [k, v] of Object.entries(s)) {
            if (typeof v === "number" || typeof v === "boolean") {
              brief[k] = v;
            } else if (typeof v === "string" && v.length < 100) {
              brief[k] = v;
            }
            // Skip arrays/objects (raw data) to save space
          }

          // Include issues from samples (java_analyze etc.)
          if (Array.isArray((s as any).samples)) {
            const allIssues: unknown[] = [];
            for (const sample of (s as any).samples) {
              if (Array.isArray(sample.result?.issues)) {
                allIssues.push(...sample.result.issues.slice(0, 3));
              }
            }
            if (allIssues.length > 0) {
              brief.issues = allIssues.slice(0, 10);
            }
          }

          return brief;
        });
      }

      if (parsed.errors?.length > 0) {
        compact.errors = parsed.errors;
      }

      const result = JSON.stringify(compact, null, 1);
      return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
    }

    // java_analyze or other single-file results
    if (parsed.file || parsed.filepath || parsed.classes || parsed.functions) {
      const result = JSON.stringify(parsed, null, 1);
      return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
    }

    // Generic: just truncate
    const result = JSON.stringify(parsed, null, 1);
    return result.length > maxChars ? result.slice(0, maxChars) + "..." : result;
  } catch {
    // Not valid JSON, return truncated raw text
    return resultContent.length > maxChars ? resultContent.slice(0, maxChars) + "..." : resultContent;
  }
}

// ─── Pipeline Intents ───

/**
 * Detect if the message is a "PDF → 규칙 생성" workflow.
 */
function isPdfToRulesIntent(msg: string): boolean {
  const hasPdf = /pdf/.test(msg);
  const hasRuleKeyword = /규칙|룰|rule|만들어/.test(msg);
  const hasStandardKeyword = /개발\s*표준|표준|standard/.test(msg);
  return hasPdf && (hasRuleKeyword || hasStandardKeyword);
}

/**
 * Execute the PDF → Rules pipeline:
 *  1. Find PDF files in CWD
 *  2. import_pdf_standards for each
 *  3. generate_apex_rules from the converted standards
 */
async function executePdfToRulesPipeline(
  userMessage: string,
  onEvent?: (event: AgentEvent) => void
): Promise<IntentResult> {
  const cwd = process.cwd();
  const allResults: string[] = [];

  // Step 1: Find PDF files
  // Try to extract a glob pattern from the message (e.g., "FSS*.pdf")
  const pdfPatternMatch = userMessage.match(/([A-Za-z가-힣0-9*?_-]+\.pdf)/i);
  const pdfGlob = pdfPatternMatch ? pdfPatternMatch[1] : "*.pdf";
  let pdfFiles = await glob(pdfGlob, { cwd, absolute: true });

  // Fallback: if exact pattern doesn't match, try *.pdf
  if (pdfFiles.length === 0 && pdfGlob !== "*.pdf") {
    pdfFiles = await glob("*.pdf", { cwd, absolute: true });
  }

  if (pdfFiles.length === 0) {
    return {
      handled: true,
      toolName: "import_pdf_standards",
      toolArgs: { pattern: pdfGlob },
      toolResult: { success: false, content: "", error: `PDF 파일을 찾을 수 없습니다: ${pdfGlob} (경로: ${cwd})` },
      summaryPrompt: `현재 디렉토리(${cwd})에서 PDF 파일을 찾을 수 없습니다. 도구를 호출하지 말고, 사용자에게 PDF 파일 위치를 확인하라고 안내해주세요.`,
    };
  }

  // Step 2: Import each PDF → MD
  const standardsDir = path.resolve(cwd, ".activo/standards");
  for (const pdfPath of pdfFiles) {
    const importArgs = { pdfPath, outputDir: standardsDir };
    onEvent?.({ type: "tool_use", tool: "import_pdf_standards", status: "start", args: importArgs });

    const importCall: ToolCall = {
      id: `pipeline_import_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: "import_pdf_standards",
      arguments: importArgs,
    };
    const importResult = await executeTool(importCall);
    onEvent?.({
      type: "tool_result",
      tool: "import_pdf_standards",
      status: importResult.success ? "complete" : "error",
      result: importResult,
    });

    if (importResult.success) {
      allResults.push(`PDF 변환 완료: ${path.basename(pdfPath)}`);
    } else {
      allResults.push(`PDF 변환 실패: ${path.basename(pdfPath)} — ${importResult.error}`);
    }
  }

  // Step 3: Generate rules from converted standards
  const ruleArgs = {
    standards_dir: standardsDir,
    schema_path: resolveSchemaPath(),
    existing_rulesets_dir: resolveRulesetsDir(),
    output_dir: path.resolve(cwd, ".activo/generated-rules"),
  };

  onEvent?.({ type: "tool_use", tool: "generate_apex_rules", status: "start", args: ruleArgs });

  const ruleCall: ToolCall = {
    id: `pipeline_rules_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name: "generate_apex_rules",
    arguments: ruleArgs,
  };
  const ruleResult = await executeTool(ruleCall);
  onEvent?.({
    type: "tool_result",
    tool: "generate_apex_rules",
    status: ruleResult.success ? "complete" : "error",
    result: ruleResult,
  });

  if (ruleResult.success) {
    allResults.push(`규칙 생성 완료`);
  } else {
    allResults.push(`규칙 생성 실패: ${ruleResult.error}`);
  }

  // Build summary for LLM
  const compressed = ruleResult.success
    ? compressAnalysisResult(ruleResult.content, 4000)
    : `오류: ${ruleResult.error}`;

  return {
    handled: true,
    toolName: "generate_apex_rules",
    toolArgs: ruleArgs,
    toolResult: ruleResult,
    summaryPrompt: `PDF 개발표준을 분석하여 YAML 규칙을 생성했습니다.\n\n처리된 PDF: ${pdfFiles.map(f => path.basename(f)).join(", ")}\n\n생성 결과:\n${compressed}\n\n사용자에게 한국어로 생성된 규칙의 내용과 수량을 요약해주세요. 생성된 규칙 파일 경로도 안내해주세요.`,
  };
}

/**
 * Detect if the message is a "전체 보고서" workflow intent.
 * 키워드: 전체보고서, 종합보고서, 전체리포트, full report, complete report
 */
function isFullReportIntent(msg: string): boolean {
  return /전체\s*보고서|종합\s*보고서|전체\s*리포트|full\s*report|complete\s*report/.test(msg);
}

/**
 * Execute the Full Report pipeline:
 *  1. mcp_apex_analyze_code (all profiles)
 *  2. mcp_apex_export_excel → .xlsx
 *  3. generate_report → .md
 *  4. generate_improvement_report → 개선코드 .md
 */
async function executeFullReportPipeline(
  userMessage: string,
  onEvent?: (event: AgentEvent) => void
): Promise<IntentResult> {
  const paths = extractPaths(userMessage);
  if (paths.length === 0) {
    return { handled: false };
  }

  const targetPath = paths[0];
  const outputDir = paths.find((p) => {
    try { return fs.statSync(p).isDirectory() && p !== targetPath; } catch { return false; }
  }) || ".";

  const allSteps: string[] = [];
  let analysisJson = "";
  let excelPath = "";
  let mdPath = "";
  let improvementPath = "";

  // Step 1: apex 분석
  const analyzeArgs = { path: targetPath, profile: "all", max_issues: 100 };
  onEvent?.({ type: "tool_use", tool: "mcp_apex_analyze_code", status: "start", args: analyzeArgs });
  const analyzeCall: ToolCall = {
    id: `fullreport_analyze_${Date.now()}`,
    name: "mcp_apex_analyze_code",
    arguments: analyzeArgs,
  };
  const analyzeResult = await executeTool(analyzeCall);
  onEvent?.({ type: "tool_result", tool: "mcp_apex_analyze_code", status: analyzeResult.success ? "complete" : "error", result: analyzeResult });

  if (!analyzeResult.success) {
    return {
      handled: true,
      toolName: "mcp_apex_analyze_code",
      toolArgs: analyzeArgs,
      toolResult: analyzeResult,
      summaryPrompt: `분석 중 오류가 발생했습니다: ${analyzeResult.error}\n사용자에게 오류를 설명해주세요.`,
    };
  }
  analysisJson = analyzeResult.content;
  allSteps.push("✓ 코드 분석 완료");

  // Step 2: Excel 출력
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  fs.mkdirSync(outputDir, { recursive: true });

  const xlsxFile = path.join(outputDir, `${timestamp}.xlsx`);
  const excelArgs = { output_file: xlsxFile };
  onEvent?.({ type: "tool_use", tool: "mcp_apex_export_excel", status: "start", args: excelArgs });
  const excelCall: ToolCall = {
    id: `fullreport_excel_${Date.now()}`,
    name: "mcp_apex_export_excel",
    arguments: excelArgs,
  };
  const excelResult = await executeTool(excelCall);
  onEvent?.({ type: "tool_result", tool: "mcp_apex_export_excel", status: excelResult.success ? "complete" : "error", result: excelResult });

  if (excelResult.success) {
    try { excelPath = JSON.parse(excelResult.content).output_file || xlsxFile; } catch { excelPath = xlsxFile; }
    allSteps.push(`✓ Excel 생성: ${excelPath}`);
  } else {
    allSteps.push(`⚠ Excel 생성 실패: ${excelResult.error}`);
  }

  // Step 3: Markdown 보고서
  const reportArgs = { report: analysisJson, output_dir: outputDir, with_excel: false };
  onEvent?.({ type: "tool_use", tool: "generate_report", status: "start", args: reportArgs });
  const reportCall: ToolCall = {
    id: `fullreport_md_${Date.now()}`,
    name: "generate_report",
    arguments: reportArgs,
  };
  const reportResult = await executeTool(reportCall);
  onEvent?.({ type: "tool_result", tool: "generate_report", status: reportResult.success ? "complete" : "error", result: reportResult });

  if (reportResult.success) {
    try { mdPath = JSON.parse(reportResult.content).report_path || ""; } catch { /* skip */ }
    allSteps.push(`✓ 보고서 생성: ${mdPath}`);
  } else {
    allSteps.push(`⚠ 보고서 생성 실패: ${reportResult.error}`);
  }

  // Step 4: 개선 보고서
  const improvArgs = { report: analysisJson, output_dir: outputDir };
  onEvent?.({ type: "tool_use", tool: "generate_improvement_report", status: "start", args: improvArgs });
  const improvCall: ToolCall = {
    id: `fullreport_improv_${Date.now()}`,
    name: "generate_improvement_report",
    arguments: improvArgs,
  };
  const improvResult = await executeTool(improvCall);
  onEvent?.({ type: "tool_result", tool: "generate_improvement_report", status: improvResult.success ? "complete" : "error", result: improvResult });

  if (improvResult.success) {
    try { improvementPath = JSON.parse(improvResult.content).report_path || ""; } catch { /* skip */ }
    allSteps.push(`✓ 개선 보고서 생성: ${improvementPath}`);
  } else {
    allSteps.push(`⚠ 개선 보고서 생성 실패: ${improvResult.error}`);
  }

  const summaryData = compressAnalysisResult(analysisJson, 3000);

  return {
    handled: true,
    toolName: "generate_report",
    toolArgs: reportArgs,
    toolResult: reportResult,
    summaryPrompt: `전체 보고서 파이프라인이 완료되었습니다.\n\n진행 결과:\n${allSteps.join("\n")}\n\n분석 요약:\n${summaryData}\n\n사용자에게 한국어로 다음을 안내해주세요:\n1. 생성된 파일 목록과 경로 (Excel: ${excelPath}, 보고서: ${mdPath}, 개선보고서: ${improvementPath})\n2. 주요 이슈 통계 요약\n3. 우선 조치 권장사항`,
  };
}
