import { OllamaClient } from "../llm/ollama.js";
import { Chunk } from "./chunk-splitter.js";

export interface ExtractedRule {
  id: string;
  title: string;
  severity: "error" | "warning" | "info";
  description: string;
  example?: {
    good?: string;
    bad?: string;
  };
  category?: string;
}

export interface ExtractionResult {
  chunkId: number;
  chunkTitle: string;
  rules: ExtractedRule[];
  rawContent: string;
}

const EXTRACTION_PROMPT = `당신은 개발 표준 문서 분석 전문가입니다.
아래 텍스트에서 개발 표준 규칙을 추출하세요.

각 규칙에 대해 다음 정보를 추출하세요:
1. 규칙 ID (예: NR-001, CS-001 형식으로 생성)
2. 규칙 제목
3. 심각도 (error: 필수 준수, warning: 권장, info: 참고)
4. 규칙 설명
5. 좋은 예시 (있는 경우)
6. 나쁜 예시 (있는 경우)
7. 카테고리 (명명규칙, 코드구조, 보안, 예외처리, 주석 등)

결과는 다음 마크다운 형식으로 출력하세요:

## [규칙ID]: [규칙 제목]
- 심각도: [error|warning|info]
- 카테고리: [카테고리]
- 규칙: [규칙 설명]
- 예시:
  - 좋은 예: [좋은 예시]
  - 나쁜 예: [나쁜 예시]

규칙이 없으면 "규칙을 찾을 수 없습니다"라고 출력하세요.

---
분석할 텍스트:
`;

export async function extractRulesFromChunk(
  chunk: Chunk,
  client: OllamaClient
): Promise<ExtractionResult> {
  const prompt = EXTRACTION_PROMPT + chunk.content;

  const response = await client.chat([
    { role: "user", content: prompt },
  ]);

  return {
    chunkId: chunk.id,
    chunkTitle: chunk.title,
    rules: parseRulesFromMarkdown(response.content),
    rawContent: response.content,
  };
}

function parseRulesFromMarkdown(markdown: string): ExtractedRule[] {
  const rules: ExtractedRule[] = [];
  const rulePattern = /^## ([A-Z]+-\d+):\s*(.+)$/gm;

  let match;
  while ((match = rulePattern.exec(markdown)) !== null) {
    const id = match[1];
    const title = match[2];

    // Find the content between this rule and the next
    const startIndex = match.index;
    const nextRuleMatch = markdown.slice(startIndex + match[0].length).match(/^## [A-Z]+-\d+:/m);
    const endIndex = nextRuleMatch
      ? startIndex + match[0].length + (nextRuleMatch.index || 0)
      : markdown.length;

    const ruleContent = markdown.slice(startIndex, endIndex);

    // Extract severity
    const severityMatch = ruleContent.match(/심각도:\s*(error|warning|info)/i);
    const severity = (severityMatch?.[1]?.toLowerCase() || "warning") as "error" | "warning" | "info";

    // Extract category
    const categoryMatch = ruleContent.match(/카테고리:\s*(.+)/);
    const category = categoryMatch?.[1]?.trim();

    // Extract description
    const descMatch = ruleContent.match(/규칙:\s*(.+)/);
    const description = descMatch?.[1]?.trim() || title;

    // Extract examples
    const goodMatch = ruleContent.match(/좋은 예[시]?:\s*(.+)/);
    const badMatch = ruleContent.match(/나쁜 예[시]?:\s*(.+)/);

    rules.push({
      id,
      title,
      severity,
      description,
      category,
      example: {
        good: goodMatch?.[1]?.trim(),
        bad: badMatch?.[1]?.trim(),
      },
    });
  }

  return rules;
}

export function generateMarkdown(
  result: ExtractionResult,
  sourceFilename: string,
  extractionDate: string
): string {
  let md = `# ${result.chunkTitle}\n\n`;
  md += `> 원본: ${sourceFilename} (페이지 정보는 청크 기반)\n`;
  md += `> 추출일: ${extractionDate}\n\n`;

  if (result.rules.length === 0) {
    md += result.rawContent;
    return md;
  }

  for (const rule of result.rules) {
    md += `## ${rule.id}: ${rule.title}\n`;
    md += `- 심각도: ${rule.severity}\n`;
    if (rule.category) {
      md += `- 카테고리: ${rule.category}\n`;
    }
    md += `- 규칙: ${rule.description}\n`;

    if (rule.example?.good || rule.example?.bad) {
      md += `- 예시:\n`;
      if (rule.example.good) {
        md += `  - 좋은 예: ${rule.example.good}\n`;
      }
      if (rule.example.bad) {
        md += `  - 나쁜 예: ${rule.example.bad}\n`;
      }
    }
    md += "\n";
  }

  md += "---\n";
  md += "[수동 수정 필요 시 이 파일을 직접 편집하세요]\n";

  return md;
}

export function generateIndexMarkdown(
  results: ExtractionResult[],
  sourceFilename: string,
  extractionDate: string
): string {
  let md = `# 개발 표준 규칙 목록\n\n`;
  md += `> 원본: ${sourceFilename}\n`;
  md += `> 추출일: ${extractionDate}\n`;
  md += `> 총 파일 수: ${results.length}\n\n`;

  let totalRules = 0;

  md += `## 목차\n\n`;

  for (const result of results) {
    const filename = `${String(result.chunkId).padStart(2, "0")}_${sanitizeFilename(result.chunkTitle)}.md`;
    md += `### ${result.chunkTitle}\n`;
    md += `- 파일: [${filename}](./${filename})\n`;
    md += `- 규칙 수: ${result.rules.length}\n`;

    if (result.rules.length > 0) {
      md += `- 규칙 목록:\n`;
      for (const rule of result.rules) {
        const severityIcon =
          rule.severity === "error" ? "🔴" : rule.severity === "warning" ? "🟡" : "🔵";
        md += `  - ${severityIcon} ${rule.id}: ${rule.title}\n`;
        totalRules++;
      }
    }
    md += "\n";
  }

  md += `---\n`;
  md += `**총 규칙 수: ${totalRules}**\n`;

  return md;
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50);
}
