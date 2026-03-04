/**
 * Anthropic vs Ollama 보고서 품질 비교 스크립트
 *
 * 동일한 apex MCP 분석 결과로 두 LLM의 보고서를 생성하고 비교한다.
 * - 보고서 1: Anthropic (claude-sonnet)
 * - 보고서 2: Ollama (qwen2.5-coder:7b)
 *
 * Usage: npx tsx scripts/compare-llm-reports.ts
 */
import fs from "fs";
import path from "path";
import { AnthropicClient } from "../src/core/llm/anthropic.js";
import { OllamaClient } from "../src/core/llm/ollama.js";
import { loadApexReport, ApexReport, ApexIssue } from "../src/core/tools/apexUtils.js";
import type { LLMClient, ChatMessage } from "../src/core/llm/types.js";

// ─── 설정 ───

const APEX_RESULT_PATH = ".activo/e2e-reports/data/apex-spo-result.json";
const OUTPUT_DIR = ".activo/llm-compare";

// ─── 초급 개발자 대상 보고서 프롬프트 ───

function buildJuniorDevPrompt(report: ApexReport): string {
  // 이슈를 카테고리별로 그룹핑
  const categoryGroups = new Map<string, ApexIssue[]>();
  for (const issue of report.issues) {
    const cat = issue.category || "기타";
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
    categoryGroups.get(cat)!.push(issue);
  }

  // 상위 5개 카테고리만
  const sortedCategories = Array.from(categoryGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  // 이슈 샘플 (카테고리별 대표 이슈 1-2건)
  let issueSamples = "";
  for (const [cat, issues] of sortedCategories) {
    issueSamples += `\n### ${cat} (${issues.length}건)\n`;
    for (const issue of issues.slice(0, 2)) {
      issueSamples += `- rule: ${issue.rule_id}, severity: ${issue.severity}\n`;
      issueSamples += `  file: ${path.basename(issue.file)}:${issue.line}\n`;
      issueSamples += `  message: ${issue.message}\n`;
      if (issue.suggestion) issueSamples += `  suggestion: ${issue.suggestion}\n`;
    }
  }

  // 핫스팟 파일 Top 5
  const fileMap = new Map<string, number>();
  for (const issue of report.issues) {
    const f = path.basename(issue.file || "unknown");
    fileMap.set(f, (fileMap.get(f) || 0) + 1);
  }
  const topFiles = Array.from(fileMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f, c]) => `- ${f}: ${c}건`)
    .join("\n");

  return `당신은 초급 개발자(1-3년차)를 위한 코드 품질 보고서 작성 전문가입니다.
이 보고서는 처음 정적분석 도구를 사용하는 개발자가 읽을 것입니다.

## 작성 규칙
1. 전문 용어는 반드시 쉬운 설명을 괄호 안에 추가하세요
2. 각 이슈 유형마다 "왜 문제인가?", "어떻게 고치나?" 를 포함하세요
3. 코드 예시(Before/After)를 가능한 포함하세요
4. 한국어로 작성하세요
5. 친절하고 격려하는 톤을 사용하세요 (초급 개발자가 위축되지 않도록)

## 분석 데이터

**프로젝트 요약**
- 총 분석 파일: ${report.summary.files_analyzed}개
- 총 이슈: ${report.summary.total_issues}건
- Critical: ${report.summary.critical}건, High: ${report.summary.high}건
- Medium: ${report.summary.medium}건, Low: ${report.summary.low}건
- 프로파일: ${report.profiles_used?.join(", ") || "기본"}

**핫스팟 파일 (이슈가 많은 파일)**
${topFiles}

**주요 이슈 유형별 샘플**
${issueSamples}

## 요청
위 데이터를 바탕으로 아래 구조의 마크다운 보고서를 작성하세요:

1. **요약** — 전체 상태를 초급 개발자도 이해할 수 있게 설명
2. **이슈 유형별 상세 설명** — 각 카테고리마다:
   - 이 이슈가 왜 문제인지 (실제 장애/성능 사례)
   - 어떻게 고치면 좋은지 (Before/After 코드 예시)
   - 우선순위 (지금 당장 vs 나중에)
3. **핫스팟 파일 분석** — 이슈가 집중된 파일에 대한 조언
4. **학습 가이드** — 이 이슈를 줄이기 위해 공부하면 좋은 주제/자료
5. **응원 메시지** — 초급 개발자에게 격려의 말`;
}

