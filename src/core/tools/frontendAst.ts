import fs from "fs";
import path from "path";
import ts from "typescript";
import { Tool, ToolResult } from "./types.js";

// React component info
interface ReactComponentInfo {
  name: string;
  type: "function" | "class" | "arrow";
  filepath: string;
  line: number;
  props: string[];
  hooks: string[];
  stateVariables: string[];
  effects: number;
  memoized: boolean;
  issues: string[];
}

// Vue component info
interface VueComponentInfo {
  name: string;
  filepath: string;
  type: "options" | "composition" | "script-setup";
  props: string[];
  emits: string[];
  data: string[];
  computed: string[];
  methods: string[];
  watchers: string[];
  lifecycle: string[];
  composables: string[];
  issues: string[];
}

// jQuery usage info
interface JQueryUsageInfo {
  filepath: string;
  selectors: Array<{ selector: string; line: number }>;
  events: Array<{ event: string; line: number }>;
  ajax: Array<{ method: string; line: number }>;
  deprecated: Array<{ method: string; line: number; suggestion: string }>;
  domManipulations: number;
  issues: string[];
}

// Deprecated jQuery methods
const DEPRECATED_JQUERY: Record<string, string> = {
  ".bind(": "Use .on() instead",
  ".unbind(": "Use .off() instead",
  ".delegate(": "Use .on() instead",
  ".undelegate(": "Use .off() instead",
  ".live(": "Use .on() instead",
  ".die(": "Use .off() instead",
  ".load(": "Use .on('load', ...) instead",
  ".unload(": "Use .on('unload', ...) instead",
  ".error(": "Use .on('error', ...) instead",
  ".size(": "Use .length instead",
  ".andSelf(": "Use .addBack() instead",
  ".toggle(": "Use .on('click', ...) with state instead",
  "$.browser": "Use feature detection instead",
  "$.sub(": "Removed in jQuery 1.9",
  "$.isArray(": "Use Array.isArray() instead",
  "$.parseJSON(": "Use JSON.parse() instead",
  "$.trim(": "Use String.trim() instead",
  "$.now()": "Use Date.now() instead",
};

// React hooks list
const REACT_HOOKS = [
  "useState",
  "useEffect",
  "useContext",
  "useReducer",
  "useCallback",
  "useMemo",
  "useRef",
  "useImperativeHandle",
  "useLayoutEffect",
  "useDebugValue",
  "useDeferredValue",
  "useTransition",
  "useId",
  "useSyncExternalStore",
  "useInsertionEffect",
];

