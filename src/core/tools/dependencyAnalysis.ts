import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface Dependency {
  name: string;
  version: string;
  type: "dependency" | "devDependency" | "peerDependency" | "compile" | "runtime" | "test" | "provided";
  issues: string[];
}

interface DependencyAnalysisResult {
  file: string;
  type: "npm" | "maven" | "gradle";
  projectName?: string;
  projectVersion?: string;
  dependencies: Dependency[];
  summary: {
    total: number;
    withIssues: number;
    outdatedPatterns: number;
    securityConcerns: number;
  };
}

// 알려진 취약점/문제 패턴
const knownIssues: Record<string, { pattern: RegExp; message: string }[]> = {
  npm: [
    { pattern: /^lodash@[0-3]\./, message: "lodash 4.x 이전 버전 - 보안 취약점" },
    { pattern: /^moment@/, message: "moment.js deprecated - dayjs/date-fns 권장" },
    { pattern: /^request@/, message: "request deprecated - axios/node-fetch 권장" },
    { pattern: /^jquery@[12]\./, message: "jQuery 3.x 이전 버전 - XSS 취약점" },
    { pattern: /^angular@1\./, message: "AngularJS 1.x EOL - Angular 권장" },
    { pattern: /^react@1[0-5]\./, message: "React 16 이전 버전 - 업데이트 권장" },
    { pattern: /^vue@[12]\./, message: "Vue 2.x - Vue 3.x 마이그레이션 검토" },
    { pattern: /^webpack@[1-3]\./, message: "Webpack 4 이전 버전 - 업데이트 권장" },
    { pattern: /^node-sass@/, message: "node-sass deprecated - sass(dart-sass) 권장" },
    { pattern: /^tslint@/, message: "TSLint deprecated - ESLint 권장" },
    { pattern: /^crypto-js@[0-3]\./, message: "crypto-js 구버전 - 보안 취약점" },
    { pattern: /^express@[0-3]\./, message: "Express 4 이전 버전 - 보안 취약점" },
    { pattern: /^axios@0\.[0-1]/, message: "axios 0.21 이전 - SSRF 취약점" },
  ],
  maven: [
    { pattern: /log4j.*1\./, message: "Log4j 1.x EOL - Log4j 2.x 또는 Logback 권장" },
    { pattern: /log4j.*2\.[0-9]\./, message: "Log4j 2.0-2.14 - Log4Shell 취약점 (CVE-2021-44228)" },
    { pattern: /log4j.*2\.1[0-4]\./, message: "Log4j 2.10-2.14 - Log4Shell 취약점" },
    { pattern: /commons-collections.*[0-3]\./, message: "Commons Collections 3.x - 역직렬화 취약점" },
    { pattern: /spring-core.*[0-4]\./, message: "Spring 5 이전 버전 - 업데이트 권장" },
    { pattern: /jackson-databind.*2\.[0-8]\./, message: "Jackson 2.9 이전 - 역직렬화 취약점" },
    { pattern: /struts.*1\./, message: "Struts 1.x EOL - 보안 취약점 다수" },
    { pattern: /struts2.*2\.[0-4]\./, message: "Struts 2.5 이전 - 원격 코드 실행 취약점" },
    { pattern: /hibernate.*[0-4]\./, message: "Hibernate 5 이전 버전 - 업데이트 권장" },
    { pattern: /mysql-connector.*5\./, message: "MySQL Connector 8.x 권장" },
    { pattern: /fastjson.*1\.[12]\.[0-5]/, message: "Fastjson 1.2.68 이전 - 원격 코드 실행 취약점" },
    { pattern: /commons-fileupload.*1\.[0-3]\./, message: "Commons FileUpload 1.4 이전 - DoS 취약점" },
    { pattern: /shiro.*1\.[0-5]\./, message: "Apache Shiro 1.6 이전 - 인증 우회 취약점" },
  ],
};

