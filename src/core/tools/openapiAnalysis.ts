import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface ApiEndpoint {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters: {
    name: string;
    in: string;
    required: boolean;
    type?: string;
  }[];
  requestBody?: {
    contentType: string;
    schema?: string;
  };
  responses: {
    status: string;
    description?: string;
  }[];
  issues: string[];
}

interface OpenApiAnalysisResult {
  file: string;
  version: string;
  info: {
    title?: string;
    version?: string;
    description?: string;
  };
  servers?: string[];
  endpoints: ApiEndpoint[];
  schemas: string[];
  securitySchemes: string[];
  issues: string[];
  summary: {
    totalEndpoints: number;
    endpointsWithIssues: number;
    totalSchemas: number;
    coverage: {
      hasSummary: number;
      hasDescription: number;
      hasOperationId: number;
      hasResponses: number;
    };
  };
}

// YAML 간단 파서 (기본적인 구조만)
function parseSimpleYaml(content: string): any {
  // JSON인 경우 바로 파싱
  if (content.trim().startsWith("{")) {
    return JSON.parse(content);
  }

  const result: any = {};
  const lines = content.split("\n");
  const stack: { indent: number; obj: any; key: string }[] = [{ indent: -1, obj: result, key: "" }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // 키-값 파싱
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim();
    let value = trimmed.substring(colonIndex + 1).trim();

    // 따옴표 제거
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 스택 조정
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (value === "" || value === "|" || value === ">") {
      // 중첩 객체
      parent[key] = {};
      stack.push({ indent, obj: parent[key], key });
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // 인라인 배열
      parent[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/['"]/g, ""));
    } else if (trimmed.startsWith("- ")) {
      // 배열 항목
      if (!Array.isArray(parent)) {
        const parentKey = stack[stack.length - 1].key;
        const grandParent = stack.length > 1 ? stack[stack.length - 2].obj : result;
        grandParent[parentKey] = [];
        stack[stack.length - 1].obj = grandParent[parentKey];
      }
      stack[stack.length - 1].obj.push(trimmed.substring(2));
    } else {
      parent[key] = value;
    }
  }

  return result;
}

// OpenAPI 스펙 분석
function analyzeOpenApiSpec(filePath: string): OpenApiAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  let spec: any;

  try {
    if (filePath.endsWith(".json")) {
      spec = JSON.parse(content);
    } else {
      spec = parseSimpleYaml(content);
    }
  } catch (e) {
    return {
      file: filePath,
      version: "unknown",
      info: {},
      endpoints: [],
      schemas: [],
      securitySchemes: [],
      issues: [`파싱 실패: ${e}`],
      summary: {
        totalEndpoints: 0,
        endpointsWithIssues: 0,
        totalSchemas: 0,
        coverage: { hasSummary: 0, hasDescription: 0, hasOperationId: 0, hasResponses: 0 },
      },
    };
  }

  const version = spec.openapi || spec.swagger || "unknown";
  const info = spec.info || {};
  const issues: string[] = [];
  const endpoints: ApiEndpoint[] = [];

  // 전역 이슈 검사
  if (!info.title) issues.push("info.title 누락");
  if (!info.version) issues.push("info.version 누락");
  if (!info.description) issues.push("info.description 누락 (API 설명 권장)");

  const servers = spec.servers?.map((s: any) => s.url || s) || [];
  if (servers.length === 0 && !spec.host) {
    issues.push("servers/host 미정의");
  }

  // paths 분석
  const paths = spec.paths || {};
  const httpMethods = ["get", "post", "put", "patch", "delete", "options", "head"];

  for (const [pathUrl, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    for (const method of httpMethods) {
      const operation = (pathItem as any)[method];
      if (!operation) continue;

      const endpointIssues: string[] = [];

      // 엔드포인트 정보 추출
      const parameters: ApiEndpoint["parameters"] = [];
      if (operation.parameters) {
        for (const param of operation.parameters) {
          parameters.push({
            name: param.name || "unknown",
            in: param.in || "query",
            required: param.required || false,
            type: param.schema?.type || param.type,
          });
        }
      }

      // 공통 파라미터
      if ((pathItem as any).parameters) {
        for (const param of (pathItem as any).parameters) {
          parameters.push({
            name: param.name || "unknown",
            in: param.in || "query",
            required: param.required || false,
            type: param.schema?.type || param.type,
          });
        }
      }

      // 요청 본문
      let requestBody: ApiEndpoint["requestBody"];
      if (operation.requestBody?.content) {
        const contentTypes = Object.keys(operation.requestBody.content);
        requestBody = {
          contentType: contentTypes[0] || "unknown",
          schema: operation.requestBody.content[contentTypes[0]]?.schema?.$ref,
        };
      }

      // 응답
      const responses: ApiEndpoint["responses"] = [];
      if (operation.responses) {
        for (const [status, response] of Object.entries(operation.responses)) {
          responses.push({
            status,
            description: (response as any)?.description,
          });
        }
      }

      // 이슈 검사
      if (!operation.summary && !operation.description) {
        endpointIssues.push("summary/description 없음");
      }
      if (!operation.operationId) {
        endpointIssues.push("operationId 없음 (코드 생성 시 필요)");
      }
      if (responses.length === 0) {
        endpointIssues.push("responses 정의 없음");
      } else {
        if (!responses.some((r) => r.status.startsWith("2"))) {
          endpointIssues.push("성공 응답(2xx) 정의 없음");
        }
        if (!responses.some((r) => r.status.startsWith("4") || r.status.startsWith("5"))) {
          endpointIssues.push("에러 응답(4xx/5xx) 정의 없음");
        }
      }

      // POST/PUT/PATCH에 requestBody 없음
      if (["post", "put", "patch"].includes(method) && !requestBody && !operation.requestBody) {
        endpointIssues.push(`${method.toUpperCase()} 요청에 requestBody 없음`);
      }

      // 경로 파라미터 검사
      const pathParams = (pathUrl.match(/\{([^}]+)\}/g) || []).map((p) => p.slice(1, -1));
      for (const pathParam of pathParams) {
        if (!parameters.some((p) => p.name === pathParam && p.in === "path")) {
          endpointIssues.push(`경로 파라미터 '${pathParam}' 정의 없음`);
        }
      }

      // 태그 없음
      if (!operation.tags || operation.tags.length === 0) {
        endpointIssues.push("tags 없음 (API 그룹화 권장)");
      }

      endpoints.push({
        path: pathUrl,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        summary: operation.summary,
        tags: operation.tags,
        parameters,
        requestBody,
        responses,
        issues: endpointIssues,
      });
    }
  }

  // 스키마 추출
  const schemas: string[] = [];
  const components = spec.components || spec.definitions || {};
  if (components.schemas) {
    schemas.push(...Object.keys(components.schemas));
  } else if (spec.definitions) {
    schemas.push(...Object.keys(spec.definitions));
  }

  // 보안 스키마 추출
  const securitySchemes: string[] = [];
  if (components.securitySchemes) {
    securitySchemes.push(...Object.keys(components.securitySchemes));
  } else if (spec.securityDefinitions) {
    securitySchemes.push(...Object.keys(spec.securityDefinitions));
  }

  if (securitySchemes.length === 0) {
    issues.push("securitySchemes 미정의 (인증 방식 정의 권장)");
  }

  // 커버리지 계산
  const coverage = {
    hasSummary: endpoints.filter((e) => e.summary).length,
    hasDescription: endpoints.filter((e) => e.summary).length, // summary로 대체
    hasOperationId: endpoints.filter((e) => e.operationId).length,
    hasResponses: endpoints.filter((e) => e.responses.length > 0).length,
  };

  return {
    file: filePath,
    version,
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    servers,
    endpoints,
    schemas,
    securitySchemes,
    issues,
    summary: {
      totalEndpoints: endpoints.length,
      endpointsWithIssues: endpoints.filter((e) => e.issues.length > 0).length,
      totalSchemas: schemas.length,
      coverage,
    },
  };
}

// 도구 정의
export const openapiTools: Tool[] = [
  {
    name: "openapi_check",
    description:
      "OpenAPI/Swagger 스펙 파일을 분석합니다. 엔드포인트, 파라미터, 응답을 추출하고 누락된 필드, 문서화 품질, 베스트 프랙티스를 검사합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 OpenAPI/Swagger 파일 또는 디렉토리 경로 (.yaml, .yml, .json)",
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

      const results: OpenApiAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);
      const apiExtensions = [".yaml", ".yml", ".json"];

      const isOpenApiFile = (filePath: string): boolean => {
        const content = fs.readFileSync(filePath, "utf-8");
        return content.includes("openapi") || content.includes("swagger") || content.includes("paths:");
      };

      const analyzeFile = (filePath: string) => {
        try {
          if (isOpenApiFile(filePath)) {
            results.push(analyzeOpenApiSpec(filePath));
          }
        } catch (e) {
          // 파싱 실패 무시
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
            } else {
              const ext = path.extname(file).toLowerCase();
              if (apiExtensions.includes(ext)) {
                analyzeFile(filePath);
              }
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const totalEndpoints = results.reduce((sum, r) => sum + r.summary.totalEndpoints, 0);
      const totalWithIssues = results.reduce((sum, r) => sum + r.summary.endpointsWithIssues, 0);

      const output = {
        analyzedFiles: results.length,
        totalEndpoints,
        endpointsWithIssues: totalWithIssues,
        specs: results.map((r) => ({
          file: r.file,
          version: r.version,
          info: r.info,
          servers: r.servers,
          schemas: r.schemas,
          securitySchemes: r.securitySchemes,
          specIssues: r.issues,
          summary: r.summary,
          endpoints: r.endpoints.map((e) => ({
            method: e.method,
            path: e.path,
            operationId: e.operationId,
            summary: e.summary,
            tags: e.tags,
            parametersCount: e.parameters.length,
            responsesCount: e.responses.length,
            issues: e.issues,
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
