import fs from "fs";
import path from "path";
import ts from "typescript";
import { Tool, ToolResult } from "./types.js";

// AST Node info interface
export interface ASTNodeInfo {
  name: string;
  kind: string;
  line: number;
  column: number;
  children?: ASTNodeInfo[];
  params?: string[];
  returnType?: string;
  modifiers?: string[];
  jsdoc?: string;
}

// Function info interface
export interface FunctionInfo {
  name: string;
  kind: "function" | "method" | "arrow" | "constructor";
  line: number;
  params: Array<{ name: string; type: string; optional: boolean }>;
  returnType: string;
  async: boolean;
  exported: boolean;
  className?: string;
  complexity: number;
  calls: string[];
}

// Class info interface
export interface ClassInfo {
  name: string;
  line: number;
  exported: boolean;
  extends?: string;
  implements: string[];
  methods: FunctionInfo[];
  properties: Array<{ name: string; type: string; visibility: string }>;
}

// File analysis result
export interface FileAnalysis {
  filepath: string;
  language: string;
  imports: Array<{ module: string; names: string[] }>;
  exports: string[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  interfaces: Array<{ name: string; line: number; properties: string[] }>;
  types: Array<{ name: string; line: number }>;
  variables: Array<{ name: string; line: number; type: string; exported: boolean }>;
  complexity: {
    total: number;
    average: number;
    highest: { name: string; value: number };
  };
}

// Calculate cyclomatic complexity
function calculateComplexity(node: ts.Node): number {
  let complexity = 1;

  function visit(n: ts.Node) {
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression: // ternary
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.DefaultClause:
        complexity++;
        break;
      case ts.SyntaxKind.BinaryExpression:
        const binary = n as ts.BinaryExpression;
        if (
          binary.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          binary.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          binary.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          complexity++;
        }
        break;
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return complexity;
}

// Extract function calls from a node
function extractCalls(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const calls: string[] = [];

  function visit(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      if (ts.isIdentifier(expr)) {
        calls.push(expr.text);
      } else if (ts.isPropertyAccessExpression(expr)) {
        calls.push(expr.name.text);
      }
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return [...new Set(calls)];
}

// Get type string from TypeNode
function getTypeString(typeNode: ts.TypeNode | undefined, sourceFile: ts.SourceFile): string {
  if (!typeNode) return "any";
  return typeNode.getText(sourceFile);
}

// Get modifiers as strings
function getModifiers(node: ts.Node): string[] {
  const modifiers: string[] = [];
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (mods) {
    for (const mod of mods) {
      modifiers.push(ts.SyntaxKind[mod.kind].replace("Keyword", "").toLowerCase());
    }
  }
  return modifiers;
}

// Analyze TypeScript/JavaScript file
function analyzeTypeScript(content: string, filepath: string): FileAnalysis {
  const sourceFile = ts.createSourceFile(
    filepath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filepath.endsWith(".tsx") || filepath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : filepath.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS
  );

  const analysis: FileAnalysis = {
    filepath,
    language: filepath.endsWith(".ts") || filepath.endsWith(".tsx") ? "typescript" : "javascript",
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    interfaces: [],
    types: [],
    variables: [],
    complexity: { total: 0, average: 0, highest: { name: "", value: 0 } },
  };

  function visit(node: ts.Node) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const lineNum = line + 1;
    const modifiers = getModifiers(node);
    const isExported = modifiers.includes("export");

    // Import declarations
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const names: string[] = [];
        const importClause = node.importClause;
        if (importClause) {
          if (importClause.name) {
            names.push(importClause.name.text);
          }
          if (importClause.namedBindings) {
            if (ts.isNamedImports(importClause.namedBindings)) {
              for (const element of importClause.namedBindings.elements) {
                names.push(element.name.text);
              }
            } else if (ts.isNamespaceImport(importClause.namedBindings)) {
              names.push(`* as ${importClause.namedBindings.name.text}`);
            }
          }
        }
        analysis.imports.push({ module: moduleSpecifier.text, names });
      }
    }

    // Export declarations
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          analysis.exports.push(element.name.text);
        }
      }
    }

    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcInfo: FunctionInfo = {
        name: node.name.text,
        kind: "function",
        line: lineNum,
        params: node.parameters.map((p) => ({
          name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sourceFile),
          type: getTypeString(p.type, sourceFile),
          optional: !!p.questionToken,
        })),
        returnType: getTypeString(node.type, sourceFile),
        async: modifiers.includes("async"),
        exported: isExported,
        complexity: calculateComplexity(node),
        calls: extractCalls(node, sourceFile),
      };
      analysis.functions.push(funcInfo);
      if (isExported) analysis.exports.push(node.name.text);
    }

    // Arrow functions in variable declarations
    if (ts.isVariableStatement(node)) {
      const isVarExported = getModifiers(node).includes("export");
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const varName = decl.name.text;

          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const func = decl.initializer;
            const funcInfo: FunctionInfo = {
              name: varName,
              kind: "arrow",
              line: lineNum,
              params: func.parameters.map((p) => ({
                name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sourceFile),
                type: getTypeString(p.type, sourceFile),
                optional: !!p.questionToken,
              })),
              returnType: getTypeString(func.type, sourceFile),
              async: !!(ts.canHaveModifiers(func) && ts.getModifiers(func)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)),
              exported: isVarExported,
              complexity: calculateComplexity(func),
              calls: extractCalls(func, sourceFile),
            };
            analysis.functions.push(funcInfo);
          } else {
            // Regular variable
            analysis.variables.push({
              name: varName,
              line: lineNum,
              type: decl.type ? getTypeString(decl.type, sourceFile) : "inferred",
              exported: isVarExported,
            });
          }

          if (isVarExported) analysis.exports.push(varName);
        }
      }
    }

    // Class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const classInfo: ClassInfo = {
        name: node.name.text,
        line: lineNum,
        exported: isExported,
        implements: [],
        methods: [],
        properties: [],
      };

      // Heritage (extends, implements)
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            classInfo.extends = clause.types[0]?.expression.getText(sourceFile);
          } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
            classInfo.implements = clause.types.map((t) => t.expression.getText(sourceFile));
          }
        }
      }

      // Class members
      for (const member of node.members) {
        const memberMods = getModifiers(member);
        const visibility = memberMods.includes("private")
          ? "private"
          : memberMods.includes("protected")
            ? "protected"
            : "public";

        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(sourceFile);
          const methodInfo: FunctionInfo = {
            name: methodName,
            kind: "method",
            line: sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1,
            params: member.parameters.map((p) => ({
              name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sourceFile),
              type: getTypeString(p.type, sourceFile),
              optional: !!p.questionToken,
            })),
            returnType: getTypeString(member.type, sourceFile),
            async: memberMods.includes("async"),
            exported: false,
            className: node.name!.text,
            complexity: calculateComplexity(member),
            calls: extractCalls(member, sourceFile),
          };
          classInfo.methods.push(methodInfo);
        } else if (ts.isConstructorDeclaration(member)) {
          const ctorInfo: FunctionInfo = {
            name: "constructor",
            kind: "constructor",
            line: sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1,
            params: member.parameters.map((p) => ({
              name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sourceFile),
              type: getTypeString(p.type, sourceFile),
              optional: !!p.questionToken,
            })),
            returnType: node.name!.text,
            async: false,
            exported: false,
            className: node.name!.text,
            complexity: calculateComplexity(member),
            calls: extractCalls(member, sourceFile),
          };
          classInfo.methods.push(ctorInfo);
        } else if (ts.isPropertyDeclaration(member) && member.name) {
          classInfo.properties.push({
            name: member.name.getText(sourceFile),
            type: getTypeString(member.type, sourceFile),
            visibility,
          });
        }
      }

      analysis.classes.push(classInfo);
      if (isExported) analysis.exports.push(node.name.text);
    }

    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const props = node.members
        .filter((m) => ts.isPropertySignature(m) && m.name)
        .map((m) => (m as ts.PropertySignature).name!.getText(sourceFile));

      analysis.interfaces.push({
        name: node.name.text,
        line: lineNum,
        properties: props,
      });
      if (isExported) analysis.exports.push(node.name.text);
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      analysis.types.push({
        name: node.name.text,
        line: lineNum,
      });
      if (isExported) analysis.exports.push(node.name.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Calculate complexity stats
  const allFuncs = [...analysis.functions, ...analysis.classes.flatMap((c) => c.methods)];
  if (allFuncs.length > 0) {
    const complexities = allFuncs.map((f) => ({ name: f.name, value: f.complexity }));
    analysis.complexity.total = complexities.reduce((sum, c) => sum + c.value, 0);
    analysis.complexity.average = Math.round(analysis.complexity.total / complexities.length * 10) / 10;
    analysis.complexity.highest = complexities.reduce(
      (max, c) => (c.value > max.value ? c : max),
      { name: "", value: 0 }
    );
  }

  // Deduplicate exports
  analysis.exports = [...new Set(analysis.exports)];

  return analysis;
}

