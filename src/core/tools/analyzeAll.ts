import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

// 각 분석 도구 import
import { sqlTools } from "./sqlAnalysis.js";
import { mybatisTools } from "./mybatisAnalysis.js";
import { cssTools } from "./cssAnalysis.js";
import { htmlTools } from "./htmlAnalysis.js";
import { dependencyTools } from "./dependencyAnalysis.js";
import { openapiTools } from "./openapiAnalysis.js";
import { pythonTools } from "./pythonAnalysis.js";
import { javaTools } from "./javaAst.js";
import { frontendTools } from "./frontendAst.js";
import { astTools } from "./ast.js";

interface FileStats {
  java: string[];
  xml: string[];
  js: string[];
  ts: string[];
  jsx: string[];
  tsx: string[];
  vue: string[];
  py: string[];
  css: string[];
  scss: string[];
  html: string[];
  jsp: string[];
  json: string[];
  yaml: string[];
}

interface AnalysisResult {
  tool: string;
  success: boolean;
  summary: any;
  error?: string;
}

// 파일 수집
function collectFiles(dirPath: string, stats: FileStats, maxDepth: number = 10, currentDepth: number = 0): void {
  if (currentDepth > maxDepth) return;

  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);

      try {
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // 제외할 디렉토리
          const excludeDirs = [
            "node_modules", "target", "build", "dist", ".git", ".svn",
            "__pycache__", "venv", ".venv", "env", ".idea", ".vscode",
            "out", "bin", "obj", ".gradle", ".m2"
          ];

          if (!item.startsWith(".") && !excludeDirs.includes(item)) {
            collectFiles(fullPath, stats, maxDepth, currentDepth + 1);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(item).toLowerCase();

          switch (ext) {
            case ".java": stats.java.push(fullPath); break;
            case ".xml": stats.xml.push(fullPath); break;
            case ".js": stats.js.push(fullPath); break;
            case ".ts": stats.ts.push(fullPath); break;
            case ".jsx": stats.jsx.push(fullPath); break;
            case ".tsx": stats.tsx.push(fullPath); break;
            case ".vue": stats.vue.push(fullPath); break;
            case ".py": stats.py.push(fullPath); break;
            case ".css": stats.css.push(fullPath); break;
            case ".scss":
            case ".less": stats.scss.push(fullPath); break;
            case ".html":
            case ".htm": stats.html.push(fullPath); break;
            case ".jsp": stats.jsp.push(fullPath); break;
            case ".json": stats.json.push(fullPath); break;
            case ".yaml":
            case ".yml": stats.yaml.push(fullPath); break;
          }
        }
      } catch (e) {
        // 파일 접근 오류 무시
      }
    }
  } catch (e) {
    // 디렉토리 접근 오류 무시
  }
}

// 도구 실행 헬퍼
async function runTool(tool: Tool, args: Record<string, unknown>): Promise<AnalysisResult> {
  try {
    const result = await tool.handler(args);
    if (result.success) {
      const parsed = JSON.parse(result.content);
      return {
        tool: tool.name,
        success: true,
        summary: parsed,
      };
    } else {
      return {
        tool: tool.name,
        success: false,
        summary: null,
        error: result.error,
      };
    }
  } catch (e) {
    return {
      tool: tool.name,
      success: false,
      summary: null,
      error: String(e),
    };
  }
}