// ─── 보고서 생성 ───

async function generateReport(
  client: LLMClient,
  providerName: string,
  report: ApexReport,
  outputDir: string,
): Promise<{ path: string; content: string; durationMs: number }> {
  const prompt = buildJuniorDevPrompt(report);
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  console.log(`\n[${providerName}] 보고서 생성 중...`);
  const startTime = Date.now();

  const response = await client.chat(messages);

  const durationMs = Date.now() - startTime;
  console.log(`[${providerName}] 완료 (${(durationMs / 1000).toFixed(1)}초, ${response.content.length}자)`);

  // 파일로 저장
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `report-${providerName.toLowerCase()}.md`);
  fs.writeFileSync(filePath, response.content, "utf-8");

  return { path: filePath, content: response.content, durationMs };
}

// ─── 메인 ───

async function main() {
  // 1. apex 결과 로드
  if (!fs.existsSync(APEX_RESULT_PATH)) {
    console.error(`apex 결과 파일이 없습니다: ${APEX_RESULT_PATH}`);
    console.error("먼저 apex MCP 분석을 실행하세요.");
    process.exit(1);
  }

  const report = loadApexReport(APEX_RESULT_PATH);
  console.log(`=== apex 분석 결과 로드 ===`);
  console.log(`  총 이슈: ${report.summary.total_issues}건`);
  console.log(`  Critical: ${report.summary.critical}, High: ${report.summary.high}`);
  console.log(`  이슈 샘플: ${report.issues.length}건 (top_issues)`);

  // 2. Anthropic 보고서
  let anthropicReport: { path: string; content: string; durationMs: number } | null = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropicClient = new AnthropicClient({
        model: "claude-sonnet-4-20250514",
        maxTokens: 8192,
      });
      // 키 유효성 확인
      await anthropicClient.chat([{ role: "user", content: "Hi" }]);
      anthropicReport = await generateReport(anthropicClient, "Anthropic", report, OUTPUT_DIR);
    } catch (e) {
      console.log(`[Anthropic] API 키 인증 실패, 스킵: ${String(e).slice(0, 80)}`);
    }
  } else {
    console.log("[Anthropic] ANTHROPIC_API_KEY 없음, 스킵");
  }

  // 3. Ollama 보고서
  let ollamaReport: { path: string; content: string; durationMs: number } | null = null;
  try {
    const ollamaClient = new OllamaClient({
      baseUrl: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
      contextLength: 8192,
      keepAlive: 1800,
    });
    ollamaReport = await generateReport(ollamaClient, "Ollama", report, OUTPUT_DIR);
  } catch (e) {
    console.log(`[Ollama] 연결 실패, 스킵: ${String(e).slice(0, 80)}`);
  }

  // 4. 비교 요약
  console.log("\n=== 보고서 비교 ===");
  if (anthropicReport) {
    console.log(`  Anthropic: ${anthropicReport.path} (${anthropicReport.content.length}자, ${(anthropicReport.durationMs / 1000).toFixed(1)}초)`);
  }
  if (ollamaReport) {
    console.log(`  Ollama:    ${ollamaReport.path} (${ollamaReport.content.length}자, ${(ollamaReport.durationMs / 1000).toFixed(1)}초)`);
  }

  console.log("\n=== 완료 ===");
  console.log(`보고서 위치: ${OUTPUT_DIR}/`);
}

main().catch(console.error);