// Format analysis as readable text
function formatAnalysis(analysis: FileAnalysis): string {
  const lines: string[] = [];

  lines.push(`=== ${path.basename(analysis.filepath)} (${analysis.language}) ===`);
  lines.push("");

  // Imports
  if (analysis.imports.length > 0) {
    lines.push("📥 Imports:");
    for (const imp of analysis.imports) {
      const names = imp.names.length > 0 ? ` { ${imp.names.join(", ")} }` : "";
      lines.push(`   ${imp.module}${names}`);
    }
    lines.push("");
  }

  // Exports
  if (analysis.exports.length > 0) {
    lines.push("📤 Exports:");
    lines.push(`   ${analysis.exports.join(", ")}`);
    lines.push("");
  }

  // Classes
  if (analysis.classes.length > 0) {
    lines.push("🏛️ Classes:");
    for (const cls of analysis.classes) {
      const ext = cls.extends ? ` extends ${cls.extends}` : "";
      const impl = cls.implements.length > 0 ? ` implements ${cls.implements.join(", ")}` : "";
      lines.push(`   L${cls.line}: ${cls.exported ? "export " : ""}class ${cls.name}${ext}${impl}`);

      for (const prop of cls.properties) {
        lines.push(`      • ${prop.visibility} ${prop.name}: ${prop.type}`);
      }
      for (const method of cls.methods) {
        const params = method.params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
        const async = method.async ? "async " : "";
        lines.push(`      → ${async}${method.name}(${params}): ${method.returnType} [복잡도: ${method.complexity}]`);
      }
    }
    lines.push("");
  }

  // Functions
  if (analysis.functions.length > 0) {
    lines.push("⚡ Functions:");
    for (const func of analysis.functions) {
      const params = func.params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
      const async = func.async ? "async " : "";
      const exp = func.exported ? "export " : "";
      const arrow = func.kind === "arrow" ? "=> " : "";
      lines.push(`   L${func.line}: ${exp}${async}${func.name}(${params}) ${arrow}: ${func.returnType}`);
      lines.push(`           복잡도: ${func.complexity} | 호출: ${func.calls.slice(0, 5).join(", ") || "(없음)"}`);
    }
    lines.push("");
  }

  // Interfaces
  if (analysis.interfaces.length > 0) {
    lines.push("📋 Interfaces:");
    for (const iface of analysis.interfaces) {
      lines.push(`   L${iface.line}: interface ${iface.name} { ${iface.properties.slice(0, 5).join(", ")}${iface.properties.length > 5 ? ", ..." : ""} }`);
    }
    lines.push("");
  }

  // Types
  if (analysis.types.length > 0) {
    lines.push("🏷️ Types:");
    for (const t of analysis.types) {
      lines.push(`   L${t.line}: type ${t.name}`);
    }
    lines.push("");
  }

  // Variables
  if (analysis.variables.length > 0) {
    lines.push("📦 Variables:");
    for (const v of analysis.variables) {
      const exp = v.exported ? "export " : "";
      lines.push(`   L${v.line}: ${exp}${v.name}: ${v.type}`);
    }
    lines.push("");
  }

  // Complexity summary
  lines.push("📊 Complexity:");
  lines.push(`   총합: ${analysis.complexity.total} | 평균: ${analysis.complexity.average}`);
  if (analysis.complexity.highest.name) {
    lines.push(`   최고: ${analysis.complexity.highest.name} (${analysis.complexity.highest.value})`);
  }

  return lines.join("\n");
}

