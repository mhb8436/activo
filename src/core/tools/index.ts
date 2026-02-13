import { Tool, ToolCall, ToolResult } from "./types.js";
import { builtInTools } from "./builtIn.js";
import { standardsTools } from "./standards.js";
import { cacheTools } from "./cache.js";
import { astTools } from "./ast.js";
import { embeddingTools } from "./embeddings.js";
import { memoryTools } from "./memory.js";
import { javaTools } from "./javaAst.js";
import { frontendTools } from "./frontendAst.js";
import { sqlTools } from "./sqlAnalysis.js";
import { mybatisTools } from "./mybatisAnalysis.js";
import { cssTools } from "./cssAnalysis.js";
import { htmlTools } from "./htmlAnalysis.js";
import { dependencyTools } from "./dependencyAnalysis.js";
import { openapiTools } from "./openapiAnalysis.js";
import { pythonTools } from "./pythonAnalysis.js";
import { analyzeAllTools } from "./analyzeAll.js";

export * from "./types.js";
export * from "./builtIn.js";
export * from "./standards.js";
export * from "./cache.js";
export * from "./ast.js";
export * from "./embeddings.js";
export * from "./memory.js";
export * from "./javaAst.js";
export * from "./frontendAst.js";
export * from "./sqlAnalysis.js";
export * from "./mybatisAnalysis.js";
export * from "./cssAnalysis.js";
export * from "./htmlAnalysis.js";
export * from "./dependencyAnalysis.js";
export * from "./openapiAnalysis.js";
export * from "./pythonAnalysis.js";
export * from "./analyzeAll.js";

// All available tools
export function getAllTools(): Tool[] {
  return [...builtInTools, ...standardsTools, ...cacheTools, ...astTools, ...embeddingTools, ...memoryTools, ...javaTools, ...frontendTools, ...sqlTools, ...mybatisTools, ...cssTools, ...htmlTools, ...dependencyTools, ...openapiTools, ...pythonTools, ...analyzeAllTools];
}

// Get tool by name
export function getTool(name: string): Tool | undefined {
  return getAllTools().find((t) => t.name === name);
}

// Execute a tool call
export async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const tool = getTool(toolCall.name);

  if (!tool) {
    return {
      success: false,
      content: "",
      error: `Unknown tool: ${toolCall.name}`,
    };
  }

  try {
    return await tool.handler(toolCall.arguments);
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Tool execution error: ${error}`,
    };
  }
}

// Get tool definitions for LLM
export function getToolDefinitions(): Array<{
  name: string;
  description: string;
  parameters: Tool["parameters"];
}> {
  return getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

// Tool category mapping for selective loading
const TOOL_CATEGORIES: Record<string, string[]> = {
  core: ["analyze_all", "read_file", "list_directory", "grep_search", "glob_search"],
  java: ["java_analyze", "java_complexity", "spring_check"],
  frontend_js: ["ast_analyze", "get_call_graph", "find_symbol_usage", "complexity_report"],
  react: ["react_check"],
  vue: ["vue_check"],
  jquery: ["jquery_check"],
  sql: ["sql_check"],
  mybatis: ["mybatis_check"],
  css: ["css_check"],
  html: ["html_check"],
  python: ["python_check"],
  dependency: ["dependency_check"],
  openapi: ["openapi_check"],
  standards: ["import_hwp_standards", "import_pdf_standards", "index_standards", "search_standards", "check_quality_rag", "list_standards", "check_code_quality"],
  cache: ["summarize_file", "get_file_outline", "get_cached_summary", "list_cache", "clear_cache", "batch_summarize"],
  embeddings: ["index_codebase", "semantic_search", "find_similar_code", "embeddings_status", "clear_embeddings"],
  memory: ["init_project_memory", "add_key_file", "add_note", "add_fact", "save_conversation", "get_project_context", "search_memory", "clear_memory"],
  file_write: ["write_file", "run_command"],
};

// Keyword-to-category mapping
const KEYWORD_CATEGORIES: Array<{ keywords: string[]; categories: string[] }> = [
  { keywords: ["java", "spring", ".java", "controller", "service", "repository", "entity"], categories: ["java"] },
  { keywords: ["react", "jsx", "tsx", "hook", "usestate", "useeffect", "component"], categories: ["react", "frontend_js"] },
  { keywords: ["vue", ".vue", "vuex", "composition"], categories: ["vue", "frontend_js"] },
  { keywords: ["jquery", "$.", "$("], categories: ["jquery", "frontend_js"] },
  { keywords: ["javascript", "typescript", "js", "ts", "ast", "복잡도", "complexity"], categories: ["frontend_js"] },
  { keywords: ["sql", "query", "쿼리", "select", "insert", "update", "delete"], categories: ["sql"] },
  { keywords: ["mybatis", "mapper", "xml"], categories: ["mybatis"] },
  { keywords: ["css", "scss", "less", "style", "스타일"], categories: ["css"] },
  { keywords: ["html", "jsp", "접근성", "a11y", "seo"], categories: ["html"] },
  { keywords: ["python", ".py", "django", "flask", "fastapi"], categories: ["python"] },
  { keywords: ["dependency", "의존성", "package.json", "pom.xml", "gradle", "취약점"], categories: ["dependency"] },
  { keywords: ["openapi", "swagger", "api 스펙", "api spec"], categories: ["openapi"] },
  { keywords: ["표준", "standard", "hwp", "pdf", "rag", "품질기준"], categories: ["standards"] },
  { keywords: ["캐시", "cache", "요약", "summarize", "outline"], categories: ["cache"] },
  { keywords: ["임베딩", "embedding", "벡터", "vector", "semantic", "의미검색", "인덱싱"], categories: ["embeddings"] },
  { keywords: ["메모리", "memory", "컨텍스트", "context", "기억", "노트"], categories: ["memory"] },
  { keywords: ["write", "쓰기", "실행", "run", "command", "명령"], categories: ["file_write"] },
];

// Select relevant tools based on user message (max ~15 tools)
export function selectTools(userMessage: string): Tool[] {
  const msg = userMessage.toLowerCase();
  const allTools = getAllTools();
  const selectedNames = new Set<string>();

  // Always include core tools
  for (const name of TOOL_CATEGORIES.core) {
    selectedNames.add(name);
  }

  // Match keywords to categories
  for (const { keywords, categories } of KEYWORD_CATEGORIES) {
    if (keywords.some((kw) => msg.includes(kw))) {
      for (const cat of categories) {
        const names = TOOL_CATEGORIES[cat];
        if (names) {
          for (const name of names) {
            selectedNames.add(name);
          }
        }
      }
    }
  }

  // If "분석", "analyze", "check", "전체" → add analyze_all (already in core)
  // If very broad request or no specific match, add common analysis tools
  if (selectedNames.size <= TOOL_CATEGORIES.core.length) {
    // No specific category matched - add analyze_all + common ones
    for (const name of TOOL_CATEGORIES.java) selectedNames.add(name);
    for (const name of TOOL_CATEGORIES.frontend_js) selectedNames.add(name);
  }

  return allTools.filter((t) => selectedNames.has(t.name));
}
