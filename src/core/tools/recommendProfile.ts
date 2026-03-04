import fs from "fs";
import path from "path";
import { Tool, ToolResult } from "./types.js";
import { createLLMClient } from "./apexUtils.js";

// ─── File Collection (reused from analyzeAll.ts pattern) ───

interface ScanStats {
  java: string[];
  xml: string[];
  js: string[];
  ts: string[];
  jsx: string[];
  tsx: string[];
  vue: string[];
  py: string[];
  sql: string[];
  json: string[];
  gradle: string[];
}

function collectProjectFiles(dirPath: string, stats: ScanStats, maxDepth: number = 10, currentDepth: number = 0): void {
  if (currentDepth > maxDepth) return;

  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);

      try {
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          const excludeDirs = [
            "node_modules", "target", "build", "dist", ".git", ".svn",
            "__pycache__", "venv", ".venv", "env", ".idea", ".vscode",
            "out", "bin", "obj", ".gradle", ".m2",
          ];
          if (!item.startsWith(".") && !excludeDirs.includes(item)) {
            collectProjectFiles(fullPath, stats, maxDepth, currentDepth + 1);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(item).toLowerCase();
          const name = item.toLowerCase();

          switch (ext) {
            case ".java": stats.java.push(fullPath); break;
            case ".xml": stats.xml.push(fullPath); break;
            case ".js": stats.js.push(fullPath); break;
            case ".ts": stats.ts.push(fullPath); break;
            case ".jsx": stats.jsx.push(fullPath); break;
            case ".tsx": stats.tsx.push(fullPath); break;
            case ".vue": stats.vue.push(fullPath); break;
            case ".py": stats.py.push(fullPath); break;
            case ".sql": stats.sql.push(fullPath); break;
            case ".json": stats.json.push(fullPath); break;
          }

          if (name === "build.gradle" || name === "build.gradle.kts") {
            stats.gradle.push(fullPath);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

// ─── Framework Detection ───

interface FrameworkDetection {
  name: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

function detectFrameworks(projectPath: string, stats: ScanStats): FrameworkDetection[] {
  const frameworks: FrameworkDetection[] = [];

  // Check pom.xml for Spring Boot / eGov
  const pomFiles = stats.xml.filter((f) => f.endsWith("pom.xml"));
  for (const pomFile of pomFiles) {
    try {
      const content = fs.readFileSync(pomFile, "utf-8");

      if (/spring-boot/i.test(content)) {
        frameworks.push({ name: "Spring Boot", confidence: "high", evidence: `pom.xml: spring-boot dependency` });
      } else if (/spring-/i.test(content)) {
        frameworks.push({ name: "Spring", confidence: "high", evidence: `pom.xml: spring dependency` });
      }

      if (/egovframework/i.test(content)) {
        frameworks.push({ name: "eGov", confidence: "high", evidence: `pom.xml: egovframework dependency` });
      }

      if (/mybatis|org\.apache\.ibatis/i.test(content)) {
        frameworks.push({ name: "MyBatis", confidence: "high", evidence: `pom.xml: mybatis dependency` });
      }
    } catch { /* skip */ }
  }

  // Check build.gradle
  for (const gradleFile of stats.gradle) {
    try {
      const content = fs.readFileSync(gradleFile, "utf-8");

      if (/spring-boot/i.test(content)) {
        frameworks.push({ name: "Spring Boot", confidence: "high", evidence: `build.gradle: spring-boot` });
      }
      if (/egovframework/i.test(content)) {
        frameworks.push({ name: "eGov", confidence: "high", evidence: `build.gradle: egovframework` });
      }
    } catch { /* skip */ }
  }

  // Check package.json for frontend frameworks
  const packageJsonFiles = stats.json.filter((f) => f.endsWith("package.json"));
  for (const pkgFile of packageJsonFiles) {
    try {
      const content = fs.readFileSync(pkgFile, "utf-8");
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps.react) {
        frameworks.push({ name: "React", confidence: "high", evidence: `package.json: react` });
      }
      if (allDeps.vue) {
        frameworks.push({ name: "Vue", confidence: "high", evidence: `package.json: vue` });
      }
      if (allDeps.jquery) {
        frameworks.push({ name: "jQuery", confidence: "high", evidence: `package.json: jquery` });
      }
    } catch { /* skip */ }
  }

  // Check for jQuery in JS files (without package.json)
  if (!frameworks.some((f) => f.name === "jQuery")) {
    const jsFiles = [...stats.js, ...stats.jsx];
    for (const jsFile of jsFiles.slice(0, 20)) {
      try {
        const content = fs.readFileSync(jsFile, "utf-8").slice(0, 2000);
        if (/\$\(|jQuery\(/i.test(content)) {
          frameworks.push({ name: "jQuery", confidence: "medium", evidence: `${path.basename(jsFile)}: jQuery usage detected` });
          break;
        }
      } catch { /* skip */ }
    }
  }

  // Check for MyBatis XML mappers
  if (!frameworks.some((f) => f.name === "MyBatis")) {
    const mybatisXmls = stats.xml.filter((f) => {
      try {
        const content = fs.readFileSync(f, "utf-8").slice(0, 500);
        return /<!DOCTYPE mapper|<mapper\s+namespace/i.test(content);
      } catch { return false; }
    });
    if (mybatisXmls.length > 0) {
      frameworks.push({ name: "MyBatis", confidence: "high", evidence: `${mybatisXmls.length}개 MyBatis mapper XML 발견` });
    }
  }

  // Check for SQL files
  if (stats.sql.length > 0) {
    frameworks.push({ name: "SQL", confidence: "high", evidence: `${stats.sql.length}개 SQL 파일` });
  }

  // Deduplicate by name (keep highest confidence)
  const seen = new Map<string, FrameworkDetection>();
  for (const fw of frameworks) {
    const existing = seen.get(fw.name);
    if (!existing || (fw.confidence === "high" && existing.confidence !== "high")) {
      seen.set(fw.name, fw);
    }
  }

  return Array.from(seen.values());
}

// ─── Profile Mapping ───

interface ProfileRecommendation {
  profile: string;
  reason: string;
  priority: number; // lower = higher priority
  command: string;
}

function mapToProfiles(frameworks: FrameworkDetection[], stats: ScanStats): ProfileRecommendation[] {
  const recommendations: ProfileRecommendation[] = [];
  const frameworkNames = new Set(frameworks.map((f) => f.name));

  // Java project → quality (기본)
  if (stats.java.length > 0) {
    recommendations.push({
      profile: "quality",
      reason: `Java 파일 ${stats.java.length}개 감지 — 기본 품질 규칙`,
      priority: 1,
      command: "apex analyze --profile quality",
    });
  }

  // Spring Boot → spring
  if (frameworkNames.has("Spring Boot")) {
    recommendations.push({
      profile: "spring",
      reason: "Spring Boot 프로젝트 감지 — Spring 전용 규칙 (Bean, DI, REST API 등)",
      priority: 2,
      command: "apex analyze --profile spring",
    });
  }

  // eGov → egov + egov-full
  if (frameworkNames.has("eGov")) {
    recommendations.push({
      profile: "egov",
      reason: "전자정부 프레임워크 감지 — eGov 기본 규칙",
      priority: 2,
      command: "apex analyze --profile egov",
    });
    recommendations.push({
      profile: "egov-full",
      reason: "전자정부 프레임워크 전체 규칙 (엄격 모드)",
      priority: 3,
      command: "apex analyze --profile egov-full",
    });
  }

  // Java → secure (보안)
  if (stats.java.length > 0) {
    recommendations.push({
      profile: "secure",
      reason: "보안 취약점 검사 — SQL Injection, XSS, Path Traversal 등",
      priority: 4,
      command: "apex analyze --profile secure",
    });
  }

  // SQL/MyBatis → sql
  if (frameworkNames.has("MyBatis") || frameworkNames.has("SQL") || stats.sql.length > 0) {
    recommendations.push({
      profile: "sql",
      reason: "SQL/MyBatis 감지 — SQL 품질 및 성능 규칙",
      priority: 3,
      command: "apex analyze --profile sql",
    });
  }

  // Sort by priority
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

// ─── LLM Strategy ───

async function generateLLMStrategy(
  languageStats: Record<string, number>,
  frameworks: FrameworkDetection[],
  recommendations: ProfileRecommendation[],
): Promise<string | undefined> {
  try {
    const client = createLLMClient();

    const langText = Object.entries(languageStats)
      .map(([lang, count]) => `${lang} ${count}파일`)
      .join(", ");

    const fwText = frameworks.map(f => f.name).join(", ") || "없음";
    const profileText = recommendations.map(r => r.profile).join(", ");

    const prompt = `당신은 Java 프로젝트 품질 분석 전문가입니다. 아래 프로젝트 정보를 바탕으로 분석 전략을 제안하세요.

[프로젝트 정보]
- 언어: ${langText}
- 프레임워크: ${fwText}
- 추천 프로파일: ${profileText}

다음을 제안하세요:
1. 추천 분석 순서와 이유
2. 각 프로파일에서 주의할 규칙 카테고리
3. 프로젝트 특성에 맞는 추가 점검 항목`;

    const response = await client.chat([{ role: "user", content: prompt }]);
    return response.content;
  } catch {
    return undefined;
  }
}

// ─── Tool Definition ───

const recommendProfileTool: Tool = {
  name: "recommend_profile",
  description: "프로젝트를 스캔하여 적합한 apex 분석 프로파일을 추천합니다. 언어/프레임워크 감지 후 프로파일 매핑. Use when user asks: '프로파일 추천', '어떤 프로파일', 'recommend profile', '어떤 규칙'.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "분석할 프로젝트 디렉토리 경로",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const projectPath = args.path as string;

      if (!fs.existsSync(projectPath)) {
        return { success: false, content: "", error: `경로를 찾을 수 없습니다: ${projectPath}` };
      }

      const stat = fs.statSync(projectPath);
      if (!stat.isDirectory()) {
        return { success: false, content: "", error: `디렉토리가 아닙니다: ${projectPath}` };
      }

      // Scan project files
      const fileStats: ScanStats = {
        java: [], xml: [], js: [], ts: [], jsx: [], tsx: [],
        vue: [], py: [], sql: [], json: [], gradle: [],
      };
      collectProjectFiles(projectPath, fileStats);

      // Detect frameworks
      const frameworks = detectFrameworks(projectPath, fileStats);

      // Map to profiles
      const recommendations = mapToProfiles(frameworks, fileStats);

      // Build language statistics
      const languageStats: Record<string, number> = {};
      if (fileStats.java.length > 0) languageStats.java = fileStats.java.length;
      if (fileStats.js.length + fileStats.jsx.length > 0) languageStats.javascript = fileStats.js.length + fileStats.jsx.length;
      if (fileStats.ts.length + fileStats.tsx.length > 0) languageStats.typescript = fileStats.ts.length + fileStats.tsx.length;
      if (fileStats.vue.length > 0) languageStats.vue = fileStats.vue.length;
      if (fileStats.py.length > 0) languageStats.python = fileStats.py.length;
      if (fileStats.xml.length > 0) languageStats.xml = fileStats.xml.length;
      if (fileStats.sql.length > 0) languageStats.sql = fileStats.sql.length;

      // LLM strategy (graceful fallback)
      const llmStrategy = await generateLLMStrategy(languageStats, frameworks, recommendations);

      const result: Record<string, unknown> = {
        project: projectPath,
        language_stats: languageStats,
        total_files: Object.values(languageStats).reduce((a, b) => a + b, 0),
        frameworks_detected: frameworks.map((f) => ({
          name: f.name,
          confidence: f.confidence,
          evidence: f.evidence,
        })),
        recommended_profiles: recommendations.map((r) => ({
          profile: r.profile,
          reason: r.reason,
          command: r.command,
        })),
        suggestion: recommendations.length > 0
          ? `추천 명령어: ${recommendations[0].command} ${projectPath}`
          : "Java 프로젝트가 아닌 경우 apex 분석 대상이 아닙니다.",
      };

      if (llmStrategy) {
        result.llm_strategy = llmStrategy;
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

export const recommendProfileTools: Tool[] = [recommendProfileTool];
