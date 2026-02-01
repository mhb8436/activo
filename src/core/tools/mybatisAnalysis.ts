import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface MybatisStatement {
  id: string;
  type: "select" | "insert" | "update" | "delete" | "sql";
  parameterType?: string;
  resultType?: string;
  resultMap?: string;
  sql: string;
  line: number;
  issues: string[];
  dynamicElements: string[];
}

interface MybatisMapper {
  file: string;
  namespace: string;
  statements: MybatisStatement[];
  resultMaps: string[];
  sqlFragments: string[];
  issues: string[];
}

interface MybatisAnalysisResult {
  file: string;
  isMyBatis: boolean;
  mapper?: MybatisMapper;
  summary: {
    statements: number;
    withIssues: number;
    injectionRisks: number;
    dynamicSqlCount: number;
  };
}

// MyBatis XML 파싱 및 분석
function analyzeMyBatisXml(filePath: string): MybatisAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // MyBatis XML 여부 확인
  const isMyBatis =
    content.includes("mybatis") ||
    content.includes("ibatis") ||
    content.includes('PUBLIC "-//mybatis.org') ||
    content.includes('PUBLIC "-//ibatis.org') ||
    /<mapper\s+namespace=/i.test(content);

  if (!isMyBatis) {
    return {
      file: filePath,
      isMyBatis: false,
      summary: { statements: 0, withIssues: 0, injectionRisks: 0, dynamicSqlCount: 0 },
    };
  }

  const statements: MybatisStatement[] = [];
  const resultMaps: string[] = [];
  const sqlFragments: string[] = [];
  const mapperIssues: string[] = [];

  // namespace 추출
  const namespaceMatch = content.match(/<mapper\s+namespace=["']([^"']+)["']/);
  const namespace = namespaceMatch ? namespaceMatch[1] : "unknown";

  // resultMap 추출
  const resultMapRegex = /<resultMap\s+[^>]*id=["']([^"']+)["'][^>]*>/g;
  let match;
  while ((match = resultMapRegex.exec(content)) !== null) {
    resultMaps.push(match[1]);
  }

  // sql fragment 추출
  const sqlFragmentRegex = /<sql\s+[^>]*id=["']([^"']+)["'][^>]*>/g;
  while ((match = sqlFragmentRegex.exec(content)) !== null) {
    sqlFragments.push(match[1]);
  }

  // statement 추출 함수
  const extractStatements = (type: "select" | "insert" | "update" | "delete") => {
    const regex = new RegExp(
      `<${type}\\s+([^>]*)>([\\s\\S]*?)</${type}>`,
      "gi"
    );

    while ((match = regex.exec(content)) !== null) {
      const attrs = match[1];
      const sqlContent = match[2];

      // 속성 파싱
      const idMatch = attrs.match(/id=["']([^"']+)["']/);
      const paramMatch = attrs.match(/parameterType=["']([^"']+)["']/);
      const resultTypeMatch = attrs.match(/resultType=["']([^"']+)["']/);
      const resultMapMatch = attrs.match(/resultMap=["']([^"']+)["']/);

      const id = idMatch ? idMatch[1] : "unknown";
      const issues: string[] = [];
      const dynamicElements: string[] = [];

      // ${} 사용 검사 (SQL Injection 위험)
      const dollarBraceMatches = sqlContent.match(/\$\{[^}]+\}/g) || [];
      if (dollarBraceMatches.length > 0) {
        issues.push(`SQL Injection 위험: ${dollarBraceMatches.join(", ")} 사용`);
      }

      // 동적 SQL 요소 추출
      const dynamicTags = ["if", "choose", "when", "otherwise", "where", "set", "foreach", "trim", "bind"];
      dynamicTags.forEach((tag) => {
        const tagRegex = new RegExp(`<${tag}[\\s>]`, "gi");
        const count = (sqlContent.match(tagRegex) || []).length;
        if (count > 0) {
          dynamicElements.push(`${tag}(${count})`);
        }
      });

      // SELECT * 검사
      if (/SELECT\s+\*\s+FROM/i.test(sqlContent)) {
        issues.push("SELECT * 사용");
      }

      // WHERE 없는 UPDATE/DELETE
      if ((type === "update" || type === "delete") && !/<where>|WHERE/i.test(sqlContent)) {
        issues.push("WHERE 절 없음 - 전체 테이블 영향 위험");
      }

      // 복잡한 동적 SQL
      if (dynamicElements.length >= 5) {
        issues.push(`복잡한 동적 SQL (${dynamicElements.length}개 요소)`);
      }

      // 중첩 foreach
      const foreachCount = (sqlContent.match(/<foreach/gi) || []).length;
      if (foreachCount >= 2) {
        issues.push(`중첩 foreach ${foreachCount}개 - 성능 검토 필요`);
      }

      // LIKE '%${...}%' 패턴
      if (/LIKE\s+['"]?%?\$\{/i.test(sqlContent)) {
        issues.push("LIKE + ${} 패턴 - SQL Injection 및 인덱스 문제");
      }

      // ORDER BY ${} 패턴
      if (/ORDER\s+BY\s+\$\{/i.test(sqlContent)) {
        issues.push("ORDER BY ${} - SQL Injection 위험");
      }

      // 라인 번호 찾기
      const statementIndex = content.indexOf(match[0]);
      let lineNum = 1;
      for (let i = 0; i < statementIndex; i++) {
        if (content[i] === "\n") lineNum++;
      }

      // SQL 정리
      const cleanSql = sqlContent
        .replace(/<[^>]+>/g, " ") // XML 태그 제거
        .replace(/\s+/g, " ")
        .trim();

      statements.push({
        id,
        type,
        parameterType: paramMatch ? paramMatch[1] : undefined,
        resultType: resultTypeMatch ? resultTypeMatch[1] : undefined,
        resultMap: resultMapMatch ? resultMapMatch[1] : undefined,
        sql: cleanSql,
        line: lineNum,
        issues,
        dynamicElements,
      });
    }
  };

  // 각 statement 타입 처리
  extractStatements("select");
  extractStatements("insert");
  extractStatements("update");
  extractStatements("delete");

  // mapper 레벨 이슈 검사
  if (!namespaceMatch) {
    mapperIssues.push("namespace 미정의");
  }

  // 미사용 resultMap 검사 (간단한 체크)
  resultMaps.forEach((rm) => {
    const usageCount = (content.match(new RegExp(`resultMap=["']${rm}["']`, "g")) || []).length;
    if (usageCount <= 1) {
      // 정의만 있고 사용 없음
      mapperIssues.push(`미사용 가능성: resultMap '${rm}'`);
    }
  });

  // 통계
  const injectionRisks = statements.filter((s) =>
    s.issues.some((i) => i.includes("Injection"))
  ).length;
  const dynamicSqlCount = statements.filter((s) => s.dynamicElements.length > 0).length;

  return {
    file: filePath,
    isMyBatis: true,
    mapper: {
      file: filePath,
      namespace,
      statements,
      resultMaps,
      sqlFragments,
      issues: mapperIssues,
    },
    summary: {
      statements: statements.length,
      withIssues: statements.filter((s) => s.issues.length > 0).length,
      injectionRisks,
      dynamicSqlCount,
    },
  };
}

