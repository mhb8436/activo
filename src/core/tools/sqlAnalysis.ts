import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface SqlQuery {
  type: "jpa" | "jdbc" | "native" | "jpql";
  query: string;
  location: string;
  line: number;
  issues: string[];
}

interface SqlAnalysisResult {
  file: string;
  queries: SqlQuery[];
  summary: {
    total: number;
    withIssues: number;
    issueTypes: Record<string, number>;
  };
}

// SQL 쿼리 추출 및 분석
function analyzeJavaForSql(filePath: string): SqlAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const queries: SqlQuery[] = [];

  // @Query 어노테이션 찾기
  const queryAnnotationRegex = /@Query\s*\(\s*(?:value\s*=\s*)?["'`]([^"'`]+)["'`]/g;
  const nativeQueryRegex = /@Query\s*\([^)]*nativeQuery\s*=\s*true[^)]*value\s*=\s*["'`]([^"'`]+)["'`]/g;
  const namedQueryRegex = /@NamedQuery\s*\([^)]*query\s*=\s*["'`]([^"'`]+)["'`]/g;

  // JDBC/JPA 문자열 쿼리 찾기
  const createQueryRegex = /(?:createQuery|createNativeQuery|prepareStatement)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const jdbcExecuteRegex = /(?:executeQuery|executeUpdate|execute)\s*\(\s*["'`]([^"'`]+)["'`]/g;

  // 문자열 변수에 할당된 SQL 찾기
  const sqlStringRegex = /(?:String\s+)?(?:sql|query|hql|jpql)\s*=\s*["'`]([^"'`]*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)[^"'`]*)["'`]/gi;

  // 멀티라인 SQL 문자열 찾기
  const multiLineSqlRegex = /["'`]\s*(SELECT|INSERT|UPDATE|DELETE)\s+[\s\S]*?["'`]\s*(?:\+\s*["'`][\s\S]*?["'`]\s*)*/gi;

  const findLineNumber = (match: RegExpExecArray): number => {
    const index = match.index;
    let lineNum = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === "\n") lineNum++;
    }
    return lineNum;
  };

  const analyzeQuery = (sql: string): string[] => {
    const issues: string[] = [];
    const upperSql = sql.toUpperCase().trim();

    // SELECT * 검사
    if (/SELECT\s+\*\s+FROM/i.test(sql)) {
      issues.push("SELECT * 사용 - 필요한 컬럼만 명시 권장");
    }

    // WHERE 절 없는 UPDATE/DELETE
    if (/^(UPDATE|DELETE)\s+/i.test(upperSql) && !/WHERE/i.test(sql)) {
      issues.push("WHERE 절 없음 - 전체 테이블 영향 위험");
    }

    // 서브쿼리 검사
    const subqueryCount = (sql.match(/\(\s*SELECT/gi) || []).length;
    if (subqueryCount >= 2) {
      issues.push(`중첩 서브쿼리 ${subqueryCount}개 - 성능 저하 가능`);
    }

    // JOIN 개수 검사
    const joinCount = (sql.match(/\bJOIN\b/gi) || []).length;
    if (joinCount >= 4) {
      issues.push(`JOIN ${joinCount}개 - 쿼리 복잡도 높음`);
    }

    // LIKE '%...' 패턴 (인덱스 미사용)
    if (/LIKE\s+['"]%/i.test(sql)) {
      issues.push("LIKE '%...' 패턴 - 인덱스 사용 불가");
    }

    // OR 조건 과다
    const orCount = (sql.match(/\bOR\b/gi) || []).length;
    if (orCount >= 3) {
      issues.push(`OR 조건 ${orCount}개 - IN 절로 변환 검토`);
    }

    // ORDER BY RAND() 검사
    if (/ORDER\s+BY\s+RAND\s*\(\)/i.test(sql)) {
      issues.push("ORDER BY RAND() - 대용량 테이블에서 성능 저하");
    }

    // N+1 가능성 힌트 (단순 ID 조회)
    if (/WHERE\s+\w+\.?id\s*=\s*[?:]/i.test(sql) && /SELECT/i.test(sql)) {
      issues.push("단일 ID 조회 - 반복 호출 시 N+1 문제 가능");
    }

    // 문자열 연결 (SQL Injection 위험)
    if (/\+\s*["']|["']\s*\+/.test(sql)) {
      issues.push("문자열 연결 감지 - SQL Injection 위험");
    }

    return issues;
  };

  // @Query 어노테이션 처리
  let match;
  while ((match = queryAnnotationRegex.exec(content)) !== null) {
    const query = match[1].replace(/\s+/g, " ").trim();
    queries.push({
      type: "jpql",
      query,
      location: "@Query",
      line: findLineNumber(match),
      issues: analyzeQuery(query),
    });
  }

  // Native Query 처리
  while ((match = nativeQueryRegex.exec(content)) !== null) {
    const query = match[1].replace(/\s+/g, " ").trim();
    queries.push({
      type: "native",
      query,
      location: "@Query(nativeQuery)",
      line: findLineNumber(match),
      issues: analyzeQuery(query),
    });
  }

  // @NamedQuery 처리
  while ((match = namedQueryRegex.exec(content)) !== null) {
    const query = match[1].replace(/\s+/g, " ").trim();
    queries.push({
      type: "jpa",
      query,
      location: "@NamedQuery",
      line: findLineNumber(match),
      issues: analyzeQuery(query),
    });
  }

  // createQuery/prepareStatement 처리
  while ((match = createQueryRegex.exec(content)) !== null) {
    const query = match[1].replace(/\s+/g, " ").trim();
    if (/SELECT|INSERT|UPDATE|DELETE/i.test(query)) {
      queries.push({
        type: "jdbc",
        query,
        location: "createQuery/prepareStatement",
        line: findLineNumber(match),
        issues: analyzeQuery(query),
      });
    }
  }

  // executeQuery 처리
  while ((match = jdbcExecuteRegex.exec(content)) !== null) {
    const query = match[1].replace(/\s+/g, " ").trim();
    if (/SELECT|INSERT|UPDATE|DELETE/i.test(query)) {
      queries.push({
        type: "jdbc",
        query,
        location: "execute*",
        line: findLineNumber(match),
        issues: analyzeQuery(query),
      });
    }
  }

  // SQL 문자열 변수 처리
  while ((match = sqlStringRegex.exec(content)) !== null) {
    const query = match[1].replace(/\s+/g, " ").trim();
    queries.push({
      type: "jdbc",
      query,
      location: "String 변수",
      line: findLineNumber(match),
      issues: analyzeQuery(query),
    });
  }

  // 이슈 통계
  const issueTypes: Record<string, number> = {};
  queries.forEach((q) => {
    q.issues.forEach((issue) => {
      const key = issue.split(" - ")[0];
      issueTypes[key] = (issueTypes[key] || 0) + 1;
    });
  });

  return {
    file: filePath,
    queries,
    summary: {
      total: queries.length,
      withIssues: queries.filter((q) => q.issues.length > 0).length,
      issueTypes,
    },
  };
}

// 도구 정의
export const sqlTools: Tool[] = [
  {
    name: "sql_check",
    description:
      "Java 파일에서 SQL 쿼리를 추출하고 품질 검사합니다. @Query, JDBC, JPA 쿼리를 분석하여 SELECT *, 인덱스 미사용 패턴, N+1 가능성 등을 검출합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 Java 파일 또는 디렉토리 경로",
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

      const results: SqlAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);

      if (stats.isFile()) {
        if (targetPath.endsWith(".java")) {
          results.push(analyzeJavaForSql(targetPath));
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
            } else if (file.endsWith(".java")) {
              const result = analyzeJavaForSql(filePath);
              if (result.queries.length > 0) {
                results.push(result);
              }
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const totalQueries = results.reduce((sum, r) => sum + r.summary.total, 0);
      const totalWithIssues = results.reduce((sum, r) => sum + r.summary.withIssues, 0);
      const allIssueTypes: Record<string, number> = {};
      results.forEach((r) => {
        Object.entries(r.summary.issueTypes).forEach(([key, count]) => {
          allIssueTypes[key] = (allIssueTypes[key] || 0) + count;
        });
      });

      const output = {
        analyzed: results.length,
        totalQueries,
        queriesWithIssues: totalWithIssues,
        issueTypes: allIssueTypes,
        files: results.map((r) => ({
          file: r.file,
          queries: r.queries.map((q) => ({
            line: q.line,
            type: q.type,
            location: q.location,
            query: q.query.length > 100 ? q.query.substring(0, 100) + "..." : q.query,
            issues: q.issues,
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
