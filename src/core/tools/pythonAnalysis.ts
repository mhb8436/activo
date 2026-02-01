import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface PythonFunction {
  name: string;
  line: number;
  args: string[];
  decorators: string[];
  isAsync: boolean;
  docstring: boolean;
  issues: string[];
}

interface PythonClass {
  name: string;
  line: number;
  bases: string[];
  decorators: string[];
  methods: string[];
  docstring: boolean;
  issues: string[];
}

interface PythonImport {
  module: string;
  names: string[];
  line: number;
  issues: string[];
}

interface PythonAnalysisResult {
  file: string;
  framework?: "django" | "flask" | "fastapi" | "general";
  imports: PythonImport[];
  classes: PythonClass[];
  functions: PythonFunction[];
  issues: string[];
  summary: {
    totalClasses: number;
    totalFunctions: number;
    withDocstring: number;
    withIssues: number;
    frameworkPatterns: string[];
  };
}

// Django 패턴
const djangoPatterns = {
  views: /class\s+\w+View|def\s+\w+\(request/,
  models: /class\s+\w+\(.*models\.Model\)/,
  forms: /class\s+\w+\(.*forms\.(Form|ModelForm)\)/,
  serializers: /class\s+\w+\(.*serializers\.\w+Serializer\)/,
  admin: /@admin\.register|admin\.site\.register/,
  urls: /urlpatterns\s*=|path\(|re_path\(/,
};

// Flask 패턴
const flaskPatterns = {
  routes: /@app\.route|@blueprint\.route/,
  views: /def\s+\w+\(\):|def\s+\w+\(.*\):/,
  blueprints: /Blueprint\(/,
};

// FastAPI 패턴
const fastapiPatterns = {
  routes: /@app\.(get|post|put|patch|delete)|@router\.(get|post|put|patch|delete)/,
  dependencies: /Depends\(/,
  pydantic: /class\s+\w+\(.*BaseModel\)/,
};

// PEP8/일반 이슈 패턴
const codeIssuePatterns = [
  { pattern: /^\s*import \*/, message: "와일드카드 import 사용 - 명시적 import 권장" },
  { pattern: /except:$/m, message: "bare except 사용 - 구체적 예외 타입 권장" },
  { pattern: /except Exception:$/m, message: "broad except 사용 - 구체적 예외 타입 권장" },
  { pattern: /eval\(/, message: "eval() 사용 - 보안 위험" },
  { pattern: /exec\(/, message: "exec() 사용 - 보안 위험" },
  { pattern: /pickle\.load/, message: "pickle.load() - 신뢰할 수 없는 데이터 역직렬화 위험" },
  { pattern: /subprocess\.call\(.*shell\s*=\s*True/, message: "shell=True - 명령 인젝션 위험" },
  { pattern: /os\.system\(/, message: "os.system() - subprocess 모듈 권장" },
  { pattern: /print\(/, message: "print() 사용 - logging 모듈 권장" },
  { pattern: /TODO|FIXME|XXX|HACK/, message: "TODO/FIXME 주석 발견" },
  { pattern: /password\s*=\s*['"][^'"]+['"]/, message: "하드코딩된 비밀번호 의심" },
  { pattern: /api_key\s*=\s*['"][^'"]+['"]/, message: "하드코딩된 API 키 의심" },
  { pattern: /secret\s*=\s*['"][^'"]+['"]/, message: "하드코딩된 시크릿 의심" },
];

// Python 파일 분석
function analyzePythonFile(filePath: string): PythonAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const imports: PythonImport[] = [];
  const classes: PythonClass[] = [];
  const functions: PythonFunction[] = [];
  const fileIssues: string[] = [];
  const frameworkPatterns: string[] = [];

  // 프레임워크 감지
  let framework: PythonAnalysisResult["framework"] = "general";
  if (/from django|import django/.test(content)) {
    framework = "django";
  } else if (/from flask|import flask/.test(content)) {
    framework = "flask";
  } else if (/from fastapi|import fastapi/.test(content)) {
    framework = "fastapi";
  }

  // Django 패턴 검사
  if (framework === "django") {
    Object.entries(djangoPatterns).forEach(([name, pattern]) => {
      if (pattern.test(content)) {
        frameworkPatterns.push(`django:${name}`);
      }
    });
  }

  // Flask 패턴 검사
  if (framework === "flask") {
    Object.entries(flaskPatterns).forEach(([name, pattern]) => {
      if (pattern.test(content)) {
        frameworkPatterns.push(`flask:${name}`);
      }
    });
  }

  // FastAPI 패턴 검사
  if (framework === "fastapi") {
    Object.entries(fastapiPatterns).forEach(([name, pattern]) => {
      if (pattern.test(content)) {
        frameworkPatterns.push(`fastapi:${name}`);
      }
    });
  }

  // Import 추출
  const importRegex = /^(?:from\s+([\w.]+)\s+)?import\s+(.+)$/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const module = match[1] || match[2].split(",")[0].trim().split(" ")[0];
    const namesStr = match[1] ? match[2] : "";
    const names = namesStr
      ? namesStr.split(",").map((n) => n.trim().split(" as ")[0].trim())
      : [];

    const importIssues: string[] = [];

    // 와일드카드 import 검사
    if (names.includes("*")) {
      importIssues.push("와일드카드 import - 명시적 import 권장");
    }

    // deprecated 모듈 검사
    const deprecatedModules = ["imp", "optparse", "formatter", "mimetools", "rfc822"];
    if (deprecatedModules.includes(module)) {
      importIssues.push(`deprecated 모듈: ${module}`);
    }

    // 라인 번호 찾기
    const importIndex = match.index;
    let lineNum = 1;
    for (let i = 0; i < importIndex && i < content.length; i++) {
      if (content[i] === "\n") lineNum++;
    }

    imports.push({
      module,
      names,
      line: lineNum,
      issues: importIssues,
    });
  }

  // 클래스 추출
  const classRegex = /^(\s*)(@[\w.]+(?:\([^)]*\))?\s*\n)*\s*class\s+(\w+)(?:\(([^)]*)\))?:/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const indent = match[1]?.length || 0;
    const className = match[3];
    const basesStr = match[4] || "";
    const bases = basesStr.split(",").map((b) => b.trim()).filter(Boolean);

    const classIssues: string[] = [];

    // 라인 번호
    const classIndex = match.index;
    let lineNum = 1;
    for (let i = 0; i < classIndex && i < content.length; i++) {
      if (content[i] === "\n") lineNum++;
    }

    // 데코레이터 추출
    const decorators: string[] = [];
    const preClassContent = content.substring(0, classIndex);
    const preLines = preClassContent.split("\n").slice(-10);
    for (const line of preLines) {
      const decMatch = line.match(/^\s*@([\w.]+)/);
      if (decMatch) {
        decorators.push(decMatch[1]);
      }
    }

    // docstring 검사
    const classBody = content.substring(classIndex);
    const hasDocstring = /class\s+\w+[^:]*:\s*\n\s*(['"]){3}/.test(classBody.substring(0, 200));

    if (!hasDocstring) {
      classIssues.push("docstring 없음");
    }

    // 메서드 추출 (간단한 버전)
    const methods: string[] = [];
    const methodRegex = /def\s+(\w+)\s*\(/g;
    const classEnd = content.indexOf("\nclass ", classIndex + 1);
    const classContent = classEnd > 0
      ? content.substring(classIndex, classEnd)
      : content.substring(classIndex);

    let methodMatch;
    while ((methodMatch = methodRegex.exec(classContent)) !== null) {
      methods.push(methodMatch[1]);
    }

    // Django Model 이슈 검사
    if (bases.some((b) => b.includes("Model"))) {
      if (!classContent.includes("class Meta:")) {
        classIssues.push("Django Model에 Meta 클래스 없음");
      }
      if (!classContent.includes("def __str__")) {
        classIssues.push("Django Model에 __str__ 메서드 없음");
      }
    }

    classes.push({
      name: className,
      line: lineNum,
      bases,
      decorators,
      methods: methods.slice(0, 20), // 최대 20개
      docstring: hasDocstring,
      issues: classIssues,
    });
  }

  // 함수 추출 (최상위 레벨)
  const funcRegex = /^(@[\w.]+(?:\([^)]*\))?\s*\n)*\s*(async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
  while ((match = funcRegex.exec(content)) !== null) {
    // 클래스 내부 함수는 제외 (indent로 판단)
    const preContent = content.substring(0, match.index);
    const lastNewline = preContent.lastIndexOf("\n");
    const lineStart = preContent.substring(lastNewline + 1);
    if (lineStart.match(/^\s{4,}/)) continue; // 4칸 이상 들여쓰기면 메서드로 간주

    const isAsync = !!match[2];
    const funcName = match[3];
    const argsStr = match[4];
    const args = argsStr
      .split(",")
      .map((a) => a.trim().split(":")[0].split("=")[0].trim())
      .filter(Boolean);

    const funcIssues: string[] = [];

    // 라인 번호
    const funcIndex = match.index;
    let lineNum = 1;
    for (let i = 0; i < funcIndex && i < content.length; i++) {
      if (content[i] === "\n") lineNum++;
    }

    // 데코레이터 추출
    const decorators: string[] = [];
    const preFuncContent = content.substring(Math.max(0, funcIndex - 500), funcIndex);
    const preFuncLines = preFuncContent.split("\n").slice(-10);
    for (const line of preFuncLines) {
      const decMatch = line.match(/^\s*@([\w.]+)/);
      if (decMatch) {
        decorators.push(decMatch[1]);
      }
    }

    // docstring 검사
    const funcBody = content.substring(funcIndex);
    const hasDocstring = /def\s+\w+[^:]*:\s*\n\s*(['"]){3}/.test(funcBody.substring(0, 200));

    if (!hasDocstring && !funcName.startsWith("_")) {
      funcIssues.push("docstring 없음");
    }

    // Flask/FastAPI 라우트 검사
    if (decorators.some((d) => d.includes("route") || d.includes("get") || d.includes("post"))) {
      if (!hasDocstring) {
        funcIssues.push("API 엔드포인트에 docstring 없음");
      }
    }

    // Django view 검사
    if (args.includes("request") && framework === "django") {
      if (!decorators.some((d) => d.includes("login_required") || d.includes("permission"))) {
        funcIssues.push("Django view에 인증 데코레이터 없음 (확인 필요)");
      }
    }

    functions.push({
      name: funcName,
      line: lineNum,
      args,
      decorators,
      isAsync,
      docstring: hasDocstring,
      issues: funcIssues,
    });
  }

  // 파일 레벨 이슈 검사
  codeIssuePatterns.forEach(({ pattern, message }) => {
    if (pattern.test(content)) {
      fileIssues.push(message);
    }
  });

  // 파일 길이 검사
  if (lines.length > 500) {
    fileIssues.push(`파일 길이 ${lines.length}줄 - 분할 검토`);
  }

  // 최대 줄 길이 검사
  const longLines = lines.filter((l) => l.length > 120).length;
  if (longLines > 10) {
    fileIssues.push(`120자 초과 줄 ${longLines}개`);
  }

  // docstring 통계
  const withDocstring =
    classes.filter((c) => c.docstring).length +
    functions.filter((f) => f.docstring).length;
  const total = classes.length + functions.length;

  return {
    file: filePath,
    framework,
    imports,
    classes,
    functions,
    issues: fileIssues,
    summary: {
      totalClasses: classes.length,
      totalFunctions: functions.length,
      withDocstring,
      withIssues:
        classes.filter((c) => c.issues.length > 0).length +
        functions.filter((f) => f.issues.length > 0).length,
      frameworkPatterns,
    },
  };
}

// 도구 정의
export const pythonTools: Tool[] = [
  {
    name: "python_check",
    description:
      "Python 파일을 분석합니다. 클래스, 함수, import를 추출하고 Django/Flask/FastAPI 패턴, PEP8 권장사항, 보안 이슈를 검사합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 Python 파일 또는 디렉토리 경로",
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

      const results: PythonAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);

      if (stats.isFile()) {
        if (targetPath.endsWith(".py")) {
          results.push(analyzePythonFile(targetPath));
        }
      } else if (stats.isDirectory()) {
        const walkDir = (dir: string) => {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            const fileStat = fs.statSync(filePath);
            if (fileStat.isDirectory() && recursive) {
              if (
                !file.startsWith(".") &&
                file !== "node_modules" &&
                file !== "__pycache__" &&
                file !== "venv" &&
                file !== ".venv" &&
                file !== "env"
              ) {
                walkDir(filePath);
              }
            } else if (file.endsWith(".py") && !file.startsWith("__")) {
              results.push(analyzePythonFile(filePath));
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const totalClasses = results.reduce((sum, r) => sum + r.summary.totalClasses, 0);
      const totalFunctions = results.reduce((sum, r) => sum + r.summary.totalFunctions, 0);
      const totalWithDocstring = results.reduce((sum, r) => sum + r.summary.withDocstring, 0);

      // 프레임워크 통계
      const frameworks: Record<string, number> = {};
      results.forEach((r) => {
        if (r.framework) {
          frameworks[r.framework] = (frameworks[r.framework] || 0) + 1;
        }
      });

      const output = {
        analyzedFiles: results.length,
        totalClasses,
        totalFunctions,
        docstringCoverage:
          totalClasses + totalFunctions > 0
            ? Math.round((totalWithDocstring / (totalClasses + totalFunctions)) * 100)
            : 0,
        frameworks,
        files: results.map((r) => ({
          file: r.file,
          framework: r.framework,
          frameworkPatterns: r.summary.frameworkPatterns,
          fileIssues: r.issues,
          summary: r.summary,
          imports: r.imports.filter((i) => i.issues.length > 0),
          classes: r.classes.map((c) => ({
            name: c.name,
            line: c.line,
            bases: c.bases,
            decorators: c.decorators,
            methodCount: c.methods.length,
            docstring: c.docstring,
            issues: c.issues,
          })),
          functions: r.functions.map((f) => ({
            name: f.name,
            line: f.line,
            decorators: f.decorators,
            isAsync: f.isAsync,
            docstring: f.docstring,
            issues: f.issues,
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
