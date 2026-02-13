import fs from "fs";
import path from "path";
import { parse, createVisitor } from "java-ast";
import { Tool, ToolResult } from "./types.js";

// Java method info
interface JavaMethodInfo {
  name: string;
  returnType: string;
  params: Array<{ name: string; type: string }>;
  modifiers: string[];
  line: number;
  annotations: string[];
  throws: string[];
  complexity: number;
}

// Java field info
interface JavaFieldInfo {
  name: string;
  type: string;
  modifiers: string[];
  line: number;
  annotations: string[];
}

// Java class info
interface JavaClassInfo {
  name: string;
  type: "class" | "interface" | "enum" | "record";
  modifiers: string[];
  line: number;
  extends?: string;
  implements: string[];
  annotations: string[];
  methods: JavaMethodInfo[];
  fields: JavaFieldInfo[];
  innerClasses: JavaClassInfo[];
}

// Quality issue
interface QualityIssue {
  type: "npe-risk" | "exception-antipattern" | "dead-code";
  severity: "error" | "warning" | "info";
  line: number;
  message: string;
  suggestion: string;
}

// Java file analysis result
interface JavaFileAnalysis {
  filepath: string;
  package: string;
  imports: string[];
  classes: JavaClassInfo[];
  issues: QualityIssue[];
  complexity: {
    total: number;
    average: number;
    highest: { name: string; value: number };
  };
}