// 도구 정의
export const mybatisTools: Tool[] = [
  {
    name: "mybatis_check",
    description:
      "MyBatis XML 매퍼 파일을 분석합니다. ${} SQL Injection 위험, 동적 SQL 복잡도, SELECT *, resultMap 사용 등을 검사합니다. DTD/namespace로 MyBatis 파일을 자동 감지합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 XML 파일 또는 디렉토리 경로",
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

      const results: MybatisAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);

      if (stats.isFile()) {
        if (targetPath.endsWith(".xml")) {
          const result = analyzeMyBatisXml(targetPath);
          if (result.isMyBatis) {
            results.push(result);
          }
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
            } else if (file.endsWith(".xml")) {
              const result = analyzeMyBatisXml(filePath);
              if (result.isMyBatis) {
                results.push(result);
              }
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const totalStatements = results.reduce((sum, r) => sum + r.summary.statements, 0);
      const totalWithIssues = results.reduce((sum, r) => sum + r.summary.withIssues, 0);
      const totalInjectionRisks = results.reduce((sum, r) => sum + r.summary.injectionRisks, 0);
      const totalDynamicSql = results.reduce((sum, r) => sum + r.summary.dynamicSqlCount, 0);

      const output = {
        analyzedMappers: results.length,
        totalStatements,
        statementsWithIssues: totalWithIssues,
        injectionRisks: totalInjectionRisks,
        dynamicSqlStatements: totalDynamicSql,
        mappers: results.map((r) => ({
          file: r.file,
          namespace: r.mapper?.namespace,
          resultMaps: r.mapper?.resultMaps,
          sqlFragments: r.mapper?.sqlFragments,
          mapperIssues: r.mapper?.issues,
          statements: r.mapper?.statements.map((s) => ({
            id: s.id,
            type: s.type,
            line: s.line,
            parameterType: s.parameterType,
            resultType: s.resultType || s.resultMap,
            dynamicElements: s.dynamicElements,
            issues: s.issues,
            sql: s.sql.length > 150 ? s.sql.substring(0, 150) + "..." : s.sql,
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
