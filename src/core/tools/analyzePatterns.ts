import { Tool, ToolResult } from "./types.js";
import { loadApexReport, ApexIssue, createLLMClient } from "./apexUtils.js";

// ─── Analysis Helpers ───

interface CategoryStats {
  category: string;
  count: number;
  percentage: number;
  severities: Record<string, number>;
  topRules: Array<{ rule_id: string; rule_name: string; count: number }>;
}

interface FileHotspot {
  file: string;
  issueCount: number;
  critical: number;
  high: number;
  topRules: string[];
}

interface LayerStats {
  layer: string;
  count: number;
  percentage: number;
  topCategories: string[];
}

function analyzeCategoryDistribution(issues: ApexIssue[]): CategoryStats[] {
  const catMap = new Map<string, ApexIssue[]>();

  for (const issue of issues) {
    const cat = issue.category || "기타";
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(issue);
  }

  const total = issues.length || 1;

  return Array.from(catMap.entries())
    .map(([category, catIssues]) => {
      // Severity distribution
      const severities: Record<string, number> = {};
      for (const i of catIssues) {
        severities[i.severity] = (severities[i.severity] || 0) + 1;
      }

      // Top rules in category
      const ruleMap = new Map<string, { rule_name: string; count: number }>();
      for (const i of catIssues) {
        const key = i.rule_id;
        if (!ruleMap.has(key)) ruleMap.set(key, { rule_name: i.rule_name, count: 0 });
        ruleMap.get(key)!.count++;
      }
      const topRules = Array.from(ruleMap.entries())
        .map(([rule_id, v]) => ({ rule_id, rule_name: v.rule_name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        category,
        count: catIssues.length,
        percentage: Math.round((catIssues.length / total) * 100),
        severities,
        topRules,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function analyzeFileHotspots(issues: ApexIssue[], topN: number = 20): FileHotspot[] {
  const fileMap = new Map<string, ApexIssue[]>();

  for (const issue of issues) {
    const file = issue.file || "unknown";
    if (!fileMap.has(file)) fileMap.set(file, []);
    fileMap.get(file)!.push(issue);
  }

  return Array.from(fileMap.entries())
    .map(([file, fileIssues]) => {
      const ruleSet = new Set<string>();
      let critical = 0;
      let high = 0;
      for (const i of fileIssues) {
        ruleSet.add(i.rule_id);
        if (i.severity === "critical") critical++;
        else if (i.severity === "high") high++;
      }
      return {
        file,
        issueCount: fileIssues.length,
        critical,
        high,
        topRules: Array.from(ruleSet).slice(0, 5),
      };
    })
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, topN);
}

function analyzeRepeatedRules(issues: ApexIssue[], topN: number = 10): Array<{ rule_id: string; rule_name: string; count: number; severity: string; category: string }> {
  const ruleMap = new Map<string, { rule_name: string; count: number; severity: string; category: string }>();

  for (const issue of issues) {
    if (!ruleMap.has(issue.rule_id)) {
      ruleMap.set(issue.rule_id, {
        rule_name: issue.rule_name,
        count: 0,
        severity: issue.severity,
        category: issue.category,
      });
    }
    ruleMap.get(issue.rule_id)!.count++;
  }

  return Array.from(ruleMap.entries())
    .map(([rule_id, v]) => ({ rule_id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function analyzeLayerPatterns(issues: ApexIssue[]): LayerStats[] {
  const layerPatterns: Array<{ pattern: RegExp; layer: string }> = [
    { pattern: /Controller|Rest.*Controller|.*Api\./i, layer: "Controller" },
    { pattern: /Service|ServiceImpl|.*Svc\./i, layer: "Service" },
    { pattern: /Repository|Dao|Mapper|.*Repo\./i, layer: "Repository/DAO" },
    { pattern: /Entity|Model|Dto|Vo\./i, layer: "Entity/DTO" },
    { pattern: /Config|Configuration|.*Conf\./i, layer: "Config" },
    { pattern: /Util|Helper|Common|.*Utils\./i, layer: "Util" },
  ];

  const layerMap = new Map<string, ApexIssue[]>();
  const unclassified: ApexIssue[] = [];

  for (const issue of issues) {
    let matched = false;
    for (const { pattern, layer } of layerPatterns) {
      if (pattern.test(issue.file)) {
        if (!layerMap.has(layer)) layerMap.set(layer, []);
        layerMap.get(layer)!.push(issue);
        matched = true;
        break;
      }
    }
    if (!matched) {
      unclassified.push(issue);
    }
  }

  if (unclassified.length > 0) {
    layerMap.set("기타", unclassified);
  }

  const total = issues.length || 1;

  return Array.from(layerMap.entries())
    .map(([layer, layerIssues]) => {
      const catCount = new Map<string, number>();
      for (const i of layerIssues) {
        catCount.set(i.category, (catCount.get(i.category) || 0) + 1);
      }
      const topCategories = Array.from(catCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat);

      return {
        layer,
        count: layerIssues.length,
        percentage: Math.round((layerIssues.length / total) * 100),
        topCategories,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function calculateRiskScore(issues: ApexIssue[]): number {
  let score = 0;
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical": score += 10; break;
      case "high": score += 5; break;
      case "medium": score += 2; break;
      case "low": score += 1; break;
    }
  }
  return score;
}

function generateInsights(
  categories: CategoryStats[],
  hotspots: FileHotspot[],
  repeatedRules: Array<{ rule_id: string; count: number; severity: string }>,
  riskScore: number,
): string[] {
  const insights: string[] = [];

  // Category concentration
  if (categories.length > 0 && categories[0].percentage > 40) {
    insights.push(`'${categories[0].category}' 카테고리가 전체 이슈의 ${categories[0].percentage}%를 차지합니다. 이 영역의 개선이 우선됩니다.`);
  }

  // Hotspot concentration
  if (hotspots.length > 0 && hotspots[0].issueCount > 10) {
    insights.push(`'${hotspots[0].file}'에 이슈 ${hotspots[0].issueCount}건이 집중되어 있습니다. 리팩토링을 검토하세요.`);
  }

  // Critical issues
  const criticalCount = hotspots.reduce((sum, h) => sum + h.critical, 0);
  if (criticalCount > 0) {
    insights.push(`Critical 이슈 ${criticalCount}건이 있습니다. 즉시 수정이 필요합니다.`);
  }

  // Repeated rules
  if (repeatedRules.length > 0 && repeatedRules[0].count > 5) {
    insights.push(`규칙 '${repeatedRules[0].rule_id}'가 ${repeatedRules[0].count}회 반복됩니다. 팀 차원의 코딩 가이드 교육이 필요합니다.`);
  }

  // Risk score interpretation
  if (riskScore > 500) {
    insights.push(`리스크 점수 ${riskScore}점 — 심각한 수준입니다. 즉각적인 개선 계획이 필요합니다.`);
  } else if (riskScore > 200) {
    insights.push(`리스크 점수 ${riskScore}점 — 주의가 필요합니다. Critical/High 이슈부터 해결하세요.`);
  } else if (riskScore > 50) {
    insights.push(`리스크 점수 ${riskScore}점 — 양호한 수준이지만 개선 여지가 있습니다.`);
  } else {
    insights.push(`리스크 점수 ${riskScore}점 — 우수한 수준입니다.`);
  }

  return insights;
}

// ─── LLM Insights ───

async function generateLLMInsights(
  totalIssues: number,
  riskScore: number,
  severityDist: Record<string, number>,
  categories: CategoryStats[],
  hotspots: FileHotspot[],
  repeatedRules: Array<{ rule_id: string; rule_name: string; count: number }>,
): Promise<string | undefined> {
  try {
    const client = createLLMClient();

    const catText = categories.slice(0, 5).map(c =>
      `- ${c.category}: ${c.count}건 (${c.percentage}%)`
    ).join("\n");

    const hotspotText = hotspots.slice(0, 5).map(h =>
      `- ${h.file}: ${h.issueCount}건`
    ).join("\n");

    const ruleText = repeatedRules.slice(0, 5).map(r =>
      `- ${r.rule_id}: ${r.count}회`
    ).join("\n");

    const prompt = `당신은 코드 품질 분석 전문가입니다. 아래 정적분석 결과를 분석하고 실행 가능한 인사이트를 제공하세요.

[요약]
- 총 이슈: ${totalIssues}건, 리스크 점수: ${riskScore}
- 심각도: Critical ${severityDist.critical || 0}건, High ${severityDist.high || 0}건, Medium ${severityDist.medium || 0}건, Low ${severityDist.low || 0}건

[카테고리 분포]
${catText}

[핫스팟 파일 Top 5]
${hotspotText}

[반복 규칙 Top 5]
${ruleText}

다음 항목을 분석해주세요:
1. 가장 시급한 개선 영역과 이유
2. 이슈 패턴에서 보이는 팀/프로세스 문제
3. 구체적인 개선 전략 (단기/중기)
4. CI/CD 파이프라인에 추가할 규칙 추천`;

    const response = await client.chat([{ role: "user", content: prompt }]);
    return response.content;
  } catch {
    return undefined;
  }
}

// ─── Tool Definition ───

const analyzePatternsTool: Tool = {
  name: "analyze_patterns",
  description: "apex 분석 결과(JSON)의 이슈 패턴을 분석합니다. 카테고리 분포, 핫스팟 파일, 반복 규칙, 레이어별 집중도, 리스크 점수를 계산합니다. Use when user asks: '패턴분석', '이슈패턴', 'hotspot', '핫스팟', 'pattern analysis'.",
  parameters: {
    type: "object",
    required: ["report"],
    properties: {
      report: {
        type: "string",
        description: "apex 분석 결과 JSON 파일 경로 또는 인라인 JSON",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const reportArg = args.report as string;
      const report = loadApexReport(reportArg);

      if (report.issues.length === 0) {
        return {
          success: true,
          content: JSON.stringify({
            message: "분석할 이슈가 없습니다.",
            summary: report.summary,
          }, null, 2),
        };
      }

      const categories = analyzeCategoryDistribution(report.issues);
      const hotspots = analyzeFileHotspots(report.issues);
      const repeatedRules = analyzeRepeatedRules(report.issues);
      const layers = analyzeLayerPatterns(report.issues);
      const riskScore = calculateRiskScore(report.issues);
      const insights = generateInsights(categories, hotspots, repeatedRules, riskScore);

      // Severity distribution
      const severityDist: Record<string, number> = {
        critical: report.summary.critical,
        high: report.summary.high,
        medium: report.summary.medium,
        low: report.summary.low,
      };

      // LLM insights (graceful fallback)
      const llmInsights = await generateLLMInsights(
        report.issues.length, riskScore, severityDist,
        categories, hotspots, repeatedRules,
      );

      const result: Record<string, unknown> = {
        total_issues: report.issues.length,
        risk_score: riskScore,
        severity_distribution: severityDist,
        category_analysis: categories,
        file_hotspots: hotspots,
        repeated_rules: repeatedRules,
        layer_patterns: layers,
        insights,
        profiles_used: report.profiles_used,
      };

      if (llmInsights) {
        result.llm_insights = llmInsights;
      }

      return {
        success: true,
        content: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

export const analyzePatternsTools: Tool[] = [analyzePatternsTool];
