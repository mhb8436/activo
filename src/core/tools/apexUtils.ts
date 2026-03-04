import fs from "fs";
import { loadConfig } from "../config.js";
import { OllamaClient } from "../llm/ollama.js";
import { AnthropicClient } from "../llm/anthropic.js";
import type { LLMClient } from "../llm/types.js";

// ─── Apex Report Types ───

export interface ApexIssue {
  rule_id: string;
  rule_name: string;
  severity: string;
  category: string;
  file: string;
  line: number;
  column?: number;
  message: string;
  suggestion?: string;
}

export interface ApexReport {
  summary: {
    total_issues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    files_analyzed: number;
    duration?: string;
  };
  profiles_used?: string[];
  issues: ApexIssue[];
}

/**
 * Load an Apex report from file path or inline JSON string.
 * Accepts both raw apex output and the MCP wrapper format.
 */
export function loadApexReport(arg: string): ApexReport {
  let raw: string;

  // Try as file path first
  if (!arg.trimStart().startsWith("{") && !arg.trimStart().startsWith("[")) {
    if (!fs.existsSync(arg)) {
      throw new Error(`파일을 찾을 수 없습니다: ${arg}`);
    }
    raw = fs.readFileSync(arg, "utf-8");
  } else {
    raw = arg;
  }

  const parsed = JSON.parse(raw);

  // Already in ApexReport format
  if (parsed.summary && Array.isArray(parsed.issues)) {
    return parsed as ApexReport;
  }

  // MCP wrapper format: { summary, top_issues, profiles_used, ... }
  if (parsed.summary && parsed.top_issues) {
    const issues: ApexIssue[] = (parsed.top_issues || []).map((i: Record<string, unknown>) => ({
      rule_id: (i.rule_id || i.ruleId || "") as string,
      rule_name: (i.rule_name || i.ruleName || "") as string,
      severity: (i.severity || "medium") as string,
      category: (i.category || "") as string,
      file: (i.file || i.filepath || "") as string,
      line: (i.line || 0) as number,
      column: (i.column || 0) as number,
      message: (i.message || "") as string,
      suggestion: (i.suggestion || "") as string,
    }));

    const s = parsed.summary;
    // severity_count can be nested (MCP format) or flat
    const sc = s.severity_count || {};
    const critical = s.critical || sc.critical || 0;
    const high = s.high || sc.high || 0;
    const medium = s.medium || sc.medium || 0;
    const low = s.low || sc.low || 0;
    const totalIssues = s.total_issues || s.totalIssues || (critical + high + medium + low) || issues.length;
    const filesAnalyzed = s.files_analyzed || s.filesAnalyzed || s.total_files || 0;

    // profiles_used can be string or string[]
    let profilesUsed: string[] = [];
    if (Array.isArray(parsed.profiles_used)) {
      profilesUsed = parsed.profiles_used;
    } else if (typeof parsed.profiles_used === "string") {
      profilesUsed = parsed.profiles_used.split(",").map((p: string) => p.trim());
    }

    return {
      summary: {
        total_issues: totalIssues,
        critical,
        high,
        medium,
        low,
        files_analyzed: filesAnalyzed,
        duration: s.duration || parsed.duration,
      },
      profiles_used: profilesUsed,
      issues,
    };
  }

  throw new Error("지원하지 않는 리포트 형식입니다. apex 분석 결과 JSON이 필요합니다.");
}

/**
 * Create an LLM client based on the current configuration.
 * Shared by analyzePatterns, generateReport, recommendProfile, ruleGen.
 */
export function createLLMClient(): LLMClient {
  const config = loadConfig();
  if (config.provider === "anthropic") {
    return new AnthropicClient(config.anthropic);
  }
  return new OllamaClient(config.ollama);
}