// Analyze React component
function analyzeReactFile(content: string, filepath: string): ReactComponentInfo[] {
  const components: ReactComponentInfo[] = [];
  const lines = content.split("\n");

  try {
    const sourceFile = ts.createSourceFile(
      filepath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filepath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
    );

    function visit(node: ts.Node) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      // Function component
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        if (/^[A-Z]/.test(name)) {
          const component = analyzeReactComponent(node, name, "function", line, content, filepath);
          if (component) components.push(component);
        }
      }

      // Arrow function component
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            const name = decl.name.text;
            if (/^[A-Z]/.test(name)) {
              if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
                const component = analyzeReactComponent(decl.initializer, name, "arrow", line, content, filepath);
                if (component) components.push(component);
              }
              // Check for React.memo, React.forwardRef
              if (ts.isCallExpression(decl.initializer)) {
                const expr = decl.initializer.expression;
                if (ts.isPropertyAccessExpression(expr)) {
                  const methodName = expr.name.text;
                  if (["memo", "forwardRef"].includes(methodName)) {
                    const arg = decl.initializer.arguments[0];
                    if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
                      const component = analyzeReactComponent(arg, name, "arrow", line, content, filepath);
                      if (component) {
                        component.memoized = methodName === "memo";
                        components.push(component);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Class component
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        // Check if extends React.Component or Component
        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            const extendsText = clause.types.map((t) => t.expression.getText(sourceFile)).join(", ");
            if (extendsText.includes("Component") || extendsText.includes("PureComponent")) {
              const component: ReactComponentInfo = {
                name,
                type: "class",
                filepath,
                line,
                props: [],
                hooks: [],
                stateVariables: [],
                effects: 0,
                memoized: extendsText.includes("PureComponent"),
                issues: ["Class components are legacy - consider converting to function components"],
              };
              components.push(component);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  } catch {
    // Fallback to regex
    const componentRegex = /(?:function|const|let|var)\s+([A-Z]\w+)\s*[=:]\s*(?:\([^)]*\)|[^=])*=>/g;
    let match;
    while ((match = componentRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split("\n").length;
      components.push({
        name: match[1],
        type: "arrow",
        filepath,
        line,
        props: [],
        hooks: [],
        stateVariables: [],
        effects: 0,
        memoized: false,
        issues: [],
      });
    }
  }

  return components;
}

// Analyze a React component node
function analyzeReactComponent(
  node: ts.Node,
  name: string,
  type: "function" | "arrow",
  line: number,
  content: string,
  filepath: string
): ReactComponentInfo | null {
  const component: ReactComponentInfo = {
    name,
    type,
    filepath,
    line,
    props: [],
    hooks: [],
    stateVariables: [],
    effects: 0,
    memoized: false,
    issues: [],
  };

  const nodeText = node.getText();

  // Find hooks
  for (const hook of REACT_HOOKS) {
    const hookRegex = new RegExp(`\\b${hook}\\s*\\(`, "g");
    const matches = nodeText.match(hookRegex);
    if (matches) {
      component.hooks.push(`${hook} (${matches.length})`);
      if (hook === "useEffect" || hook === "useLayoutEffect") {
        component.effects += matches.length;
      }
    }
  }

  // Find useState variables
  const useStateRegex = /const\s+\[(\w+),\s*set\w+\]\s*=\s*useState/g;
  let match;
  while ((match = useStateRegex.exec(nodeText)) !== null) {
    component.stateVariables.push(match[1]);
  }

  // Check for issues
  // 1. Missing dependency array in useEffect
  const effectWithoutDeps = /useEffect\s*\(\s*\([^)]*\)\s*=>\s*\{[^}]+\}\s*\)/g;
  if (effectWithoutDeps.test(nodeText)) {
    component.issues.push("useEffect without dependency array - may cause infinite loops");
  }

  // 2. Too many state variables
  if (component.stateVariables.length > 5) {
    component.issues.push(`Too many useState (${component.stateVariables.length}) - consider useReducer`);
  }

  // 3. Too many effects
  if (component.effects > 3) {
    component.issues.push(`Too many useEffect (${component.effects}) - consider splitting component`);
  }

  // 4. Check for inline function in JSX (performance issue)
  const inlineHandler = /on\w+\s*=\s*\{\s*\([^)]*\)\s*=>/g;
  if (inlineHandler.test(nodeText)) {
    component.issues.push("Inline arrow functions in JSX props - consider useCallback");
  }

  return component;
}

// Analyze Vue file
function analyzeVueFile(content: string, filepath: string): VueComponentInfo {
  const component: VueComponentInfo = {
    name: path.basename(filepath, path.extname(filepath)),
    filepath,
    type: "options",
    props: [],
    emits: [],
    data: [],
    computed: [],
    methods: [],
    watchers: [],
    lifecycle: [],
    composables: [],
    issues: [],
  };

  // Check for script setup (Composition API with <script setup>)
  if (/<script\s+setup/.test(content)) {
    component.type = "script-setup";

    // Find defineProps
    const propsMatch = content.match(/defineProps\s*[<(]([^>)]+)[>)]/);
    if (propsMatch) {
      const propsContent = propsMatch[1];
      const propNames = propsContent.match(/\w+(?=\s*[?:])/g);
      if (propNames) component.props = propNames;
    }

    // Find defineEmits
    const emitsMatch = content.match(/defineEmits\s*[<(]([^>)]+)[>)]/);
    if (emitsMatch) {
      const emitsContent = emitsMatch[1];
      const emitNames = emitsContent.match(/['"](\w+)['"]/g);
      if (emitNames) component.emits = emitNames.map((e) => e.replace(/['"]/g, ""));
    }

    // Find composables (useXxx)
    const composableRegex = /\buse[A-Z]\w+\s*\(/g;
    const composables = content.match(composableRegex);
    if (composables) {
      component.composables = [...new Set(composables.map((c) => c.replace("(", "")))];
    }

    // Find refs and reactives
    const refRegex = /(?:const|let)\s+(\w+)\s*=\s*(?:ref|reactive|computed)\s*\(/g;
    let match;
    while ((match = refRegex.exec(content)) !== null) {
      component.data.push(match[1]);
    }
  }
  // Check for Composition API (setup function)
  else if (/setup\s*\(\s*(?:props|[^)]*)\s*\)\s*\{/.test(content)) {
    component.type = "composition";

    // Find return object properties
    const returnMatch = content.match(/return\s*\{([^}]+)\}/);
    if (returnMatch) {
      const returnContent = returnMatch[1];
      const names = returnContent.match(/\w+(?=\s*[,}])/g);
      if (names) component.methods = names;
    }
  }
  // Options API
  else {
    component.type = "options";

    // Props
    const propsMatch = content.match(/props\s*:\s*\[([^\]]+)\]/);
    if (propsMatch) {
      component.props = propsMatch[1].match(/['"](\w+)['"]/g)?.map((p) => p.replace(/['"]/g, "")) || [];
    }
    const propsObjMatch = content.match(/props\s*:\s*\{([^}]+)\}/);
    if (propsObjMatch) {
      const propNames = propsObjMatch[1].match(/(\w+)\s*:/g);
      if (propNames) component.props = propNames.map((p) => p.replace(":", "").trim());
    }

    // Data
    const dataMatch = content.match(/data\s*\(\s*\)\s*\{[^}]*return\s*\{([^}]+)\}/);
    if (dataMatch) {
      const dataNames = dataMatch[1].match(/(\w+)\s*:/g);
      if (dataNames) component.data = dataNames.map((d) => d.replace(":", "").trim());
    }

    // Computed
    const computedMatch = content.match(/computed\s*:\s*\{([^}]+)\}/);
    if (computedMatch) {
      const computedNames = computedMatch[1].match(/(\w+)\s*[:(]/g);
      if (computedNames) component.computed = computedNames.map((c) => c.replace(/[:(]/g, "").trim());
    }

    // Methods
    const methodsMatch = content.match(/methods\s*:\s*\{([^}]+)\}/);
    if (methodsMatch) {
      const methodNames = methodsMatch[1].match(/(\w+)\s*\(/g);
      if (methodNames) component.methods = methodNames.map((m) => m.replace("(", "").trim());
    }

    // Watch
    const watchMatch = content.match(/watch\s*:\s*\{([^}]+)\}/);
    if (watchMatch) {
      const watchNames = watchMatch[1].match(/['"]?(\w+)['"]?\s*[:(]/g);
      if (watchNames) component.watchers = watchNames.map((w) => w.replace(/['":()]/g, "").trim());
    }
  }

  // Lifecycle hooks (both APIs)
  const lifecycleHooks = [
    "beforeCreate", "created", "beforeMount", "mounted",
    "beforeUpdate", "updated", "beforeUnmount", "unmounted",
    "onBeforeMount", "onMounted", "onBeforeUpdate", "onUpdated",
    "onBeforeUnmount", "onUnmounted",
  ];
  for (const hook of lifecycleHooks) {
    if (content.includes(hook)) {
      component.lifecycle.push(hook);
    }
  }

  // Issues
  if (component.type === "options" && component.methods.length > 10) {
    component.issues.push("Too many methods - consider splitting component");
  }
  if (component.data.length > 10) {
    component.issues.push("Too many data properties - consider splitting component");
  }
  if (component.watchers.length > 5) {
    component.issues.push("Too many watchers - may impact performance");
  }

  return component;
}

// Analyze jQuery usage
function analyzeJQueryFile(content: string, filepath: string): JQueryUsageInfo {
  const info: JQueryUsageInfo = {
    filepath,
    selectors: [],
    events: [],
    ajax: [],
    deprecated: [],
    domManipulations: 0,
    issues: [],
  };

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Find selectors
    const selectorRegex = /\$\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = selectorRegex.exec(line)) !== null) {
      info.selectors.push({ selector: match[1], line: lineNum });
    }

    // Find events
    const eventRegex = /\.(on|click|submit|change|focus|blur|keyup|keydown|mouseover|mouseout)\s*\(/g;
    while ((match = eventRegex.exec(line)) !== null) {
      info.events.push({ event: match[1], line: lineNum });
    }

    // Find AJAX
    const ajaxRegex = /\$\.(ajax|get|post|getJSON)\s*\(/g;
    while ((match = ajaxRegex.exec(line)) !== null) {
      info.ajax.push({ method: match[1], line: lineNum });
    }

    // Find deprecated methods
    for (const [deprecated, suggestion] of Object.entries(DEPRECATED_JQUERY)) {
      if (line.includes(deprecated)) {
        info.deprecated.push({ method: deprecated, line: lineNum, suggestion });
      }
    }

    // Count DOM manipulations
    const domMethods = [".html(", ".text(", ".append(", ".prepend(", ".after(", ".before(", ".remove(", ".empty(", ".attr(", ".css(", ".addClass(", ".removeClass("];
    for (const method of domMethods) {
      if (line.includes(method)) {
        info.domManipulations++;
      }
    }
  }

  // Issues
  if (info.deprecated.length > 0) {
    info.issues.push(`${info.deprecated.length} deprecated jQuery methods found`);
  }

  // Check for inefficient selectors
  const inefficientSelectors = info.selectors.filter((s) =>
    s.selector.startsWith("*") ||
    s.selector.includes(" > * ") ||
    /^\w+\s+\w+\s+\w+/.test(s.selector) // Deep nesting
  );
  if (inefficientSelectors.length > 0) {
    info.issues.push(`${inefficientSelectors.length} potentially inefficient selectors`);
  }

  // Check for too many DOM manipulations
  if (info.domManipulations > 20) {
    info.issues.push("High DOM manipulation count - consider batching or virtual DOM");
  }

  return info;
}

// React Check Tool
export const reactCheckTool: Tool = {
  name: "react_check",
  description: "Analyze React components (React 분석). Finds components, hooks usage, potential issues. Use when user asks: 'react check', 'react 분석', 'component 분석'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.{tsx,jsx})",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      });

      const allComponents: ReactComponentInfo[] = [];

      for (const file of files) {
        if (!/\.(tsx|jsx)$/.test(file)) continue;
        try {
          const content = fs.readFileSync(file, "utf-8");
          const components = analyzeReactFile(content, file);
          allComponents.push(...components);
        } catch {
          // Skip unparseable files
        }
      }

      const lines: string[] = [];
      lines.push("=== React 컴포넌트 분석 ===");
      lines.push("");
      lines.push(`📊 총 ${allComponents.length}개 컴포넌트 발견`);
      lines.push("");

      // Group by type
      const byType = {
        function: allComponents.filter((c) => c.type === "function"),
        arrow: allComponents.filter((c) => c.type === "arrow"),
        class: allComponents.filter((c) => c.type === "class"),
      };

      lines.push(`   Function: ${byType.function.length}개`);
      lines.push(`   Arrow: ${byType.arrow.length}개`);
      lines.push(`   Class: ${byType.class.length}개 ${byType.class.length > 0 ? "(레거시)" : ""}`);
      lines.push("");

      // List components with issues
      const withIssues = allComponents.filter((c) => c.issues.length > 0);
      if (withIssues.length > 0) {
        lines.push("⚠️ 이슈 발견:");
        for (const comp of withIssues) {
          lines.push(`   ${comp.name} (${path.relative(process.cwd(), comp.filepath)}:${comp.line})`);
          for (const issue of comp.issues) {
            lines.push(`      - ${issue}`);
          }
        }
        lines.push("");
      }

      // Hooks usage summary
      const hooksUsage: Record<string, number> = {};
      for (const comp of allComponents) {
        for (const hook of comp.hooks) {
          const hookName = hook.split(" ")[0];
          hooksUsage[hookName] = (hooksUsage[hookName] || 0) + 1;
        }
      }

      if (Object.keys(hooksUsage).length > 0) {
        lines.push("🪝 Hooks 사용:");
        for (const [hook, count] of Object.entries(hooksUsage).sort((a, b) => b[1] - a[1])) {
          lines.push(`   ${hook}: ${count}회`);
        }
        lines.push("");
      }

      // Memoized components
      const memoized = allComponents.filter((c) => c.memoized);
      if (memoized.length > 0) {
        lines.push(`✅ Memoized 컴포넌트: ${memoized.length}개`);
        for (const comp of memoized) {
          lines.push(`   ${comp.name}`);
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Vue Check Tool
export const vueCheckTool: Tool = {
  name: "vue_check",
  description: "Analyze Vue components (Vue 분석). Finds components, composition API usage, issues. Use when user asks: 'vue check', 'vue 분석', 'vue component'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.vue)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/dist/**"],
      });

      const allComponents: VueComponentInfo[] = [];

      for (const file of files) {
        if (!file.endsWith(".vue")) continue;
        try {
          const content = fs.readFileSync(file, "utf-8");
          const component = analyzeVueFile(content, file);
          allComponents.push(component);
        } catch {
          // Skip unparseable files
        }
      }

      const lines: string[] = [];
      lines.push("=== Vue 컴포넌트 분석 ===");
      lines.push("");
      lines.push(`📊 총 ${allComponents.length}개 컴포넌트 발견`);
      lines.push("");

      // Group by type
      const byType = {
        "script-setup": allComponents.filter((c) => c.type === "script-setup"),
        composition: allComponents.filter((c) => c.type === "composition"),
        options: allComponents.filter((c) => c.type === "options"),
      };

      lines.push(`   Script Setup: ${byType["script-setup"].length}개 (권장)`);
      lines.push(`   Composition API: ${byType.composition.length}개`);
      lines.push(`   Options API: ${byType.options.length}개`);
      lines.push("");

      // List components with issues
      const withIssues = allComponents.filter((c) => c.issues.length > 0);
      if (withIssues.length > 0) {
        lines.push("⚠️ 이슈 발견:");
        for (const comp of withIssues) {
          lines.push(`   ${comp.name}`);
          for (const issue of comp.issues) {
            lines.push(`      - ${issue}`);
          }
        }
        lines.push("");
      }

      // Composables usage
      const composables: Record<string, number> = {};
      for (const comp of allComponents) {
        for (const c of comp.composables) {
          composables[c] = (composables[c] || 0) + 1;
        }
      }

      if (Object.keys(composables).length > 0) {
        lines.push("🔧 Composables 사용:");
        for (const [name, count] of Object.entries(composables).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
          lines.push(`   ${name}: ${count}회`);
        }
        lines.push("");
      }

      // Lifecycle hooks usage
      const lifecycleCount: Record<string, number> = {};
      for (const comp of allComponents) {
        for (const hook of comp.lifecycle) {
          lifecycleCount[hook] = (lifecycleCount[hook] || 0) + 1;
        }
      }

      if (Object.keys(lifecycleCount).length > 0) {
        lines.push("🔄 Lifecycle Hooks:");
        for (const [hook, count] of Object.entries(lifecycleCount).sort((a, b) => b[1] - a[1])) {
          lines.push(`   ${hook}: ${count}회`);
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// jQuery Check Tool
export const jqueryCheckTool: Tool = {
  name: "jquery_check",
  description: "Analyze jQuery usage (jQuery 분석). Finds selectors, events, deprecated methods. Use when user asks: 'jquery check', 'jquery 분석', 'jquery deprecated'.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., src/**/*.js)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const { glob } = await import("glob");
      const pattern = args.pattern as string;

      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/dist/**", "**/*.min.js"],
      });

      const allUsages: JQueryUsageInfo[] = [];

      for (const file of files) {
        if (!/\.js$/.test(file)) continue;
        try {
          const content = fs.readFileSync(file, "utf-8");
          // Check if file uses jQuery
          if (content.includes("$(" ) || content.includes("jQuery(")) {
            const usage = analyzeJQueryFile(content, file);
            allUsages.push(usage);
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (allUsages.length === 0) {
        return { success: true, content: "jQuery 사용을 찾지 못했습니다." };
      }

      const lines: string[] = [];
      lines.push("=== jQuery 사용 분석 ===");
      lines.push("");
      lines.push(`📊 ${allUsages.length}개 파일에서 jQuery 사용 발견`);
      lines.push("");

      // Total stats
      const totalSelectors = allUsages.reduce((sum, u) => sum + u.selectors.length, 0);
      const totalEvents = allUsages.reduce((sum, u) => sum + u.events.length, 0);
      const totalAjax = allUsages.reduce((sum, u) => sum + u.ajax.length, 0);
      const totalDeprecated = allUsages.reduce((sum, u) => sum + u.deprecated.length, 0);

      lines.push("📈 통계:");
      lines.push(`   셀렉터: ${totalSelectors}개`);
      lines.push(`   이벤트 바인딩: ${totalEvents}개`);
      lines.push(`   AJAX 호출: ${totalAjax}개`);
      lines.push(`   Deprecated 메서드: ${totalDeprecated}개`);
      lines.push("");

      // Deprecated methods
      if (totalDeprecated > 0) {
        lines.push("⚠️ Deprecated 메서드:");
        for (const usage of allUsages) {
          for (const dep of usage.deprecated) {
            lines.push(`   ${path.relative(process.cwd(), usage.filepath)}:${dep.line}`);
            lines.push(`      ${dep.method} → ${dep.suggestion}`);
          }
        }
        lines.push("");
      }

      // Files with issues
      const withIssues = allUsages.filter((u) => u.issues.length > 0);
      if (withIssues.length > 0) {
        lines.push("📋 파일별 이슈:");
        for (const usage of withIssues) {
          lines.push(`   ${path.relative(process.cwd(), usage.filepath)}`);
          for (const issue of usage.issues) {
            lines.push(`      - ${issue}`);
          }
        }
        lines.push("");
      }

      // Common selectors
      const selectorCounts: Record<string, number> = {};
      for (const usage of allUsages) {
        for (const sel of usage.selectors) {
          selectorCounts[sel.selector] = (selectorCounts[sel.selector] || 0) + 1;
        }
      }

      const commonSelectors = Object.entries(selectorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (commonSelectors.length > 0) {
        lines.push("🎯 자주 사용되는 셀렉터:");
        for (const [selector, count] of commonSelectors) {
          lines.push(`   "${selector}": ${count}회`);
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Export all frontend tools
export const frontendTools: Tool[] = [
  reactCheckTool,
  vueCheckTool,
  jqueryCheckTool,
];
