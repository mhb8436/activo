import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface CssRule {
  selector: string;
  line: number;
  properties: number;
  issues: string[];
  specificity?: string;
}

interface CssAnalysisResult {
  file: string;
  type: "css" | "scss" | "less";
  rules: CssRule[];
  imports: string[];
  variables: string[];
  mixins: string[];
  summary: {
    totalRules: number;
    rulesWithIssues: number;
    importantCount: number;
    maxNestingDepth: number;
    vendorPrefixes: number;
    issueTypes: Record<string, number>;
  };
}

// CSS/SCSS/LESS 분석
function analyzeCssFile(filePath: string): CssAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const ext = path.extname(filePath).toLowerCase();
  const type: "css" | "scss" | "less" = ext === ".scss" ? "scss" : ext === ".less" ? "less" : "css";

  const rules: CssRule[] = [];
  const imports: string[] = [];
  const variables: string[] = [];
  const mixins: string[] = [];
  const issueTypes: Record<string, number> = {};

  let importantCount = 0;
  let maxNestingDepth = 0;
  let vendorPrefixes = 0;

  // @import 추출
  const importRegex = /@import\s+["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  // 변수 추출 (SCSS: $var, CSS: --var, LESS: @var)
  if (type === "scss") {
    const scssVarRegex = /\$([a-zA-Z_][\w-]*)\s*:/g;
    while ((match = scssVarRegex.exec(content)) !== null) {
      variables.push("$" + match[1]);
    }
  } else if (type === "less") {
    const lessVarRegex = /@([a-zA-Z_][\w-]*)\s*:/g;
    while ((match = lessVarRegex.exec(content)) !== null) {
      if (!["import", "media", "keyframes", "font-face", "charset", "supports"].includes(match[1])) {
        variables.push("@" + match[1]);
      }
    }
  } else {
    const cssVarRegex = /--([\w-]+)\s*:/g;
    while ((match = cssVarRegex.exec(content)) !== null) {
      variables.push("--" + match[1]);
    }
  }

  // mixin 추출 (SCSS/LESS)
  if (type === "scss") {
    const mixinRegex = /@mixin\s+([\w-]+)/g;
    while ((match = mixinRegex.exec(content)) !== null) {
      mixins.push(match[1]);
    }
  } else if (type === "less") {
    const lessMixinRegex = /\.([\w-]+)\s*\([^)]*\)\s*\{/g;
    while ((match = lessMixinRegex.exec(content)) !== null) {
      mixins.push("." + match[1]);
    }
  }

  // !important 개수
  importantCount = (content.match(/!important/gi) || []).length;

  // vendor prefix 개수
  vendorPrefixes = (content.match(/-webkit-|-moz-|-ms-|-o-/g) || []).length;

  // 중첩 깊이 계산 (SCSS/LESS)
  if (type === "scss" || type === "less") {
    let depth = 0;
    for (const char of content) {
      if (char === "{") {
        depth++;
        maxNestingDepth = Math.max(maxNestingDepth, depth);
      } else if (char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
  }

  // 셀렉터 및 규칙 분석
  // 간단한 규칙 파싱 (중첩 미포함)
  const ruleRegex = /([^{}@]+)\{([^{}]+)\}/g;
  while ((match = ruleRegex.exec(content)) !== null) {
    const selector = match[1].trim();
    const properties = match[2];

    if (!selector || selector.startsWith("@") || selector.startsWith("//") || selector.startsWith("/*")) {
      continue;
    }

    const issues: string[] = [];

    // 라인 번호 찾기
    const ruleIndex = match.index;
    let lineNum = 1;
    for (let i = 0; i < ruleIndex && i < content.length; i++) {
      if (content[i] === "\n") lineNum++;
    }

    // 속성 개수
    const propCount = (properties.match(/[^;{}]+:[^;{}]+;?/g) || []).length;

    // !important 사용
    const importantInRule = (properties.match(/!important/gi) || []).length;
    if (importantInRule > 0) {
      issues.push(`!important ${importantInRule}회 사용`);
    }

    // 과도한 셀렉터 체이닝
    const selectorParts = selector.split(/\s+/).filter((s) => s.trim());
    if (selectorParts.length > 4) {
      issues.push(`셀렉터 깊이 ${selectorParts.length} - 단순화 권장`);
    }

    // ID 셀렉터 남용
    const idCount = (selector.match(/#[\w-]+/g) || []).length;
    if (idCount > 1) {
      issues.push(`ID 셀렉터 ${idCount}개 - 특이성 과다`);
    }

    // universal 셀렉터
    if (/^\s*\*\s*$/.test(selector) || /\s\*\s/.test(selector)) {
      issues.push("* 셀렉터 사용 - 성능 영향");
    }

    // float 사용 (레거시)
    if (/float\s*:/i.test(properties)) {
      issues.push("float 사용 - flexbox/grid 권장");
    }

    // vendor prefix 직접 사용
    if (/-webkit-|-moz-|-ms-|-o-/.test(properties)) {
      issues.push("vendor prefix 직접 사용 - autoprefixer 권장");
    }

    // 색상 하드코딩
    const hexColors = (properties.match(/#[0-9a-fA-F]{3,8}/g) || []).length;
    const rgbColors = (properties.match(/rgb\(|rgba\(/gi) || []).length;
    if (hexColors + rgbColors > 2) {
      issues.push("색상 하드코딩 - 변수 사용 권장");
    }

    // z-index 과다
    const zIndexMatch = properties.match(/z-index\s*:\s*(\d+)/);
    if (zIndexMatch && parseInt(zIndexMatch[1]) > 100) {
      issues.push(`z-index: ${zIndexMatch[1]} - 관리 필요`);
    }

    // 이슈 통계
    issues.forEach((issue) => {
      const key = issue.split(" - ")[0].split(" ")[0];
      issueTypes[key] = (issueTypes[key] || 0) + 1;
    });

    rules.push({
      selector: selector.length > 60 ? selector.substring(0, 60) + "..." : selector,
      line: lineNum,
      properties: propCount,
      issues,
    });
  }

  // !important 이슈 추가
  if (importantCount > 5) {
    issueTypes["!important과다"] = importantCount;
  }

  // 중첩 깊이 이슈
  if (maxNestingDepth > 4) {
    issueTypes["중첩과다"] = maxNestingDepth;
  }

  return {
    file: filePath,
    type,
    rules,
    imports,
    variables: [...new Set(variables)],
    mixins,
    summary: {
      totalRules: rules.length,
      rulesWithIssues: rules.filter((r) => r.issues.length > 0).length,
      importantCount,
      maxNestingDepth,
      vendorPrefixes,
      issueTypes,
    },
  };
}

// 도구 정의
export const cssTools: Tool[] = [
  {
    name: "css_check",
    description:
      "CSS/SCSS/LESS 파일을 분석합니다. !important 남용, 셀렉터 복잡도, 중첩 깊이, vendor prefix, 레거시 속성(float) 등을 검사합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 CSS/SCSS/LESS 파일 또는 디렉토리 경로",
        },
        recursive: {
          type: "boolean",
          description: "디렉토리인 경우 하위 폴더 포함 여부 (기본: true)",
        },
      },
      required: ["path"],
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const targetPath = args.path as string;
      const recursive = args.recursive !== false;

      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          content: "",
          error: `경로를 찾을 수 없습니다: ${targetPath}`,
        };
      }

      const results: CssAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);
      const cssExtensions = [".css", ".scss", ".less"];

      if (stats.isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        if (cssExtensions.includes(ext)) {
          results.push(analyzeCssFile(targetPath));
        }
      } else if (stats.isDirectory()) {
        const walkDir = (dir: string) => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            const fileStat = fs.statSync(filePath);
            if (fileStat.isDirectory() && recursive) {
              if (!file.startsWith(".") && file !== "node_modules" && file !== "target" && file !== "build") {
                walkDir(filePath);
              }
            } else {
              const ext = path.extname(file).toLowerCase();
              if (cssExtensions.includes(ext)) {
                results.push(analyzeCssFile(filePath));
              }
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const totalRules = results.reduce((sum, r) => sum + r.summary.totalRules, 0);
      const totalWithIssues = results.reduce((sum, r) => sum + r.summary.rulesWithIssues, 0);
      const totalImportant = results.reduce((sum, r) => sum + r.summary.importantCount, 0);
      const totalVendorPrefixes = results.reduce((sum, r) => sum + r.summary.vendorPrefixes, 0);
      const maxNesting = Math.max(...results.map((r) => r.summary.maxNestingDepth), 0);

      const allIssueTypes: Record<string, number> = {};
      results.forEach((r) => {
        Object.entries(r.summary.issueTypes).forEach(([key, count]) => {
          allIssueTypes[key] = (allIssueTypes[key] || 0) + count;
        });
      });

      const output = {
        analyzedFiles: results.length,
        totalRules,
        rulesWithIssues: totalWithIssues,
        totalImportant,
        totalVendorPrefixes,
        maxNestingDepth: maxNesting,
        issueTypes: allIssueTypes,
        files: results.map((r) => ({
          file: r.file,
          type: r.type,
          imports: r.imports,
          variables: r.variables.slice(0, 10),
          mixins: r.mixins,
          summary: r.summary,
          rulesWithIssues: r.rules
            .filter((rule) => rule.issues.length > 0)
            .map((rule) => ({
              selector: rule.selector,
              line: rule.line,
              issues: rule.issues,
            })),
        })),
      };

      return {
        success: true,
        content: JSON.stringify(output, null, 2),
      };
    },
  },
];