// AST Analyze Tool
export const astAnalyzeTool: Tool = {
  name: "ast_analyze",
  description: "Deep code analysis using AST parser (AST 분석, 심층 분석). Returns functions, classes, imports, exports, complexity. More accurate than outline. Use when user asks: 'analyze code', 'deep analysis', 'complexity', 'AST', '심층 분석', '복잡도'.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to TypeScript/JavaScript file",
      },
      format: {
        type: "string",
        description: "Output format: 'text' (readable) or 'json' (structured)",
        enum: ["text", "json"],
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const format = (args.format as string) || "text";

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }

      const ext = path.extname(filepath).toLowerCase();
      if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        return {
          success: false,
          content: "",
          error: `Unsupported file type: ${ext}. Supported: .ts, .tsx, .js, .jsx, .mjs, .cjs`,
        };
      }

      const content = fs.readFileSync(filepath, "utf-8");
      const analysis = analyzeTypeScript(content, filepath);

      if (format === "json") {
        return { success: true, content: JSON.stringify(analysis, null, 2) };
      }

      return { success: true, content: formatAnalysis(analysis) };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Find function calls (call graph)
export const getCallGraphTool: Tool = {
  name: "get_call_graph",
  description: "Find what functions a file/function calls (호출 그래프, 의존성). Shows function call relationships. Use when user asks: 'what does it call', 'call graph', 'dependencies', '호출 관계', '의존성'.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to TypeScript/JavaScript file",
      },
      functionName: {
        type: "string",
        description: "Optional: specific function name to analyze",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const targetFunc = args.functionName as string | undefined;

      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }

      const content = fs.readFileSync(filepath, "utf-8");
      const analysis = analyzeTypeScript(content, filepath);

      const lines: string[] = [];
      lines.push(`=== 호출 그래프: ${path.basename(filepath)} ===`);
      lines.push("");

      const allFuncs = [...analysis.functions, ...analysis.classes.flatMap((c) => c.methods)];

      if (targetFunc) {
        const func = allFuncs.find((f) => f.name === targetFunc);
        if (!func) {
          return { success: false, content: "", error: `Function not found: ${targetFunc}` };
        }
        lines.push(`📍 ${func.name}() 호출:`);
        if (func.calls.length > 0) {
          func.calls.forEach((c) => lines.push(`   → ${c}()`));
        } else {
          lines.push("   (다른 함수 호출 없음)");
        }
      } else {
        for (const func of allFuncs) {
          const prefix = func.className ? `${func.className}.` : "";
          lines.push(`📍 ${prefix}${func.name}():`);
          if (func.calls.length > 0) {
            func.calls.forEach((c) => lines.push(`   → ${c}()`));
          } else {
            lines.push("   (다른 함수 호출 없음)");
          }
          lines.push("");
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Find references (where a symbol is used)
export const findReferencesTool: Tool = {
  name: "find_symbol_usage",
  description: "Find where a symbol (function, class, variable) is used in files (심볼 사용처 찾기). Use when user asks: 'where is X used', 'find usages', 'references', '어디서 사용', '참조'.",
  parameters: {
    type: "object",
    required: ["symbol", "pattern"],
    properties: {
      symbol: {
        type: "string",
        description: "Symbol name to find (function, class, variable)",
      },
      pattern: {
        type: "string",
        description: "Glob pattern for files to search (e.g., src/**/*.ts)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const symbol = args.symbol as string;
      const pattern = args.pattern as string;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      });

      const results: Array<{ file: string; line: number; context: string; type: string }> = [];

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) continue;

        try {
          const content = fs.readFileSync(file, "utf-8");
          const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

          function visit(node: ts.Node) {
            // Check identifiers
            if (ts.isIdentifier(node) && node.text === symbol) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              const lineText = content.split("\n")[line].trim();

              // Determine usage type
              let type = "reference";
              const parent = node.parent;
              if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
                type = "definition";
              } else if (ts.isClassDeclaration(parent)) {
                type = "definition";
              } else if (ts.isVariableDeclaration(parent) && parent.name === node) {
                type = "definition";
              } else if (ts.isCallExpression(parent) && parent.expression === node) {
                type = "call";
              } else if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) {
                type = "import";
              }

              results.push({
                file: path.relative(process.cwd(), file),
                line: line + 1,
                context: lineText.slice(0, 80),
                type,
              });
            }

            ts.forEachChild(node, visit);
          }

          visit(sourceFile);
        } catch {
          // Skip files that can't be parsed
        }
      }

      if (results.length === 0) {
        return { success: true, content: `"${symbol}" 사용처를 찾을 수 없습니다.` };
      }

      const lines: string[] = [];
      lines.push(`=== "${symbol}" 사용처 (${results.length}개) ===`);
      lines.push("");

      // Group by type
      const grouped = {
        definition: results.filter((r) => r.type === "definition"),
        import: results.filter((r) => r.type === "import"),
        call: results.filter((r) => r.type === "call"),
        reference: results.filter((r) => r.type === "reference"),
      };

      if (grouped.definition.length > 0) {
        lines.push("📍 정의:");
        grouped.definition.forEach((r) => lines.push(`   ${r.file}:${r.line} - ${r.context}`));
        lines.push("");
      }
      if (grouped.import.length > 0) {
        lines.push("📥 Import:");
        grouped.import.forEach((r) => lines.push(`   ${r.file}:${r.line}`));
        lines.push("");
      }
      if (grouped.call.length > 0) {
        lines.push("⚡ 호출:");
        grouped.call.forEach((r) => lines.push(`   ${r.file}:${r.line} - ${r.context}`));
        lines.push("");
      }
      if (grouped.reference.length > 0) {
        lines.push("🔗 참조:");
        grouped.reference.slice(0, 20).forEach((r) => lines.push(`   ${r.file}:${r.line} - ${r.context}`));
        if (grouped.reference.length > 20) {
          lines.push(`   ... 외 ${grouped.reference.length - 20}개`);
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Get complexity report
export const complexityReportTool: Tool = {
  name: "complexity_report",
  description: "Calculate code complexity for files (복잡도 분석 리포트). Shows cyclomatic complexity for all functions. Use when user asks: 'complexity', 'code quality', '복잡도', '코드 품질'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.ts)",
      },
      threshold: {
        type: "number",
        description: "Only show functions with complexity >= threshold (default: 5)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;
      const threshold = (args.threshold as number) || 5;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
      });

      const allFuncs: Array<{
        file: string;
        name: string;
        complexity: number;
        line: number;
      }> = [];

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) continue;

        try {
          const content = fs.readFileSync(file, "utf-8");
          const analysis = analyzeTypeScript(content, file);
          const funcs = [...analysis.functions, ...analysis.classes.flatMap((c) => c.methods)];

          for (const func of funcs) {
            allFuncs.push({
              file: path.relative(process.cwd(), file),
              name: func.className ? `${func.className}.${func.name}` : func.name,
              complexity: func.complexity,
              line: func.line,
            });
          }
        } catch {
          // Skip unparseable files
        }
      }

      // Sort by complexity descending
      allFuncs.sort((a, b) => b.complexity - a.complexity);

      const high = allFuncs.filter((f) => f.complexity >= threshold);
      const total = allFuncs.reduce((sum, f) => sum + f.complexity, 0);
      const avg = allFuncs.length > 0 ? Math.round(total / allFuncs.length * 10) / 10 : 0;

      const lines: string[] = [];
      lines.push(`=== 복잡도 리포트 ===`);
      lines.push("");
      lines.push(`📊 통계:`);
      lines.push(`   총 함수: ${allFuncs.length}개`);
      lines.push(`   평균 복잡도: ${avg}`);
      lines.push(`   높은 복잡도 (>= ${threshold}): ${high.length}개`);
      lines.push("");

      if (high.length > 0) {
        lines.push(`⚠️ 복잡도 높은 함수 (>= ${threshold}):`);
        for (const func of high.slice(0, 20)) {
          const bar = "█".repeat(Math.min(func.complexity, 20));
          lines.push(`   ${func.complexity.toString().padStart(2)} ${bar} ${func.name}`);
          lines.push(`      ${func.file}:${func.line}`);
        }
        if (high.length > 20) {
          lines.push(`   ... 외 ${high.length - 20}개`);
        }
      } else {
        lines.push(`✅ 복잡도 ${threshold} 이상인 함수가 없습니다.`);
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Export all AST tools
export const astTools: Tool[] = [
  astAnalyzeTool,
  getCallGraphTool,
  findReferencesTool,
  complexityReportTool,
];