// Calculate cyclomatic complexity from method body text
function calculateComplexity(methodText: string): number {
  let complexity = 1;

  // Count decision points
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\b\?\s*[^:]/g,  // ternary operator
    /\&\&/g,
    /\|\|/g,
  ];

  for (const pattern of patterns) {
    const matches = methodText.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

// Detect NullPointerException risk patterns
function detectNPERisks(content: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const lines = content.split("\n");

  const patterns: Array<{ regex: RegExp; message: string; suggestion: string }> = [
    {
      regex: /\.get\([^)]*\)\s*\.toString\s*\(/,
      message: ".get().toString() — null일 때 NPE 발생",
      suggestion: "Objects.toString() 또는 null 체크 후 호출",
    },
    {
      regex: /\.get\([^)]*\)\s*\.equals\s*\(/,
      message: ".get().equals() — null일 때 NPE 발생",
      suggestion: "리터럴.equals(obj) 또는 Objects.equals() 사용",
    },
    {
      regex: /\(\s*String\s*\)\s*\w+\.get\s*\(/,
      message: "(String) map.get() — null 캐스팅 시 NPE 위험",
      suggestion: "String.valueOf() 또는 Optional 사용",
    },
    {
      regex: /\.get\([^)]*\)\s*\.(length|size)\s*\(/,
      message: ".get().length()/size() — null 체이닝 NPE 위험",
      suggestion: "null 체크 후 호출 또는 Optional 사용",
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    for (const p of patterns) {
      if (p.regex.test(line)) {
        issues.push({
          type: "npe-risk",
          severity: "error",
          line: i + 1,
          message: p.message,
          suggestion: p.suggestion,
        });
      }
    }
  }

  return issues;
}

// Detect exception handling anti-patterns
function detectExceptionAntiPatterns(content: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const lines = content.split("\n");

  // 1. Empty catch blocks
  const emptyCatchRegex = /catch\s*\([^)]+\)\s*\{\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = emptyCatchRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split("\n").length;
    issues.push({
      type: "exception-antipattern",
      severity: "warning",
      line: lineNum,
      message: "빈 catch 블록 — 예외가 무시됨",
      suggestion: "최소한 로그를 남기거나 rethrow 하세요",
    });
  }

  // 2. Multi-line empty catch (catch with only whitespace)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // e.printStackTrace()
    if (line.includes(".printStackTrace()")) {
      issues.push({
        type: "exception-antipattern",
        severity: "warning",
        line: i + 1,
        message: "e.printStackTrace() 사용 — 프로덕션 부적합",
        suggestion: "Logger를 사용하세요 (LOGGER.error(\"msg\", e))",
      });
    }

    // LOGGER.info in catch block - check context
    if (/LOGGER\s*\.\s*info\s*\(/.test(line) || /log\s*\.\s*info\s*\(/i.test(line)) {
      // Look backwards to see if we're inside a catch block
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        if (/catch\s*\(/.test(lines[j])) {
          issues.push({
            type: "exception-antipattern",
            severity: "warning",
            line: i + 1,
            message: "catch 블록에서 info 레벨 로그 — error/warn 사용 권장",
            suggestion: "LOGGER.error() 또는 LOGGER.warn() 사용",
          });
          break;
        }
        if (lines[j].trim() === "}") break; // exited the block
      }
    }
  }

  // 3. Unused exception variable in catch
  const catchVarRegex = /catch\s*\(\s*\w+\s+(\w+)\s*\)/g;
  while ((match = catchVarRegex.exec(content)) !== null) {
    const varName = match[1];
    const catchStart = match.index + match[0].length;

    // Find the matching closing brace
    let braceCount = 0;
    let blockEnd = catchStart;
    for (let i = catchStart; i < content.length; i++) {
      if (content[i] === "{") braceCount++;
      if (content[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          blockEnd = i;
          break;
        }
      }
    }

    const catchBody = content.substring(catchStart, blockEnd);
    // Check if variable is referenced in catch body (exclude the declaration itself)
    const varUsageRegex = new RegExp(`\\b${varName}\\b`);
    if (!varUsageRegex.test(catchBody)) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      issues.push({
        type: "exception-antipattern",
        severity: "warning",
        line: lineNum,
        message: `catch 블록에서 예외 변수 '${varName}' 미사용`,
        suggestion: "예외 정보를 로깅하거나, 필요 없으면 변수명을 'ignored'로 변경",
      });
    }
  }

  return issues;
}

// Detect commented-out code blocks
function detectCommentedOutCode(content: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const lines = content.split("\n");
  const codeKeywords = /\b(if|else|return|public|private|protected|import|class|interface|void|int|String|new|throw|try|catch|for|while)\b/;

  let consecutiveComments: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") && !trimmed.startsWith("///") && !trimmed.startsWith("// TODO") && !trimmed.startsWith("// FIXME") && !trimmed.startsWith("// NOTE")) {
      consecutiveComments.push(i);
    } else {
      // Check if we had a block of 5+ consecutive comment lines with code keywords
      if (consecutiveComments.length >= 5) {
        const commentBlock = consecutiveComments
          .map((idx) => lines[idx].trim().substring(2).trim())
          .join("\n");
        if (codeKeywords.test(commentBlock)) {
          issues.push({
            type: "dead-code",
            severity: "info",
            line: consecutiveComments[0] + 1,
            message: `주석 처리된 코드 블록 (${consecutiveComments.length}줄, L${consecutiveComments[0] + 1}-L${consecutiveComments[consecutiveComments.length - 1] + 1})`,
            suggestion: "사용하지 않는 코드는 삭제하세요 (VCS에서 복원 가능)",
          });
        }
      }
      consecutiveComments = [];
    }
  }

  // Check trailing block
  if (consecutiveComments.length >= 5) {
    const commentBlock = consecutiveComments
      .map((idx) => lines[idx].trim().substring(2).trim())
      .join("\n");
    if (codeKeywords.test(commentBlock)) {
      issues.push({
        type: "dead-code",
        severity: "info",
        line: consecutiveComments[0] + 1,
        message: `주석 처리된 코드 블록 (${consecutiveComments.length}줄, L${consecutiveComments[0] + 1}-L${consecutiveComments[consecutiveComments.length - 1] + 1})`,
        suggestion: "사용하지 않는 코드는 삭제하세요 (VCS에서 복원 가능)",
      });
    }
  }

  return issues;
}

