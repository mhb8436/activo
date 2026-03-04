import fs from "fs";
import path from "path";
import { Tool, ToolResult } from "./types.js";
import { loadApexReport, ApexReport, ApexIssue, createLLMClient } from "./apexUtils.js";

// ─── Markdown Generation ───

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

function generateSeverityTable(report: ApexReport): string {
  const s = report.summary;
  let table = "| 심각도 | 건수 | 비율 |\n";
  table += "|--------|------|------|\n";

  const total = s.total_issues || 1;
  const rows = [
    { label: "Critical", count: s.critical },
    { label: "High", count: s.high },
    { label: "Medium", count: s.medium },
    { label: "Low", count: s.low },
  ];

  for (const row of rows) {
    const pct = Math.round((row.count / total) * 100);
    table += `| ${row.label} | ${row.count} | ${pct}% |\n`;
  }

  table += `| **합계** | **${s.total_issues}** | **100%** |\n`;
  return table;
}

function generateHotspotsSection(issues: ApexIssue[], topN: number = 10): string {
  const fileMap = new Map<string, number>();
  for (const issue of issues) {
    const f = issue.file || "unknown";
    fileMap.set(f, (fileMap.get(f) || 0) + 1);
  }

  const sorted = Array.from(fileMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  if (sorted.length === 0) return "";

  let md = "## 핫스팟 파일 (Top 10)\n\n";
  md += "| # | 파일 | 이슈 수 |\n";
  md += "|---|------|--------|\n";
  for (let i = 0; i < sorted.length; i++) {
    md += `| ${i + 1} | ${sorted[i][0]} | ${sorted[i][1]} |\n`;
  }

  return md;
}

function generateCategorySection(issues: ApexIssue[]): string {
  const catMap = new Map<string, ApexIssue[]>();
  for (const issue of issues) {
    const cat = issue.category || "기타";
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(issue);
  }

  const sorted = Array.from(catMap.entries()).sort((a, b) => b[1].length - a[1].length);
  if (sorted.length === 0) return "";

  let md = "## 카테고리별 분석\n\n";
  md += "| 카테고리 | 건수 | 비율 |\n";
  md += "|----------|------|------|\n";

  const total = issues.length || 1;
  for (const [cat, catIssues] of sorted) {
    const pct = Math.round((catIssues.length / total) * 100);
    md += `| ${cat} | ${catIssues.length} | ${pct}% |\n`;
  }

  return md;
}

function generateCriticalHighSection(issues: ApexIssue[]): string {
  const critical = issues.filter((i) => i.severity === "critical" || i.severity === "high");

  if (critical.length === 0) return "";

  let md = "## 주요 이슈 (Critical/High)\n\n";

  // Group by severity
  const criticalIssues = critical.filter((i) => i.severity === "critical");
  const highIssues = critical.filter((i) => i.severity === "high");

  if (criticalIssues.length > 0) {
    md += "### Critical\n\n";
    for (const issue of criticalIssues.slice(0, 20)) {
      md += `- **${issue.rule_id}** — ${issue.message}\n`;
      md += `  - 파일: ${issue.file}:${issue.line}\n`;
      if (issue.suggestion) md += `  - 제안: ${issue.suggestion}\n`;
    }
    md += "\n";
  }

  if (highIssues.length > 0) {
    md += "### High\n\n";
    for (const issue of highIssues.slice(0, 20)) {
      md += `- **${issue.rule_id}** — ${issue.message}\n`;
      md += `  - 파일: ${issue.file}:${issue.line}\n`;
      if (issue.suggestion) md += `  - 제안: ${issue.suggestion}\n`;
    }
    md += "\n";
  }

  return md;
}

function generateRecommendations(report: ApexReport): string {
  const s = report.summary;
  const recommendations: string[] = [];

  if (s.critical > 0) {
    recommendations.push(`Critical 이슈 ${s.critical}건을 즉시 수정하세요. 보안 및 안정성에 직접적 영향이 있습니다.`);
  }

  if (s.high > 5) {
    recommendations.push(`High 이슈가 ${s.high}건입니다. 스프린트 내 해결 계획을 수립하세요.`);
  }

  // Check for category concentration
  const catMap = new Map<string, number>();
  for (const issue of report.issues) {
    const cat = issue.category || "기타";
    catMap.set(cat, (catMap.get(cat) || 0) + 1);
  }
  const sortedCats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedCats.length > 0 && sortedCats[0][1] > report.issues.length * 0.4) {
    recommendations.push(`'${sortedCats[0][0]}' 카테고리 이슈가 전체의 ${Math.round((sortedCats[0][1] / (report.issues.length || 1)) * 100)}%입니다. 팀 교육을 통한 근본적 개선을 권장합니다.`);
  }

  // Check for repeated rules
  const ruleMap = new Map<string, number>();
  for (const issue of report.issues) {
    ruleMap.set(issue.rule_id, (ruleMap.get(issue.rule_id) || 0) + 1);
  }
  const topRule = Array.from(ruleMap.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topRule && topRule[1] > 10) {
    recommendations.push(`규칙 '${topRule[0]}'이 ${topRule[1]}회 반복됩니다. IDE 자동 포맷터/린터 설정을 검토하세요.`);
  }

  if (recommendations.length === 0) {
    recommendations.push("전반적으로 양호한 코드 품질입니다. 지속적인 정적분석을 유지하세요.");
  }

  let md = "## 개선 권장사항\n\n";
  for (let i = 0; i < recommendations.length; i++) {
    md += `${i + 1}. ${recommendations[i]}\n`;
  }

  return md;
}