// 버전 패턴 검사
const versionPatterns = {
  range: /^[\^~><=]/,
  latest: /^(latest|\*)$/,
  git: /^(git|github|gitlab)/,
  file: /^file:/,
};

// package.json 분석
function analyzePackageJson(filePath: string): DependencyAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const pkg = JSON.parse(content);
  const dependencies: Dependency[] = [];

  const analyzeDeps = (deps: Record<string, string> | undefined, type: Dependency["type"]) => {
    if (!deps) return;

    Object.entries(deps).forEach(([name, version]) => {
      const issues: string[] = [];
      const fullName = `${name}@${version}`;

      // 알려진 이슈 검사
      knownIssues.npm.forEach(({ pattern, message }) => {
        if (pattern.test(fullName)) {
          issues.push(message);
        }
      });

      // 버전 패턴 검사
      if (versionPatterns.latest.test(version)) {
        issues.push("'latest' 또는 '*' 사용 - 버전 고정 권장");
      }
      if (versionPatterns.git.test(version)) {
        issues.push("Git 의존성 - 버전 태그 사용 권장");
      }
      if (version.startsWith("^0.") || version.startsWith("~0.")) {
        issues.push("0.x 버전 - 불안정 버전 주의");
      }

      dependencies.push({ name, version, type, issues });
    });
  };

  analyzeDeps(pkg.dependencies, "dependency");
  analyzeDeps(pkg.devDependencies, "devDependency");
  analyzeDeps(pkg.peerDependencies, "peerDependency");

  const withIssues = dependencies.filter((d) => d.issues.length > 0);
  const securityConcerns = dependencies.filter((d) =>
    d.issues.some((i) => i.includes("취약점") || i.includes("보안"))
  ).length;

  return {
    file: filePath,
    type: "npm",
    projectName: pkg.name,
    projectVersion: pkg.version,
    dependencies,
    summary: {
      total: dependencies.length,
      withIssues: withIssues.length,
      outdatedPatterns: dependencies.filter((d) =>
        d.issues.some((i) => i.includes("deprecated") || i.includes("EOL") || i.includes("이전"))
      ).length,
      securityConcerns,
    },
  };
}

// pom.xml 분석
function analyzePomXml(filePath: string): DependencyAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const dependencies: Dependency[] = [];

  // 프로젝트 정보 추출
  const artifactIdMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
  const versionMatch = content.match(/<version>([^<]+)<\/version>/);

  // 의존성 추출
  const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]*)<\/version>)?(?:\s*<scope>([^<]*)<\/scope>)?/g;

  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const groupId = match[1];
    const artifactId = match[2];
    const version = match[3] || "미지정";
    const scope = match[4] || "compile";
    const name = `${groupId}:${artifactId}`;
    const issues: string[] = [];
    const fullName = `${artifactId}.*${version}`;

    // 알려진 이슈 검사
    knownIssues.maven.forEach(({ pattern, message }) => {
      if (pattern.test(fullName) || pattern.test(`${groupId}.${artifactId}.*${version}`)) {
        issues.push(message);
      }
    });

    // 버전 미지정 검사
    if (version === "미지정" || version.includes("${")) {
      if (!version.includes("${")) {
        issues.push("버전 미지정 - 명시적 버전 지정 권장");
      }
    }

    // SNAPSHOT 버전 검사
    if (version.includes("SNAPSHOT")) {
      issues.push("SNAPSHOT 버전 - 프로덕션에서 릴리즈 버전 사용 권장");
    }

    const type: Dependency["type"] =
      scope === "test" ? "test" :
      scope === "provided" ? "provided" :
      scope === "runtime" ? "runtime" : "compile";

    dependencies.push({ name, version, type, issues });
  }

  const withIssues = dependencies.filter((d) => d.issues.length > 0);
  const securityConcerns = dependencies.filter((d) =>
    d.issues.some((i) => i.includes("취약점") || i.includes("보안") || i.includes("CVE"))
  ).length;

  return {
    file: filePath,
    type: "maven",
    projectName: artifactIdMatch ? artifactIdMatch[1] : undefined,
    projectVersion: versionMatch ? versionMatch[1] : undefined,
    dependencies,
    summary: {
      total: dependencies.length,
      withIssues: withIssues.length,
      outdatedPatterns: dependencies.filter((d) =>
        d.issues.some((i) => i.includes("EOL") || i.includes("이전"))
      ).length,
      securityConcerns,
    },
  };
}