// Analyze Java file
function analyzeJavaFile(content: string, filepath: string): JavaFileAnalysis {
  const analysis: JavaFileAnalysis = {
    filepath,
    package: "",
    imports: [],
    classes: [],
    issues: [],
    complexity: { total: 0, average: 0, highest: { name: "", value: 0 } },
  };

  try {
    const tree = parse(content);
    const lines = content.split("\n");

    // Get line number from context
    const getLine = (ctx: any): number => {
      if (ctx && ctx.start) {
        return ctx.start.line;
      }
      return 0;
    };

    // Get text from context
    const getText = (ctx: any): string => {
      if (ctx && ctx.start && ctx.stop) {
        const startIdx = ctx.start.startIndex;
        const stopIdx = ctx.stop.stopIndex;
        return content.substring(startIdx, stopIdx + 1);
      }
      return ctx?.text || "";
    };

    // Get modifiers
    const getModifiers = (modifierCtxs: any[]): string[] => {
      if (!modifierCtxs) return [];
      return modifierCtxs.map((m) => m.text).filter((m) => m);
    };

    // Get annotations
    const getAnnotations = (modifierCtxs: any[]): string[] => {
      if (!modifierCtxs) return [];
      return modifierCtxs
        .filter((m) => m.annotation)
        .map((m) => m.annotation()?.qualifiedName()?.text || m.text)
        .filter((a) => a);
    };

    // Parse using visitor pattern
    const visitor = createVisitor({
      defaultResult: () => null,
      aggregateResult: (a, b) => b || a,

      visitPackageDeclaration: (ctx) => {
        analysis.package = ctx.qualifiedName()?.text || "";
        return null;
      },

      visitImportDeclaration: (ctx) => {
        const importText = ctx.qualifiedName()?.text || "";
        if (importText) {
          const isStatic = ctx.STATIC() ? "static " : "";
          const isWildcard = ctx.MUL() ? ".*" : "";
          analysis.imports.push(isStatic + importText + isWildcard);
        }
        return null;
      },

      visitClassDeclaration: (ctx) => {
        const classInfo: JavaClassInfo = {
          name: ctx.identifier()?.text || "Unknown",
          type: "class",
          modifiers: [],
          line: getLine(ctx),
          implements: [],
          annotations: [],
          methods: [],
          fields: [],
          innerClasses: [],
        };

        // Get parent modifiers
        const parent = ctx.parent;
        if (parent && (parent as any).classOrInterfaceModifier) {
          const mods = (parent as any).classOrInterfaceModifier();
          classInfo.modifiers = getModifiers(mods);
          classInfo.annotations = getAnnotations(mods);
        }

        // Extends
        const extendsType = ctx.typeType();
        if (extendsType) {
          classInfo.extends = extendsType.text;
        }

        // Implements
        const typeList = ctx.typeList();
        if (typeList && typeList.length > 0) {
          for (const tl of typeList) {
            const types = tl.typeType();
            if (types) {
              classInfo.implements.push(...types.map((t) => t.text));
            }
          }
        }

        // Parse class body
        const classBody = ctx.classBody();
        if (classBody) {
          const bodyDecls = classBody.classBodyDeclaration();
          for (const bodyDecl of bodyDecls) {
            const memberDecl = bodyDecl.memberDeclaration?.();
            if (!memberDecl) continue;

            // Method
            const methodDecl = memberDecl.methodDeclaration?.();
            if (methodDecl) {
              const methodInfo: JavaMethodInfo = {
                name: methodDecl.identifier()?.text || "unknown",
                returnType: methodDecl.typeTypeOrVoid()?.text || "void",
                params: [],
                modifiers: [],
                line: getLine(methodDecl),
                annotations: [],
                throws: [],
                complexity: 1,
              };

              // Get modifiers from parent
              const modCtxs = bodyDecl.modifier?.();
              if (modCtxs) {
                methodInfo.modifiers = getModifiers(modCtxs);
                methodInfo.annotations = getAnnotations(modCtxs);
              }

              // Parameters
              const formalParams = methodDecl.formalParameters()?.formalParameterList?.();
              if (formalParams) {
                const params = formalParams.formalParameter?.();
                if (params) {
                  for (const param of params) {
                    methodInfo.params.push({
                      name: param.variableDeclaratorId()?.text || "",
                      type: param.typeType()?.text || "",
                    });
                  }
                }
              }

              // Throws
              const throwsClause = methodDecl.THROWS?.();
              if (throwsClause) {
                const qualNames = methodDecl.qualifiedNameList()?.qualifiedName?.();
                if (qualNames) {
                  methodInfo.throws = qualNames.map((q) => q.text);
                }
              }

              // Complexity
              const methodBody = methodDecl.methodBody();
              if (methodBody) {
                methodInfo.complexity = calculateComplexity(getText(methodBody));
              }

              classInfo.methods.push(methodInfo);
            }

            // Constructor
            const ctorDecl = memberDecl.constructorDeclaration?.();
            if (ctorDecl) {
              const ctorInfo: JavaMethodInfo = {
                name: ctorDecl.identifier()?.text || classInfo.name,
                returnType: classInfo.name,
                params: [],
                modifiers: [],
                line: getLine(ctorDecl),
                annotations: [],
                throws: [],
                complexity: 1,
              };

              const modCtxs = bodyDecl.modifier?.();
              if (modCtxs) {
                ctorInfo.modifiers = getModifiers(modCtxs);
                ctorInfo.annotations = getAnnotations(modCtxs);
              }

              const formalParams = ctorDecl.formalParameters()?.formalParameterList?.();
              if (formalParams) {
                const params = formalParams.formalParameter?.();
                if (params) {
                  for (const param of params) {
                    ctorInfo.params.push({
                      name: param.variableDeclaratorId()?.text || "",
                      type: param.typeType()?.text || "",
                    });
                  }
                }
              }

              const ctorBody = ctorDecl.block();
              if (ctorBody) {
                ctorInfo.complexity = calculateComplexity(getText(ctorBody));
              }

              classInfo.methods.push(ctorInfo);
            }

            // Field
            const fieldDecl = memberDecl.fieldDeclaration?.();
            if (fieldDecl) {
              const varDecls = fieldDecl.variableDeclarators()?.variableDeclarator?.();
              if (varDecls) {
                for (const varDecl of varDecls) {
                  const fieldInfo: JavaFieldInfo = {
                    name: varDecl.variableDeclaratorId()?.text || "",
                    type: fieldDecl.typeType()?.text || "",
                    modifiers: [],
                    line: getLine(fieldDecl),
                    annotations: [],
                  };

                  const modCtxs = bodyDecl.modifier?.();
                  if (modCtxs) {
                    fieldInfo.modifiers = getModifiers(modCtxs);
                    fieldInfo.annotations = getAnnotations(modCtxs);
                  }

                  classInfo.fields.push(fieldInfo);
                }
              }
            }
          }
        }

        analysis.classes.push(classInfo);
        return null;
      },

      visitInterfaceDeclaration: (ctx) => {
        const interfaceInfo: JavaClassInfo = {
          name: ctx.identifier()?.text || "Unknown",
          type: "interface",
          modifiers: [],
          line: getLine(ctx),
          implements: [],
          annotations: [],
          methods: [],
          fields: [],
          innerClasses: [],
        };

        // Extends (interfaces extend other interfaces)
        const typeList = ctx.typeList();
        if (typeList && typeList.length > 0) {
          for (const tl of typeList) {
            const types = tl.typeType?.();
            if (types) {
              interfaceInfo.implements.push(...types.map((t: any) => t.text));
            }
          }
        }

        // Parse interface body
        const interfaceBody = ctx.interfaceBody();
        if (interfaceBody) {
          const bodyDecls = interfaceBody.interfaceBodyDeclaration();
          for (const bodyDecl of bodyDecls) {
            const memberDecl = bodyDecl.interfaceMemberDeclaration?.();
            if (!memberDecl) continue;

            const methodDecl = memberDecl.interfaceMethodDeclaration?.();
            if (methodDecl) {
              const commonBody = methodDecl.interfaceCommonBodyDeclaration?.();
              if (commonBody) {
                const methodInfo: JavaMethodInfo = {
                  name: commonBody.identifier()?.text || "unknown",
                  returnType: methodDecl.interfaceMethodModifier?.()?.map((m) => m.text).join(" ") || "void",
                  params: [],
                  modifiers: [],
                  line: getLine(methodDecl),
                  annotations: [],
                  throws: [],
                  complexity: 1,
                };

                interfaceInfo.methods.push(methodInfo);
              }
            }
          }
        }

        analysis.classes.push(interfaceInfo);
        return null;
      },

      visitEnumDeclaration: (ctx) => {
        const enumInfo: JavaClassInfo = {
          name: ctx.identifier()?.text || "Unknown",
          type: "enum",
          modifiers: [],
          line: getLine(ctx),
          implements: [],
          annotations: [],
          methods: [],
          fields: [],
          innerClasses: [],
        };

        // Enum constants as fields
        const enumConstants = ctx.enumConstants()?.enumConstant?.();
        if (enumConstants) {
          for (const ec of enumConstants) {
            enumInfo.fields.push({
              name: ec.identifier()?.text || "",
              type: enumInfo.name,
              modifiers: ["public", "static", "final"],
              line: getLine(ec),
              annotations: [],
            });
          }
        }

        analysis.classes.push(enumInfo);
        return null;
      },
    });

    visitor.visit(tree);

    // Calculate complexity stats
    const allMethods = analysis.classes.flatMap((c) => c.methods);
    if (allMethods.length > 0) {
      analysis.complexity.total = allMethods.reduce((sum, m) => sum + m.complexity, 0);
      analysis.complexity.average = Math.round(analysis.complexity.total / allMethods.length * 10) / 10;
      analysis.complexity.highest = allMethods.reduce(
        (max, m) => (m.complexity > max.value ? { name: m.name, value: m.complexity } : max),
        { name: "", value: 0 }
      );
    }

    // Quality issue detection
    analysis.issues.push(...detectNPERisks(content));
    analysis.issues.push(...detectExceptionAntiPatterns(content));
    analysis.issues.push(...detectCommentedOutCode(content));
  } catch (error) {
    // If parsing fails, try basic regex extraction
    const classMatch = content.match(/(?:public\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/);
    if (classMatch) {
      analysis.classes.push({
        name: classMatch[1],
        type: content.includes("interface ") ? "interface" : content.includes("enum ") ? "enum" : "class",
        modifiers: [],
        line: 1,
        implements: [],
        annotations: [],
        methods: [],
        fields: [],
        innerClasses: [],
      });
    }
  }

  return analysis;
}

// Format analysis as text
function formatJavaAnalysis(analysis: JavaFileAnalysis): string {
  const lines: string[] = [];

  lines.push(`=== ${path.basename(analysis.filepath)} ===`);
  lines.push("");

  if (analysis.package) {
    lines.push(`📦 Package: ${analysis.package}`);
    lines.push("");
  }

  if (analysis.imports.length > 0) {
    lines.push("📥 Imports:");
    // Group by prefix
    const grouped: Record<string, string[]> = {};
    for (const imp of analysis.imports) {
      const prefix = imp.split(".").slice(0, 2).join(".");
      if (!grouped[prefix]) grouped[prefix] = [];
      grouped[prefix].push(imp);
    }
    for (const [prefix, imps] of Object.entries(grouped)) {
      lines.push(`   ${prefix}.*  (${imps.length})`);
    }
    lines.push("");
  }

  for (const cls of analysis.classes) {
    const icon = cls.type === "interface" ? "📋" : cls.type === "enum" ? "🔢" : "🏛️";
    const mods = cls.modifiers.length > 0 ? cls.modifiers.join(" ") + " " : "";
    const ext = cls.extends ? ` extends ${cls.extends}` : "";
    const impl = cls.implements.length > 0 ? ` implements ${cls.implements.join(", ")}` : "";
    const annots = cls.annotations.length > 0 ? cls.annotations.map((a) => `@${a}`).join(" ") + " " : "";

    lines.push(`${icon} L${cls.line}: ${annots}${mods}${cls.type} ${cls.name}${ext}${impl}`);

    // Fields
    if (cls.fields.length > 0) {
      lines.push("   필드:");
      for (const field of cls.fields) {
        const fMods = field.modifiers.join(" ");
        const fAnnots = field.annotations.length > 0 ? field.annotations.map((a) => `@${a}`).join(" ") + " " : "";
        lines.push(`      ${fAnnots}${fMods} ${field.type} ${field.name}`);
      }
    }

    // Methods
    if (cls.methods.length > 0) {
      lines.push("   메서드:");
      for (const method of cls.methods) {
        const mMods = method.modifiers.join(" ");
        const mAnnots = method.annotations.length > 0 ? method.annotations.map((a) => `@${a}`).join(" ") + " " : "";
        const params = method.params.map((p) => `${p.type} ${p.name}`).join(", ");
        const throws = method.throws.length > 0 ? ` throws ${method.throws.join(", ")}` : "";
        lines.push(`      L${method.line}: ${mAnnots}${mMods} ${method.returnType} ${method.name}(${params})${throws}`);
        lines.push(`              복잡도: ${method.complexity}`);
      }
    }
    lines.push("");
  }

  lines.push("📊 복잡도:");
  lines.push(`   총합: ${analysis.complexity.total} | 평균: ${analysis.complexity.average}`);
  if (analysis.complexity.highest.name) {
    lines.push(`   최고: ${analysis.complexity.highest.name} (${analysis.complexity.highest.value})`);
  }

  if (analysis.issues.length > 0) {
    lines.push("");
    const severityIcon = { error: "🔴", warning: "🟡", info: "🔵" };
    lines.push(`⚠️ 이슈 (${analysis.issues.length}건):`);
    for (const issue of analysis.issues) {
      lines.push(`   ${severityIcon[issue.severity]} L${issue.line}: ${issue.message}`);
      lines.push(`      → ${issue.suggestion}`);
    }
  }

  return lines.join("\n");
}

// Java Analyze Tool
export const javaAnalyzeTool: Tool = {
  name: "java_analyze",
  description: "Analyze Java source file using AST parser (Java 분석). Returns classes, methods, fields, annotations, complexity. Use when user asks: 'analyze java', 'java 분석', 'Spring 분석'.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to Java file (.java)",
      },
      format: {
        type: "string",
        description: "Output format: 'text' or 'json'",
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

      if (!filepath.endsWith(".java")) {
        return { success: false, content: "", error: "Not a Java file (.java required)" };
      }

      const content = fs.readFileSync(filepath, "utf-8");
      const analysis = analyzeJavaFile(content, filepath);

      if (format === "json") {
        return { success: true, content: JSON.stringify(analysis, null, 2) };
      }

      return { success: true, content: formatJavaAnalysis(analysis) };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Java Complexity Report Tool
export const javaComplexityTool: Tool = {
  name: "java_complexity",
  description: "Calculate complexity for Java files (Java 복잡도 리포트). Use when user asks: 'java complexity', 'java 복잡도'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.java)",
      },
      threshold: {
        type: "number",
        description: "Only show methods with complexity >= threshold (default: 5)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;
      const threshold = (args.threshold as number) || 5;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/target/**", "**/build/**"],
      });

      const allMethods: Array<{
        file: string;
        class: string;
        method: string;
        complexity: number;
        line: number;
      }> = [];

      for (const file of files) {
        if (!file.endsWith(".java")) continue;
        try {
          const content = fs.readFileSync(file, "utf-8");
          const analysis = analyzeJavaFile(content, file);

          for (const cls of analysis.classes) {
            for (const method of cls.methods) {
              allMethods.push({
                file: path.relative(process.cwd(), file),
                class: cls.name,
                method: method.name,
                complexity: method.complexity,
                line: method.line,
              });
            }
          }
        } catch {
          // Skip unparseable files
        }
      }

      // Sort by complexity
      allMethods.sort((a, b) => b.complexity - a.complexity);

      const high = allMethods.filter((m) => m.complexity >= threshold);
      const total = allMethods.reduce((sum, m) => sum + m.complexity, 0);
      const avg = allMethods.length > 0 ? Math.round(total / allMethods.length * 10) / 10 : 0;

      const lines: string[] = [];
      lines.push("=== Java 복잡도 리포트 ===");
      lines.push("");
      lines.push("📊 통계:");
      lines.push(`   총 메서드: ${allMethods.length}개`);
      lines.push(`   평균 복잡도: ${avg}`);
      lines.push(`   높은 복잡도 (>= ${threshold}): ${high.length}개`);
      lines.push("");

      if (high.length > 0) {
        lines.push(`⚠️ 복잡도 높은 메서드 (>= ${threshold}):`);
        for (const m of high.slice(0, 20)) {
          const bar = "█".repeat(Math.min(m.complexity, 20));
          lines.push(`   ${m.complexity.toString().padStart(2)} ${bar} ${m.class}.${m.method}()`);
          lines.push(`      ${m.file}:${m.line}`);
        }
        if (high.length > 20) {
          lines.push(`   ... 외 ${high.length - 20}개`);
        }
      } else {
        lines.push(`✅ 복잡도 ${threshold} 이상인 메서드가 없습니다.`);
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Spring Pattern Check Tool
export const springCheckTool: Tool = {
  name: "spring_check",
  description: "Check Spring framework patterns (Spring 패턴 검사). Finds controllers, services, repositories, configuration. Use when user asks: 'spring check', 'spring 분석', 'Spring 패턴'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.java)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/target/**", "**/build/**"],
      });

      const springComponents = {
        controllers: [] as Array<{ file: string; class: string; mappings: string[] }>,
        services: [] as Array<{ file: string; class: string }>,
        repositories: [] as Array<{ file: string; class: string }>,
        components: [] as Array<{ file: string; class: string }>,
        configurations: [] as Array<{ file: string; class: string }>,
        entities: [] as Array<{ file: string; class: string }>,
      };

      for (const file of files) {
        if (!file.endsWith(".java")) continue;
        try {
          const content = fs.readFileSync(file, "utf-8");
          const analysis = analyzeJavaFile(content, file);
          const relativePath = path.relative(process.cwd(), file);

          for (const cls of analysis.classes) {
            const annotations = cls.annotations.map((a) => a.toLowerCase());

            // Controller
            if (annotations.some((a) => a.includes("controller") || a.includes("restcontroller"))) {
              const mappings: string[] = [];
              // Find request mappings in methods
              for (const method of cls.methods) {
                const methodAnnots = method.annotations.join(" ").toLowerCase();
                if (methodAnnots.includes("mapping")) {
                  mappings.push(`${method.name}()`);
                }
              }
              springComponents.controllers.push({ file: relativePath, class: cls.name, mappings });
            }

            // Service
            if (annotations.some((a) => a.includes("service"))) {
              springComponents.services.push({ file: relativePath, class: cls.name });
            }

            // Repository
            if (annotations.some((a) => a.includes("repository"))) {
              springComponents.repositories.push({ file: relativePath, class: cls.name });
            }

            // Component
            if (annotations.some((a) => a === "component")) {
              springComponents.components.push({ file: relativePath, class: cls.name });
            }

            // Configuration
            if (annotations.some((a) => a.includes("configuration"))) {
              springComponents.configurations.push({ file: relativePath, class: cls.name });
            }

            // Entity
            if (annotations.some((a) => a.includes("entity") || a.includes("table"))) {
              springComponents.entities.push({ file: relativePath, class: cls.name });
            }
          }
        } catch {
          // Skip unparseable files
        }
      }

      const lines: string[] = [];
      lines.push("=== Spring 패턴 분석 ===");
      lines.push("");

      if (springComponents.controllers.length > 0) {
        lines.push(`🎮 Controllers (${springComponents.controllers.length}):`);
        for (const c of springComponents.controllers) {
          lines.push(`   ${c.class}`);
          lines.push(`      ${c.file}`);
          if (c.mappings.length > 0) {
            lines.push(`      엔드포인트: ${c.mappings.join(", ")}`);
          }
        }
        lines.push("");
      }

      if (springComponents.services.length > 0) {
        lines.push(`⚙️ Services (${springComponents.services.length}):`);
        for (const s of springComponents.services) {
          lines.push(`   ${s.class} - ${s.file}`);
        }
        lines.push("");
      }

      if (springComponents.repositories.length > 0) {
        lines.push(`🗄️ Repositories (${springComponents.repositories.length}):`);
        for (const r of springComponents.repositories) {
          lines.push(`   ${r.class} - ${r.file}`);
        }
        lines.push("");
      }

      if (springComponents.entities.length > 0) {
        lines.push(`📋 Entities (${springComponents.entities.length}):`);
        for (const e of springComponents.entities) {
          lines.push(`   ${e.class} - ${e.file}`);
        }
        lines.push("");
      }

      if (springComponents.configurations.length > 0) {
        lines.push(`🔧 Configurations (${springComponents.configurations.length}):`);
        for (const c of springComponents.configurations) {
          lines.push(`   ${c.class} - ${c.file}`);
        }
        lines.push("");
      }

      if (springComponents.components.length > 0) {
        lines.push(`📦 Components (${springComponents.components.length}):`);
        for (const c of springComponents.components) {
          lines.push(`   ${c.class} - ${c.file}`);
        }
        lines.push("");
      }

      const total = Object.values(springComponents).reduce((sum, arr) => sum + arr.length, 0);
      if (total === 0) {
        lines.push("Spring 컴포넌트를 찾지 못했습니다.");
      } else {
        lines.push(`📊 총 ${total}개 Spring 컴포넌트 발견`);
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Export all Java tools
export const javaTools: Tool[] = [
  javaAnalyzeTool,
  javaComplexityTool,
  springCheckTool,
];