async function generateLLMSummarySection(report: ApexReport): Promise<string> {
  try {
    const client = createLLMClient();

    // Top 3 hotspot files
    const fileMap = new Map<string, number>();
    for (const issue of report.issues) {
      const f = issue.file || "unknown";
      fileMap.set(f, (fileMap.get(f) || 0) + 1);
    }
    const topFiles = Array.from(fileMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f, c]) => `${f} (${c}건)`)
      .join(", ");

    // Top 3 categories
    const catMap = new Map<string, number>();
    for (const issue of report.issues) {
      const cat = issue.category || "기타";
      catMap.set(cat, (catMap.get(cat) || 0) + 1);
    }
    const topCats = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c} (${n}건)`)
      .join(", ");

    const prompt = `당신은 코드 품질 리포트 작성 전문가입니다. 아래 분석 결과를 바탕으로 경영진/팀 리더를 위한 요약을 작성하세요.

[분석 데이터]
- 프로파일: ${report.profiles_used?.join(", ") || "기본"}
- 총 이슈: ${report.summary.total_issues}건
- 심각도: Critical ${report.summary.critical}건, High ${report.summary.high}건, Medium ${report.summary.medium}건, Low ${report.summary.low}건
- 핫스팟: ${topFiles}
- 주요 카테고리: ${topCats}

다음을 작성하세요:
1. 전체 코드 품질 상태 요약 (2-3문장)
2. 핵심 리스크 분석
3. 우선순위별 개선 권장사항 (3-5개)
4. 예상 효과`;

    const response = await client.chat([{ role: "user", content: prompt }]);

    let md = "## AI 분석 요약\n\n";
    md += response.content;
    md += "\n\n";
    return md;
  } catch {
    return "";
  }
}

async function generateMarkdownReport(report: ApexReport, title?: string): Promise<string> {
  const dateStr = formatDate();

  let md = `# ${title || "코드 품질 분석 리포트"}\n\n`;
  md += `- **생성일시**: ${dateStr}\n`;
  if (report.profiles_used?.length) {
    md += `- **프로파일**: ${report.profiles_used.join(", ")}\n`;
  }
  md += `- **분석 파일**: ${report.summary.files_analyzed}개\n`;
  if (report.summary.duration) {
    md += `- **소요시간**: ${report.summary.duration}\n`;
  }
  md += "\n---\n\n";

  // Summary
  md += "## 요약\n\n";
  md += `총 **${report.summary.total_issues}**건의 이슈가 발견되었습니다.\n\n`;
  md += generateSeverityTable(report);
  md += "\n";

  // Hotspots
  md += generateHotspotsSection(report.issues);
  md += "\n";

  // Categories
  md += generateCategorySection(report.issues);
  md += "\n";

  // Critical/High issues
  md += generateCriticalHighSection(report.issues);

  // AI Summary (LLM)
  const aiSummary = await generateLLMSummarySection(report);
  md += aiSummary;

  // Recommendations
  md += generateRecommendations(report);
  md += "\n\n---\n\n*Generated by ACTIVO*\n";

  return md;
}

// ─── Tool Definition ───

const generateReportTool: Tool = {
  name: "generate_report",
  description: "apex 분석 결과(JSON)에서 마크다운 품질 리포트를 생성합니다. 요약, 핫스팟, 카테고리 분석, 주요 이슈, 권장사항을 포함합니다. Use when user asks: '리포트', 'report', '보고서', '품질보고서', 'generate report'.",
  parameters: {
    type: "object",
    required: ["report"],
    properties: {
      report: {
        type: "string",
        description: "apex 분석 결과 JSON 파일 경로 또는 인라인 JSON",
      },
      title: {
        type: "string",
        description: "리포트 제목 (기본: '코드 품질 분석 리포트')",
      },
      output_dir: {
        type: "string",
        description: "출력 디렉토리 (기본: 현재 디렉토리)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const reportArg = args.report as string;
      const title = (args.title as string) || undefined;
      const outputDir = (args.output_dir as string) || ".";

      const report = loadApexReport(reportArg);

      // Generate markdown
      const markdown = await generateMarkdownReport(report, title);

      // Save files
      const timestamp = formatTimestamp();
      fs.mkdirSync(outputDir, { recursive: true });
      fs.mkdirSync(path.join(outputDir, "data"), { recursive: true });

      const mdPath = path.join(outputDir, `${timestamp}.md`);
      const dataPath = path.join(outputDir, "data", `${timestamp}.json`);

      fs.writeFileSync(mdPath, markdown, "utf-8");
      fs.writeFileSync(dataPath, JSON.stringify(report, null, 2), "utf-8");

      return {
        success: true,
        content: JSON.stringify({
          report_path: mdPath,
          data_path: dataPath,
          total_issues: report.summary.total_issues,
          severity: {
            critical: report.summary.critical,
            high: report.summary.high,
            medium: report.summary.medium,
            low: report.summary.low,
          },
          profiles_used: report.profiles_used,
          message: `리포트가 생성되었습니다: ${mdPath}`,
        }, null, 2),
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

export const generateReportTools: Tool[] = [generateReportTool];