// build.gradle 분석 (간단한 버전)
function analyzeBuildGradle(filePath: string): DependencyAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const dependencies: Dependency[] = [];

  // 의존성 추출 (implementation, compile, testImplementation 등)
  const depRegex = /(?:implementation|compile|testImplementation|testCompile|runtimeOnly|compileOnly|api)\s*['"(]([^'"()]+)['"()]/g;

  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const depString = match[1];
    const parts = depString.split(":");

    if (parts.length >= 2) {
      const name = `${parts[0]}:${parts[1]}`;
      const version = parts[2] || "미지정";
      const issues: string[] = [];

      // 알려진 이슈 검사
      knownIssues.maven.forEach(({ pattern, message }) => {
        if (pattern.test(`${parts[1]}.*${version}`)) {
          issues.push(message);
        }
      });

      if (version === "미지정" || version.includes("$")) {
        if (!version.includes("$")) {
          issues.push("버전 미지정");
        }
      }

      dependencies.push({
        name,
        version,
        type: match[0].includes("test") ? "test" : "compile",
        issues,
      });
    }
  }

  const withIssues = dependencies.filter((d) => d.issues.length > 0);

  return {
    file: filePath,
    type: "gradle",
    dependencies,
    summary: {
      total: dependencies.length,
      withIssues: withIssues.length,
      outdatedPatterns: dependencies.filter((d) =>
        d.issues.some((i) => i.includes("EOL") || i.includes("이전"))
      ).length,
      securityConcerns: dependencies.filter((d) =>
        d.issues.some((i) => i.includes("취약점") || i.includes("CVE"))
      ).length,
    },
  };
}

// 도구 정의
export const dependencyTools: Tool[] = [
  {
    name: "dependency_check",
    description:
      "프로젝트 의존성을 분석합니다. package.json, pom.xml, build.gradle에서 의존성을 추출하고 알려진 취약점, deprecated 패키지, 버전 문제를 검사합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 파일 또는 디렉토리 경로",
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

      const results: DependencyAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);
      const depFiles = ["package.json", "pom.xml", "build.gradle"];

      const analyzeFile = (filePath: string) => {
        const fileName = path.basename(filePath);
        if (fileName === "package.json") {
          try {
            results.push(analyzePackageJson(filePath));
          } catch (e) {
            // JSON 파싱 실패 무시
          }
        } else if (fileName === "pom.xml") {
          results.push(analyzePomXml(filePath));
        } else if (fileName === "build.gradle") {
          results.push(analyzeBuildGradle(filePath));
        }
      };

      if (stats.isFile()) {
        analyzeFile(targetPath);
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
            } else if (depFiles.includes(file)) {
              analyzeFile(filePath);
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const totalDeps = results.reduce((sum, r) => sum + r.summary.total, 0);
      const totalWithIssues = results.reduce((sum, r) => sum + r.summary.withIssues, 0);
      const totalSecurity = results.reduce((sum, r) => sum + r.summary.securityConcerns, 0);

      const output = {
        analyzedFiles: results.length,
        totalDependencies: totalDeps,
        dependenciesWithIssues: totalWithIssues,
        securityConcerns: totalSecurity,
        projects: results.map((r) => ({
          file: r.file,
          type: r.type,
          projectName: r.projectName,
          projectVersion: r.projectVersion,
          summary: r.summary,
          issuesFound: r.dependencies
            .filter((d) => d.issues.length > 0)
            .map((d) => ({
              name: d.name,
              version: d.version,
              type: d.type,
              issues: d.issues,
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
