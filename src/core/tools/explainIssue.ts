import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { Tool, ToolResult } from "./types.js";
import { resolveRulesetsDir } from "./apexPaths.js";

// ─── Interfaces ───

interface RuleInfo {
  id: string;
  name: string;
  description: string;
  severity: string;
  category: string;
  enabled: boolean;
  pattern?: Record<string, unknown>;
  suggestion?: string;
  language?: string;
}

// Module-level cache
let cachedRules: Map<string, RuleInfo> | null = null;
let cachedDir: string | null = null;

// ─── YAML Rule Loading ───

function loadAllRules(rulesetsDir: string): Map<string, RuleInfo> {
  // Return cache if same directory
  if (cachedRules && cachedDir === rulesetsDir) {
    return cachedRules;
  }

  const rules = new Map<string, RuleInfo>();

  if (!fs.existsSync(rulesetsDir)) return rules;

  const files = fs.readdirSync(rulesetsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(rulesetsDir, file), "utf-8");
      const data = yaml.load(content) as Record<string, unknown>;
      const languages = data.languages as Array<Record<string, unknown>>;

      if (!Array.isArray(languages)) continue;

      for (const lang of languages) {
        const langName = (lang.language || "") as string;
        const langRules = lang.rules as Array<Record<string, unknown>>;
        if (!Array.isArray(langRules)) continue;

        for (const r of langRules) {
          const rule: RuleInfo = {
            id: (r.id as string) || "",
            name: (r.name as string) || "",
            description: (r.description as string) || "",
            severity: (r.severity as string) || "medium",
            category: (r.category as string) || "",
            enabled: r.enabled !== false,
            pattern: r.pattern as Record<string, unknown> | undefined,
            suggestion: (r.suggestion as string) || (r.fix as string) || "",
            language: langName,
          };
          if (rule.id) {
            rules.set(rule.id, rule);
          }
        }
      }
    } catch {
      // Skip invalid YAML files
    }
  }

  // Update cache
  cachedRules = rules;
  cachedDir = rulesetsDir;

  return rules;
}

// ─── Tool Definition ───

const explainIssueTool: Tool = {
  name: "explain_issue",
  description: "apex 규칙 ID로 이슈를 설명합니다. 규칙 정의, 카테고리, 패턴, 수정 제안, 관련 규칙을 반환합니다. Use when user asks: '이슈설명', '규칙설명', '왜 문제', 'explain issue', 'rule explain'.",
  parameters: {
    type: "object",
    required: ["rule_id"],
    properties: {
      rule_id: {
        type: "string",
        description: "설명할 apex 규칙 ID (예: quality-nc-001, secure-si-001)",
      },
      rulesets_dir: {
        type: "string",
        description: "apex configs/rulesets/ 디렉토리 경로 (생략 시 번들된 규칙 사용)",
      },
      code_snippet: {
        type: "string",
        description: "문제 코드 스니펫 (선택, LLM이 맥락적 설명에 활용)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const ruleId = args.rule_id as string;
      const rulesetsDir = resolveRulesetsDir(args.rulesets_dir as string);
      const codeSnippet = (args.code_snippet as string) || "";

      if (!fs.existsSync(rulesetsDir)) {
        return { success: false, content: "", error: `규칙셋 디렉토리 없음: ${rulesetsDir}` };
      }

      // Load all rules
      const rules = loadAllRules(rulesetsDir);

      if (rules.size === 0) {
        return { success: false, content: "", error: "규칙을 로드할 수 없습니다. YAML 파일을 확인하세요." };
      }

      // Find the target rule
      const rule = rules.get(ruleId);

      if (!rule) {
        // Try partial match
        const partialMatches: RuleInfo[] = [];
        for (const [id, r] of rules) {
          if (id.includes(ruleId) || ruleId.includes(id)) {
            partialMatches.push(r);
          }
        }

        if (partialMatches.length > 0) {
          return {
            success: true,
            content: JSON.stringify({
              found: false,
              message: `정확한 규칙 ID '${ruleId}'를 찾을 수 없습니다.`,
              suggestions: partialMatches.slice(0, 10).map((r) => ({
                id: r.id,
                name: r.name,
                category: r.category,
              })),
              total_rules: rules.size,
            }, null, 2),
          };
        }

        return {
          success: true,
          content: JSON.stringify({
            found: false,
            message: `규칙 ID '${ruleId}'를 찾을 수 없습니다.`,
            total_rules: rules.size,
            hint: "규칙 ID 예시: quality-nc-001, secure-si-001",
          }, null, 2),
        };
      }

      // Find related rules in the same category
      const relatedRules: Array<{ id: string; name: string; severity: string }> = [];
      for (const [, r] of rules) {
        if (r.category === rule.category && r.id !== rule.id) {
          relatedRules.push({ id: r.id, name: r.name, severity: r.severity });
          if (relatedRules.length >= 5) break;
        }
      }

      // Build pattern explanation
      let patternExplanation = "";
      if (rule.pattern) {
        const pt = rule.pattern;
        patternExplanation = `검출 방식: ${pt.type}`;
        if (pt.regex) patternExplanation += ` | 정규식: ${pt.regex}`;
        if (pt.annotation) patternExplanation += ` | 어노테이션: ${pt.annotation}`;
        if (pt.method) patternExplanation += ` | 메서드: ${pt.method}`;
        if (pt.className) patternExplanation += ` | 클래스: ${pt.className}`;
      }

      const result: Record<string, unknown> = {
        found: true,
        rule: {
          id: rule.id,
          name: rule.name,
          description: rule.description,
          severity: rule.severity,
          category: rule.category,
          language: rule.language,
          enabled: rule.enabled,
          pattern_explanation: patternExplanation || undefined,
          suggestion: rule.suggestion || undefined,
        },
        related_rules: relatedRules,
        category_total: relatedRules.length + 1,
      };

      if (codeSnippet) {
        result.code_snippet = codeSnippet;
        result.analysis_hint = "LLM: 위 코드 스니펫에 이 규칙이 어떻게 적용되는지 설명해주세요.";
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

export const explainIssueTools: Tool[] = [explainIssueTool];