// 도구 정의
export const analyzeAllTools: Tool[] = [
  {
    name: "analyze_all",
    description:
      "디렉토리 전체를 자동으로 분석합니다. Java, MyBatis, SQL, JavaScript, TypeScript, React, Vue, Python, CSS, HTML 등 모든 파일 유형을 감지하고 적절한 분석 도구를 실행합니다. LLM 판단 없이 바로 실행됩니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 프로젝트 디렉토리 경로",
        },
        include: {
          type: "array",
          description: "분석할 파일 유형 (생략 시 모두 분석). 예: ['java', 'xml', 'js']",
          items: { type: "string" },
        },
        exclude: {
          type: "array",
          description: "제외할 파일 유형. 예: ['css', 'html']",
          items: { type: "string" },
        },
      },
      required: ["path"],
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const targetPath = args.path as string;
      const include = args.include as string[] | undefined;
      const exclude = args.exclude as string[] | undefined;

      if (!fs.existsSync(targetPath)) {
        return {
          success: false,
          content: "",
          error: `경로를 찾을 수 없습니다: ${targetPath}`,
        };
      }

      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          content: "",
          error: `디렉토리가 아닙니다: ${targetPath}`,
        };
      }

      // 파일 수집
      const fileStats: FileStats = {
        java: [], xml: [], js: [], ts: [], jsx: [], tsx: [],
        vue: [], py: [], css: [], scss: [], html: [], jsp: [],
        json: [], yaml: [],
      };

      collectFiles(targetPath, fileStats);

      // 분석할 유형 결정
      const shouldAnalyze = (type: string): boolean => {
        if (exclude?.includes(type)) return false;
        if (include && include.length > 0) return include.includes(type);
        return true;
      };

      const results: AnalysisResult[] = [];
      const fileCounts: Record<string, number> = {};

      // 파일 통계
      Object.entries(fileStats).forEach(([type, files]) => {
        if (files.length > 0) {
          fileCounts[type] = files.length;
        }
      });

      // Java 분석 (파일 단위 도구 - 샘플링)
      if (fileStats.java.length > 0 && shouldAnalyze("java")) {
        // Java AST 분석 (최대 10개 파일 샘플링)
        const javaAnalyzeTool = javaTools.find(t => t.name === "java_analyze");
        if (javaAnalyzeTool) {
          const sampleFiles = fileStats.java.slice(0, 10);
          const javaResults: any[] = [];
          for (const file of sampleFiles) {
            try {
              const r = await javaAnalyzeTool.handler({ filepath: file, format: "json" });
              if (r.success) {
                javaResults.push({ file, result: JSON.parse(r.content) });
              }
            } catch (e) { /* ignore */ }
          }
          if (javaResults.length > 0) {
            results.push({
              tool: "java_analyze",
              success: true,
              summary: {
                analyzedFiles: javaResults.length,
                totalJavaFiles: fileStats.java.length,
                samples: javaResults,
              },
            });
          }
        }

        // Spring 패턴 (파일 단위)
        const springCheckTool = javaTools.find(t => t.name === "spring_check");
        if (springCheckTool) {
          const sampleFiles = fileStats.java.slice(0, 20);
          const springResults: any[] = [];
          for (const file of sampleFiles) {
            try {
              const r = await springCheckTool.handler({ filepath: file, format: "json" });
              if (r.success) {
                const parsed = JSON.parse(r.content);
                if (parsed.annotations?.length > 0 || parsed.patterns?.length > 0) {
                  springResults.push({ file, result: parsed });
                }
              }
            } catch (e) { /* ignore */ }
          }
          if (springResults.length > 0) {
            results.push({
              tool: "spring_check",
              success: true,
              summary: {
                springFiles: springResults.length,
                samples: springResults.slice(0, 10),
              },
            });
          }
        }

        // SQL in Java (디렉토리 단위)
        const sqlCheckTool = sqlTools.find(t => t.name === "sql_check");
        if (sqlCheckTool) {
          results.push(await runTool(sqlCheckTool, { path: targetPath }));
        }
      }

      // XML (MyBatis) 분석
      if (fileStats.xml.length > 0 && shouldAnalyze("xml")) {
        const mybatisCheckTool = mybatisTools.find(t => t.name === "mybatis_check");
        if (mybatisCheckTool) {
          results.push(await runTool(mybatisCheckTool, { path: targetPath }));
        }
      }

      // JavaScript/TypeScript 분석 (파일 단위 도구 - 샘플링)
      const jsFiles = [...fileStats.js, ...fileStats.ts, ...fileStats.jsx, ...fileStats.tsx];
      if (jsFiles.length > 0 && (shouldAnalyze("js") || shouldAnalyze("ts"))) {
        // AST 분석 (최대 10개 파일 샘플링)
        const astAnalyzeTool = astTools.find(t => t.name === "ast_analyze");
        if (astAnalyzeTool) {
          const sampleFiles = jsFiles.slice(0, 10);
          const astResults: any[] = [];
          for (const file of sampleFiles) {
            try {
              const r = await astAnalyzeTool.handler({ filepath: file, format: "json" });
              if (r.success) {
                astResults.push({ file, result: JSON.parse(r.content) });
              }
            } catch (e) { /* ignore */ }
          }
          if (astResults.length > 0) {
            results.push({
              tool: "ast_analyze",
              success: true,
              summary: {
                analyzedFiles: astResults.length,
                totalJsFiles: jsFiles.length,
                samples: astResults,
              },
            });
          }
        }

        // React 분석 (파일 단위)
        const reactFiles = [...fileStats.jsx, ...fileStats.tsx];
        if (reactFiles.length > 0 && shouldAnalyze("react")) {
          const reactCheckTool = frontendTools.find(t => t.name === "react_check");
          if (reactCheckTool) {
            const sampleFiles = reactFiles.slice(0, 10);
            const reactResults: any[] = [];
            for (const file of sampleFiles) {
              try {
                const r = await reactCheckTool.handler({ filepath: file });
                if (r.success) {
                  reactResults.push({ file, result: JSON.parse(r.content) });
                }
              } catch (e) { /* ignore */ }
            }
            if (reactResults.length > 0) {
              results.push({
                tool: "react_check",
                success: true,
                summary: { analyzedFiles: reactResults.length, samples: reactResults },
              });
            }
          }
        }

        // jQuery 분석 (파일 단위)
        if (shouldAnalyze("jquery")) {
          const jqueryCheckTool = frontendTools.find(t => t.name === "jquery_check");
          if (jqueryCheckTool) {
            const sampleFiles = jsFiles.slice(0, 10);
            const jqueryResults: any[] = [];
            for (const file of sampleFiles) {
              try {
                const r = await jqueryCheckTool.handler({ filepath: file });
                if (r.success) {
                  const parsed = JSON.parse(r.content);
                  if (parsed.hasJQuery || parsed.deprecated?.length > 0) {
                    jqueryResults.push({ file, result: parsed });
                  }
                }
              } catch (e) { /* ignore */ }
            }
            if (jqueryResults.length > 0) {
              results.push({
                tool: "jquery_check",
                success: true,
                summary: { filesWithJQuery: jqueryResults.length, samples: jqueryResults },
              });
            }
          }
        }
      }

      // Vue 분석 (파일 단위)
      if (fileStats.vue.length > 0 && shouldAnalyze("vue")) {
        const vueCheckTool = frontendTools.find(t => t.name === "vue_check");
        if (vueCheckTool) {
          const sampleFiles = fileStats.vue.slice(0, 10);
          const vueResults: any[] = [];
          for (const file of sampleFiles) {
            try {
              const r = await vueCheckTool.handler({ filepath: file });
              if (r.success) {
                vueResults.push({ file, result: JSON.parse(r.content) });
              }
            } catch (e) { /* ignore */ }
          }
          if (vueResults.length > 0) {
            results.push({
              tool: "vue_check",
              success: true,
              summary: { analyzedFiles: vueResults.length, samples: vueResults },
            });
          }
        }
      }

      // Python 분석
      if (fileStats.py.length > 0 && shouldAnalyze("py")) {
        const pythonCheckTool = pythonTools.find(t => t.name === "python_check");
        if (pythonCheckTool) {
          results.push(await runTool(pythonCheckTool, { path: targetPath }));
        }
      }

      // CSS/SCSS 분석
      const cssFiles = [...fileStats.css, ...fileStats.scss];
      if (cssFiles.length > 0 && shouldAnalyze("css")) {
        const cssCheckTool = cssTools.find(t => t.name === "css_check");
        if (cssCheckTool) {
          results.push(await runTool(cssCheckTool, { path: targetPath }));
        }
      }

      // HTML/JSP 분석
      const htmlFiles = [...fileStats.html, ...fileStats.jsp];
      if (htmlFiles.length > 0 && shouldAnalyze("html")) {
        const htmlCheckTool = htmlTools.find(t => t.name === "html_check");
        if (htmlCheckTool) {
          results.push(await runTool(htmlCheckTool, { path: targetPath }));
        }
      }

      // 의존성 분석 (package.json, pom.xml)
      const hasPackageJson = fileStats.json.some(f => f.endsWith("package.json"));
      const hasPomXml = fileStats.xml.some(f => f.endsWith("pom.xml"));
      if ((hasPackageJson || hasPomXml) && shouldAnalyze("dependency")) {
        const dependencyCheckTool = dependencyTools.find(t => t.name === "dependency_check");
        if (dependencyCheckTool) {
          results.push(await runTool(dependencyCheckTool, { path: targetPath }));
        }
      }

      // OpenAPI 분석
      const hasOpenApi = [...fileStats.yaml, ...fileStats.json].some(f =>
        f.includes("swagger") || f.includes("openapi") || f.includes("api-docs")
      );
      if (hasOpenApi && shouldAnalyze("openapi")) {
        const openapiCheckTool = openapiTools.find(t => t.name === "openapi_check");
        if (openapiCheckTool) {
          results.push(await runTool(openapiCheckTool, { path: targetPath }));
        }
      }

      // 결과 요약
      const successfulAnalyses = results.filter(r => r.success);
      const failedAnalyses = results.filter(r => !r.success);

      // 주요 이슈 추출
      const issues: { tool: string; issues: string[] }[] = [];

      for (const result of successfulAnalyses) {
        const toolIssues: string[] = [];
        const summary = result.summary;

        // 각 도구별 이슈 추출
        if (result.tool === "java_analyze" && summary.files) {
          summary.files.forEach((f: any) => {
            if (f.issues?.length > 0) {
              toolIssues.push(...f.issues.slice(0, 3));
            }
          });
        }
        if (result.tool === "mybatis_check" && summary.injectionRisks > 0) {
          toolIssues.push(`SQL Injection 위험 ${summary.injectionRisks}건`);
        }
        if (result.tool === "sql_check" && summary.queriesWithIssues > 0) {
          toolIssues.push(`SQL 쿼리 이슈 ${summary.queriesWithIssues}건`);
        }
        if (result.tool === "spring_check" && summary.issues) {
          toolIssues.push(...summary.issues.slice(0, 3));
        }
        if (result.tool === "dependency_check" && summary.securityConcerns > 0) {
          toolIssues.push(`보안 취약점 ${summary.securityConcerns}건`);
        }
        if (result.tool === "css_check" && summary.totalImportant > 5) {
          toolIssues.push(`!important 과다 사용 ${summary.totalImportant}회`);
        }
        if (result.tool === "html_check" && summary.averageA11yScore < 60) {
          toolIssues.push(`접근성 점수 낮음 (${summary.averageA11yScore}%)`);
        }
        if (result.tool === "python_check" && summary.docstringCoverage < 50) {
          toolIssues.push(`Python docstring 부족 (${summary.docstringCoverage}%)`);
        }

        if (toolIssues.length > 0) {
          issues.push({ tool: result.tool, issues: toolIssues });
        }
      }

      const output = {
        path: targetPath,
        fileStats: fileCounts,
        totalFiles: Object.values(fileCounts).reduce((a, b) => a + b, 0),
        analysesRun: results.length,
        successful: successfulAnalyses.length,
        failed: failedAnalyses.length,
        issuesSummary: issues,
        details: successfulAnalyses.map(r => ({
          tool: r.tool,
          summary: r.summary,
        })),
        errors: failedAnalyses.map(r => ({
          tool: r.tool,
          error: r.error,
        })),
      };

      return {
        success: true,
        content: JSON.stringify(output, null, 2),
      };
    },
  },
];
