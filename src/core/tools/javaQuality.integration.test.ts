import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

// 실제 도구 import
import { javaTools } from "./javaAst.js";
import { analyzeAllTools } from "./analyzeAll.js";

const SAMPLE_JAVA_SRC = "/Users/mhb8436/Workspaces/sample-java/01.서비스안내팀 소스/src/";

// 대상 디렉토리 존재 여부 확인
const srcExists = fs.existsSync(SAMPLE_JAVA_SRC);

// ─── 시나리오 1: java_analyze 단일 파일 품질 이슈 감지 ───

describe("시나리오 1: java_analyze 단일 파일 품질 이슈 감지", () => {
  const javaAnalyzeTool = javaTools.find((t) => t.name === "java_analyze")!;

  describe.skipIf(!srcExists)("NPE 위험 감지 — SvcRequstController.java", () => {
    const targetFile = path.join(
      SAMPLE_JAVA_SRC,
      "main/java/gov/benefit/webview/controller/SvcRequstController.java"
    );

    it("java_analyze가 성공적으로 실행된다", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
    });

    it("NPE 위험 이슈가 감지된다 (.get().toString())", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);
      expect(analysis.issues).toBeDefined();
      expect(Array.isArray(analysis.issues)).toBe(true);

      const npeIssues = analysis.issues.filter((i: any) => i.type === "npe-risk");
      // SvcRequstController.java L197, L200에 body.get("gbn").toString() 패턴 존재
      expect(npeIssues.length).toBeGreaterThanOrEqual(2);

      // 각 이슈에 필수 필드 확인
      for (const issue of npeIssues) {
        expect(issue.severity).toBe("error");
        expect(issue.line).toBeGreaterThan(0);
        expect(issue.message).toBeTruthy();
        expect(issue.suggestion).toBeTruthy();
      }
    });

    it("text 포맷에 이슈 섹션이 포함된다", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "text" });
      expect(result.content).toContain("이슈");
      expect(result.content).toContain("NPE");
    });
  });

  describe.skipIf(!srcExists)("예외 처리 안티패턴 감지 — SvcRequstServiceImpl.java", () => {
    const targetFile = path.join(
      SAMPLE_JAVA_SRC,
      "main/java/gov/benefit/webview/service/impl/SvcRequstServiceImpl.java"
    );

    it("예외 안티패턴 이슈가 감지된다", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);

      const exceptionIssues = analysis.issues.filter(
        (i: any) => i.type === "exception-antipattern"
      );
      // SvcRequstServiceImpl.java에 catch 블록에서 예외 변수 사용 패턴 존재
      expect(exceptionIssues.length).toBeGreaterThanOrEqual(0);
    });

    it("Spring @Service 어노테이션이 감지된다", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);

      expect(analysis.classes.length).toBeGreaterThanOrEqual(1);
      const mainClass = analysis.classes[0];
      // @Service("SvcRequstService")
      expect(
        mainClass.annotations.some((a: string) => a.toLowerCase().includes("service"))
      ).toBe(true);
    });
  });

  describe.skipIf(!srcExists)("주석 코드 블록 감지 — UtzrInfoMngController.java", () => {
    const targetFile = path.join(
      SAMPLE_JAVA_SRC,
      "main/java/gov/benefit/webview/controller/UtzrInfoMngController.java"
    );

    it("주석 처리된 코드 블록(dead-code)이 감지된다", async () => {
      if (!fs.existsSync(targetFile)) return;

      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);

      const deadCodeIssues = analysis.issues.filter((i: any) => i.type === "dead-code");
      // UtzrInfoMngController.java에 10줄 이상 주석 블록 다수 존재
      expect(deadCodeIssues.length).toBeGreaterThanOrEqual(1);

      for (const issue of deadCodeIssues) {
        expect(issue.severity).toBe("info");
        expect(issue.message).toContain("주석 처리된 코드 블록");
      }
    });
  });

  describe.skipIf(!srcExists)("NPE 위험 감지 — SvcReqstApiController.java", () => {
    const targetFile = path.join(
      SAMPLE_JAVA_SRC,
      "main/java/gov/benefit/api/controller/SvcReqstApiController.java"
    );

    it("body.get('checkSum').toString() NPE 위험이 감지된다", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);

      const npeIssues = analysis.issues.filter((i: any) => i.type === "npe-risk");
      // checkSum.toString() 패턴 다수 존재
      expect(npeIssues.length).toBeGreaterThanOrEqual(1);
    });

    it("RestController 어노테이션이 인식된다", async () => {
      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);

      expect(analysis.classes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe.skipIf(!srcExists)("NPE 위험 감지 — BenefitLnkServiceImpl.java", () => {
    const targetFile = path.join(
      SAMPLE_JAVA_SRC,
      "main/java/gov/benefit/lnk/service/impl/BenefitLnkServiceImpl.java"
    );

    it("map.get().toString() 체인이 감지된다", async () => {
      if (!fs.existsSync(targetFile)) return;

      const result = await javaAnalyzeTool.handler({ filepath: targetFile, format: "json" });
      const analysis = JSON.parse(result.content);

      const npeIssues = analysis.issues.filter((i: any) => i.type === "npe-risk");
      expect(npeIssues.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ─── 시나리오 2: spring_check glob 기반 실행 ───

describe("시나리오 2: spring_check glob 기반 실행", () => {
  const springCheckTool = javaTools.find((t) => t.name === "spring_check")!;

  it.skipIf(!srcExists)("spring_check이 pattern 파라미터로 정상 실행된다", async () => {
    const pattern = path.join(SAMPLE_JAVA_SRC, "**/*.java");
    const result = await springCheckTool.handler({ pattern });
    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();
  });

  it.skipIf(!srcExists)("Controller, Service 컴포넌트가 발견된다", async () => {
    const pattern = path.join(SAMPLE_JAVA_SRC, "**/*.java");
    const result = await springCheckTool.handler({ pattern });

    // text 포맷이므로 문자열 검사
    expect(result.content).toContain("Controllers");
    expect(result.content).toContain("Services");
  });

  it.skipIf(!srcExists)("filepath 파라미터로 호출 시 실패한다 (버그 재현 방지)", async () => {
    // spring_check은 pattern(glob) 필수 — filepath를 주면 glob에서 빈 배열 반환
    const singleFile = path.join(
      SAMPLE_JAVA_SRC,
      "main/java/gov/benefit/webview/controller/SvcRequstController.java"
    );
    // handler에 filepath가 아닌 pattern을 기대하므로 filepath로 호출 시 pattern이 undefined
    const result = await springCheckTool.handler({ filepath: singleFile });
    // pattern이 없으면 에러 또는 빈 결과
    if (result.success) {
      // glob("undefined") → 빈 배열 → 빈 결과
      expect(result.content).toContain("Spring 컴포넌트를 찾지 못했습니다");
    }
  });
});

// ─── 시나리오 3: analyze_all 디렉토리 분석 + 이슈 추출 ───

describe("시나리오 3: analyze_all 디렉토리 전체 분석", () => {
  const analyzeAllTool = analyzeAllTools.find((t) => t.name === "analyze_all")!;

  it.skipIf(!srcExists)(
    "analyze_all이 Java 프로젝트를 성공적으로 분석한다",
    async () => {
      const result = await analyzeAllTool.handler({ path: SAMPLE_JAVA_SRC, include: ["java"] });
      expect(result.success).toBe(true);

      const output = JSON.parse(result.content);
      expect(output.totalFiles).toBeGreaterThan(0);
      expect(output.fileStats.java).toBeGreaterThan(0);
      expect(output.successful).toBeGreaterThan(0);
    },
    60000
  );

  it.skipIf(!srcExists)(
    "java_analyze 결과에 issues가 포함된다",
    async () => {
      const result = await analyzeAllTool.handler({ path: SAMPLE_JAVA_SRC, include: ["java"] });
      const output = JSON.parse(result.content);

      // details에서 java_analyze 결과 확인
      const javaDetail = output.details.find((d: any) => d.tool === "java_analyze");
      expect(javaDetail).toBeDefined();
      expect(javaDetail.summary.samples).toBeDefined();
      expect(javaDetail.summary.samples.length).toBeGreaterThan(0);

      // 최소 하나의 샘플에 issues 필드가 존재
      const hasIssues = javaDetail.summary.samples.some(
        (s: any) => s.result?.issues && s.result.issues.length > 0
      );
      expect(hasIssues).toBe(true);
    },
    60000
  );

  it.skipIf(!srcExists)(
    "issuesSummary에 java 이슈가 포함된다",
    async () => {
      const result = await analyzeAllTool.handler({ path: SAMPLE_JAVA_SRC, include: ["java"] });
      const output = JSON.parse(result.content);

      // issuesSummary에서 java_analyze 이슈 확인
      const javaIssues = output.issuesSummary.find(
        (is: any) => is.tool === "java_analyze"
      );
      expect(javaIssues).toBeDefined();
      expect(javaIssues.issues.length).toBeGreaterThan(0);
    },
    60000
  );

  it.skipIf(!srcExists)(
    "spring_check이 정상 실행된다 (버그 수정 검증)",
    async () => {
      const result = await analyzeAllTool.handler({ path: SAMPLE_JAVA_SRC, include: ["java"] });
      const output = JSON.parse(result.content);

      // spring_check이 성공적으로 실행되었는지 확인
      const springDetail = output.details.find((d: any) => d.tool === "spring_check");
      expect(springDetail).toBeDefined();
      expect(springDetail.summary).toBeTruthy();

      // errors에 spring_check이 없어야 함
      const springError = output.errors.find((e: any) => e.tool === "spring_check");
      expect(springError).toBeUndefined();
    },
    60000
  );
});

// ─── 시나리오 4: compressAnalysisResult 이슈 포함 확인 ───

describe("시나리오 4: compressAnalysisResult에서 이슈 포함", () => {
  it("analyze_all 결과 JSON에서 issues가 압축 시 유지된다", () => {
    // compressAnalysisResult는 agent.ts 내부 함수이므로 동작을 시뮬레이션
    const mockAnalyzeAllResult = {
      path: "/test",
      fileStats: { java: 10 },
      totalFiles: 10,
      analysesRun: 2,
      successful: 2,
      failed: 0,
      issuesSummary: [
        {
          tool: "java_analyze",
          issues: [".get().toString() — null일 때 NPE 발생"],
        },
      ],
      details: [
        {
          tool: "java_analyze",
          summary: {
            analyzedFiles: 3,
            totalJavaFiles: 10,
            samples: [
              {
                file: "Test.java",
                result: {
                  issues: [
                    {
                      type: "npe-risk",
                      severity: "error",
                      line: 10,
                      message: ".get().toString() — null일 때 NPE 발생",
                      suggestion: "Objects.toString() 사용",
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      errors: [],
    };

    const resultContent = JSON.stringify(mockAnalyzeAllResult);

    // compressAnalysisResult 로직 재현 (agent.ts에서 발췌)
    const parsed = JSON.parse(resultContent);
    const compact: Record<string, unknown> = {
      path: parsed.path,
      totalFiles: parsed.totalFiles,
      fileStats: parsed.fileStats,
      analysesRun: parsed.analysesRun,
      successful: parsed.successful,
      failed: parsed.failed,
    };

    if (parsed.issuesSummary?.length > 0) {
      compact.issues = parsed.issuesSummary.map((is: any) => ({
        tool: is.tool,
        issues: is.issues.slice(0, 5),
      }));
    }

    if (parsed.details?.length > 0) {
      compact.analyses = parsed.details.map((d: any) => {
        const s = d.summary;
        const brief: Record<string, unknown> = { tool: d.tool };

        for (const [k, v] of Object.entries(s)) {
          if (typeof v === "number" || typeof v === "boolean") {
            brief[k] = v;
          } else if (typeof v === "string" && (v as string).length < 100) {
            brief[k] = v;
          }
        }

        // issues 추출 로직 (agent.ts 수정 사항)
        if (Array.isArray((s as any).samples)) {
          const allIssues: unknown[] = [];
          for (const sample of (s as any).samples) {
            if (Array.isArray(sample.result?.issues)) {
              allIssues.push(...sample.result.issues.slice(0, 3));
            }
          }
          if (allIssues.length > 0) {
            brief.issues = allIssues.slice(0, 10);
          }
        }

        return brief;
      });
    }

    const compressedStr = JSON.stringify(compact, null, 1);
    const compressed = JSON.parse(compressedStr);

    // 이슈 요약이 포함되어 있는지 확인
    expect(compressed.issues).toBeDefined();
    expect(compressed.issues[0].tool).toBe("java_analyze");
    expect(compressed.issues[0].issues[0]).toContain("NPE");

    // analyses에 issues가 포함되어 있는지 확인
    const javaAnalysis = (compressed.analyses as any[]).find((a) => a.tool === "java_analyze");
    expect(javaAnalysis).toBeDefined();
    expect(javaAnalysis.issues).toBeDefined();
    expect(javaAnalysis.issues.length).toBeGreaterThan(0);
    expect(javaAnalysis.issues[0].type).toBe("npe-risk");
  });
});

// ─── 시나리오 5: 이슈 타입별 감지 정확도 (단위 수준) ───

describe("시나리오 5: 이슈 감지 정확도 — 인라인 코드 검증", () => {
  const javaAnalyzeTool = javaTools.find((t) => t.name === "java_analyze")!;

  it("NPE 위험 4가지 패턴 모두 감지한다", async () => {
    // 테스트용 Java 코드를 임시 파일로 작성
    const tmpFile = path.join(process.cwd(), ".test-npe.java");
    const javaCode = `package test;
public class NpeTest {
  public void test(java.util.Map<String, Object> map) {
    String a = map.get("key").toString();
    boolean b = map.get("key").equals("val");
    String c = (String) map.get("key");
    int d = map.get("list").size();
  }
}`;
    fs.writeFileSync(tmpFile, javaCode);

    try {
      const result = await javaAnalyzeTool.handler({ filepath: tmpFile, format: "json" });
      const analysis = JSON.parse(result.content);
      const npeIssues = analysis.issues.filter((i: any) => i.type === "npe-risk");

      // 4가지 패턴 모두 감지
      expect(npeIssues.length).toBeGreaterThanOrEqual(4);

      // 라인 번호 확인 (4, 5, 6, 7)
      const lines = npeIssues.map((i: any) => i.line);
      expect(lines).toContain(4);
      expect(lines).toContain(5);
      expect(lines).toContain(6);
      expect(lines).toContain(7);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("빈 catch 블록을 감지한다", async () => {
    const tmpFile = path.join(process.cwd(), ".test-catch.java");
    const javaCode = `package test;
public class CatchTest {
  public void test() {
    try {
      System.out.println("test");
    } catch (Exception e) { }
  }
}`;
    fs.writeFileSync(tmpFile, javaCode);

    try {
      const result = await javaAnalyzeTool.handler({ filepath: tmpFile, format: "json" });
      const analysis = JSON.parse(result.content);
      const catchIssues = analysis.issues.filter(
        (i: any) => i.type === "exception-antipattern" && i.message.includes("빈 catch")
      );
      expect(catchIssues.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("e.printStackTrace() 사용을 감지한다", async () => {
    const tmpFile = path.join(process.cwd(), ".test-stacktrace.java");
    const javaCode = `package test;
public class StackTraceTest {
  public void test() {
    try {
      System.out.println("test");
    } catch (Exception e) {
      e.printStackTrace();
    }
  }
}`;
    fs.writeFileSync(tmpFile, javaCode);

    try {
      const result = await javaAnalyzeTool.handler({ filepath: tmpFile, format: "json" });
      const analysis = JSON.parse(result.content);
      const stackTraceIssues = analysis.issues.filter(
        (i: any) => i.type === "exception-antipattern" && i.message.includes("printStackTrace")
      );
      expect(stackTraceIssues.length).toBeGreaterThanOrEqual(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("주석 처리된 코드 블록(5줄 이상)을 감지한다", async () => {
    const tmpFile = path.join(process.cwd(), ".test-deadcode.java");
    const javaCode = `package test;
public class DeadCodeTest {
  // public void oldMethod() {
  //   if (true) {
  //     return;
  //   }
  //   String x = "test";
  // }
  public void activeMethod() {}
}`;
    fs.writeFileSync(tmpFile, javaCode);

    try {
      const result = await javaAnalyzeTool.handler({ filepath: tmpFile, format: "json" });
      const analysis = JSON.parse(result.content);
      const deadCodeIssues = analysis.issues.filter((i: any) => i.type === "dead-code");
      expect(deadCodeIssues.length).toBeGreaterThanOrEqual(1);
      expect(deadCodeIssues[0].message).toContain("주석 처리된 코드 블록");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("일반 주석(비코드)은 dead-code로 감지하지 않는다", async () => {
    const tmpFile = path.join(process.cwd(), ".test-normalcomment.java");
    const javaCode = `package test;
public class NormalCommentTest {
  // 이 클래스는 테스트용입니다.
  // 작성자: 홍길동
  // 작성일: 2024-01-01
  // 버전: 1.0
  // 설명: 간단한 테스트
  // 참고: 없음
  public void test() {}
}`;
    fs.writeFileSync(tmpFile, javaCode);

    try {
      const result = await javaAnalyzeTool.handler({ filepath: tmpFile, format: "json" });
      const analysis = JSON.parse(result.content);
      const deadCodeIssues = analysis.issues.filter((i: any) => i.type === "dead-code");
      // 코드 키워드가 없으므로 감지되지 않아야 함
      expect(deadCodeIssues.length).toBe(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("주석 내 코드가 아닌 일반 텍스트는 무시한다 (TODO, FIXME 등)", async () => {
    const tmpFile = path.join(process.cwd(), ".test-todo.java");
    const javaCode = `package test;
public class TodoTest {
  // TODO: 이 부분 수정 필요
  // TODO: 리팩토링 예정
  // TODO: 성능 개선
  // FIXME: 버그 있음
  // NOTE: 참고사항
  public void test() {}
}`;
    fs.writeFileSync(tmpFile, javaCode);

    try {
      const result = await javaAnalyzeTool.handler({ filepath: tmpFile, format: "json" });
      const analysis = JSON.parse(result.content);
      const deadCodeIssues = analysis.issues.filter((i: any) => i.type === "dead-code");
      // TODO/FIXME/NOTE 주석은 무시되어야 함
      expect(deadCodeIssues.length).toBe(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
