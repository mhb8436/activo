import { Tool, ToolResult } from "./types.js";
import * as fs from "fs";
import * as path from "path";

interface HtmlElement {
  tag: string;
  line: number;
  issues: string[];
  attributes?: string[];
}

interface HtmlAnalysisResult {
  file: string;
  type: "html" | "jsp" | "vue" | "template";
  elements: HtmlElement[];
  meta: {
    title: boolean;
    description: boolean;
    viewport: boolean;
    charset: boolean;
    lang: boolean;
  };
  accessibility: {
    missingAlt: number;
    missingLabel: number;
    missingAriaLabel: number;
    emptyLinks: number;
    emptyButtons: number;
  };
  semantic: {
    hasHeader: boolean;
    hasNav: boolean;
    hasMain: boolean;
    hasFooter: boolean;
    hasArticle: boolean;
    divCount: number;
  };
  issues: string[];
  summary: {
    totalElements: number;
    elementsWithIssues: number;
    a11yScore: number;
    seoScore: number;
  };
}

// HTML/JSP/Vue 분석
function analyzeHtmlFile(filePath: string): HtmlAnalysisResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const ext = path.extname(filePath).toLowerCase();

  let type: "html" | "jsp" | "vue" | "template";
  if (ext === ".jsp") type = "jsp";
  else if (ext === ".vue") type = "vue";
  else if (ext === ".ejs" || ext === ".hbs" || ext === ".pug") type = "template";
  else type = "html";

  const elements: HtmlElement[] = [];
  const issues: string[] = [];

  // Meta 태그 검사
  const meta = {
    title: /<title[^>]*>[^<]+<\/title>/i.test(content),
    description: /<meta[^>]*name=["']description["'][^>]*>/i.test(content),
    viewport: /<meta[^>]*name=["']viewport["'][^>]*>/i.test(content),
    charset: /<meta[^>]*charset=/i.test(content) || /charset=/i.test(content),
    lang: /<html[^>]*lang=/i.test(content),
  };

  // 접근성 검사
  const accessibility = {
    missingAlt: 0,
    missingLabel: 0,
    missingAriaLabel: 0,
    emptyLinks: 0,
    emptyButtons: 0,
  };

  // 시맨틱 태그 검사
  const semantic = {
    hasHeader: /<header[\s>]/i.test(content),
    hasNav: /<nav[\s>]/i.test(content),
    hasMain: /<main[\s>]/i.test(content),
    hasFooter: /<footer[\s>]/i.test(content),
    hasArticle: /<article[\s>]/i.test(content),
    divCount: (content.match(/<div[\s>]/gi) || []).length,
  };

  // Deprecated 태그 목록
  const deprecatedTags = [
    "font", "center", "marquee", "blink", "strike", "big", "tt",
    "frame", "frameset", "noframes", "applet", "basefont", "dir", "isindex",
  ];

  // 인라인 스타일/이벤트 핸들러
  const inlineStyles = (content.match(/style=["'][^"']+["']/gi) || []).length;
  const inlineEvents = (content.match(/on\w+=["'][^"']+["']/gi) || []).length;

  // 라인 번호 찾기 함수
  const findLineNumber = (index: number): number => {
    let lineNum = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === "\n") lineNum++;
    }
    return lineNum;
  };

  // img 태그 검사
  const imgRegex = /<img([^>]*)>/gi;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    const attrs = match[1];
    const elementIssues: string[] = [];

    if (!/alt=/i.test(attrs)) {
      elementIssues.push("alt 속성 누락");
      accessibility.missingAlt++;
    } else if (/alt=["']\s*["']/i.test(attrs)) {
      elementIssues.push("alt 속성 비어있음");
    }

    if (!/loading=/i.test(attrs)) {
      elementIssues.push("loading 속성 권장 (lazy)");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "img",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // a 태그 검사
  const aRegex = /<a([^>]*)>([^<]*)<\/a>/gi;
  while ((match = aRegex.exec(content)) !== null) {
    const attrs = match[1];
    const text = match[2].trim();
    const elementIssues: string[] = [];

    if (!text && !/aria-label=/i.test(attrs)) {
      elementIssues.push("빈 링크 텍스트");
      accessibility.emptyLinks++;
    }

    if (/target=["']_blank["']/i.test(attrs) && !/rel=["'][^"']*noopener/i.test(attrs)) {
      elementIssues.push("target=_blank에 rel=noopener 권장");
    }

    if (/href=["']#["']/i.test(attrs)) {
      elementIssues.push("href='#' - 실제 링크 또는 button 사용 권장");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "a",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // button 태그 검사
  const buttonRegex = /<button([^>]*)>([^<]*)<\/button>/gi;
  while ((match = buttonRegex.exec(content)) !== null) {
    const attrs = match[1];
    const text = match[2].trim();
    const elementIssues: string[] = [];

    if (!text && !/aria-label=/i.test(attrs)) {
      elementIssues.push("빈 버튼 텍스트");
      accessibility.emptyButtons++;
    }

    if (!/type=/i.test(attrs)) {
      elementIssues.push("type 속성 권장 (button/submit)");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "button",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // input 태그 검사
  const inputRegex = /<input([^>]*)>/gi;
  while ((match = inputRegex.exec(content)) !== null) {
    const attrs = match[1];
    const elementIssues: string[] = [];

    // label 연결 검사 (id가 있어야 label for 가능)
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    if (idMatch) {
      const inputId = idMatch[1];
      if (!new RegExp(`<label[^>]*for=["']${inputId}["']`, "i").test(content)) {
        if (!/aria-label=/i.test(attrs) && !/placeholder=/i.test(attrs)) {
          elementIssues.push("label 또는 aria-label 권장");
          accessibility.missingLabel++;
        }
      }
    } else if (!/aria-label=/i.test(attrs)) {
      // id 없으면 aria-label 필요
      if (!/type=["'](?:hidden|submit|button|reset)["']/i.test(attrs)) {
        elementIssues.push("id 또는 aria-label 권장");
        accessibility.missingLabel++;
      }
    }

    // autocomplete 검사
    if (/type=["'](?:password|email|tel|text)["']/i.test(attrs) && !/autocomplete=/i.test(attrs)) {
      elementIssues.push("autocomplete 속성 권장");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "input",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // form 태그 검사
  const formRegex = /<form([^>]*)>/gi;
  while ((match = formRegex.exec(content)) !== null) {
    const attrs = match[1];
    const elementIssues: string[] = [];

    if (!/action=/i.test(attrs)) {
      elementIssues.push("action 속성 누락");
    }

    if (!/method=/i.test(attrs)) {
      elementIssues.push("method 속성 권장");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "form",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // table 태그 검사
  const tableRegex = /<table([^>]*)>/gi;
  while ((match = tableRegex.exec(content)) !== null) {
    const tableStart = match.index;
    const tableEnd = content.indexOf("</table>", tableStart);
    const tableContent = content.substring(tableStart, tableEnd);
    const elementIssues: string[] = [];

    if (!/<caption/i.test(tableContent)) {
      elementIssues.push("caption 권장 (테이블 설명)");
    }

    if (!/<th[\s>]/i.test(tableContent)) {
      elementIssues.push("th 요소 권장 (헤더 셀)");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "table",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // deprecated 태그 검사
  deprecatedTags.forEach((tag) => {
    const tagRegex = new RegExp(`<${tag}[\\s>]`, "gi");
    let tagMatch;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      elements.push({
        tag,
        line: findLineNumber(tagMatch.index),
        issues: [`deprecated 태그 - 사용 금지`],
      });
    }
  });

  // iframe 검사
  const iframeRegex = /<iframe([^>]*)>/gi;
  while ((match = iframeRegex.exec(content)) !== null) {
    const attrs = match[1];
    const elementIssues: string[] = [];

    if (!/title=/i.test(attrs)) {
      elementIssues.push("title 속성 권장 (접근성)");
    }

    if (!/sandbox=/i.test(attrs)) {
      elementIssues.push("sandbox 속성 권장 (보안)");
    }

    if (elementIssues.length > 0) {
      elements.push({
        tag: "iframe",
        line: findLineNumber(match.index),
        issues: elementIssues,
      });
    }
  }

  // 전체 이슈 수집
  if (!meta.title) issues.push("title 태그 누락 (SEO)");
  if (!meta.description) issues.push("meta description 누락 (SEO)");
  if (!meta.viewport) issues.push("viewport 설정 누락 (반응형)");
  if (!meta.charset) issues.push("charset 설정 누락");
  if (!meta.lang) issues.push("html lang 속성 누락 (접근성)");

  if (!semantic.hasMain) issues.push("main 요소 없음 (시맨틱)");
  if (semantic.divCount > 30) issues.push(`div 요소 ${semantic.divCount}개 - 시맨틱 태그 권장`);

  if (inlineStyles > 5) issues.push(`인라인 스타일 ${inlineStyles}개 - CSS 클래스 권장`);
  if (inlineEvents > 3) issues.push(`인라인 이벤트 ${inlineEvents}개 - JS 분리 권장`);

  // 점수 계산
  const a11yMaxPoints = 5;
  let a11yPoints = a11yMaxPoints;
  if (accessibility.missingAlt > 0) a11yPoints -= 1;
  if (accessibility.missingLabel > 0) a11yPoints -= 1;
  if (accessibility.emptyLinks > 0) a11yPoints -= 1;
  if (accessibility.emptyButtons > 0) a11yPoints -= 1;
  if (!meta.lang) a11yPoints -= 1;
  const a11yScore = Math.max(0, Math.round((a11yPoints / a11yMaxPoints) * 100));

  const seoMaxPoints = 5;
  let seoPoints = seoMaxPoints;
  if (!meta.title) seoPoints -= 1;
  if (!meta.description) seoPoints -= 1;
  if (!meta.viewport) seoPoints -= 1;
  if (!semantic.hasMain) seoPoints -= 1;
  if (!semantic.hasHeader && !semantic.hasNav) seoPoints -= 1;
  const seoScore = Math.max(0, Math.round((seoPoints / seoMaxPoints) * 100));

  return {
    file: filePath,
    type,
    elements,
    meta,
    accessibility,
    semantic,
    issues,
    summary: {
      totalElements: elements.length,
      elementsWithIssues: elements.filter((e) => e.issues.length > 0).length,
      a11yScore,
      seoScore,
    },
  };
}

// 도구 정의
export const htmlTools: Tool[] = [
  {
    name: "html_check",
    description:
      "HTML/JSP/Vue 파일을 분석합니다. 접근성(a11y), SEO 메타태그, 시맨틱 태그, deprecated 태그, 폼 요소 등을 검사합니다.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 HTML/JSP/Vue 파일 또는 디렉토리 경로",
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

      const results: HtmlAnalysisResult[] = [];
      const stats = fs.statSync(targetPath);
      const htmlExtensions = [".html", ".htm", ".jsp", ".vue", ".ejs", ".hbs"];

      if (stats.isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        if (htmlExtensions.includes(ext)) {
          results.push(analyzeHtmlFile(targetPath));
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
            } else {
              const ext = path.extname(file).toLowerCase();
              if (htmlExtensions.includes(ext)) {
                results.push(analyzeHtmlFile(filePath));
              }
            }
          }
        };
        walkDir(targetPath);
      }

      // 전체 통계
      const avgA11y = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.summary.a11yScore, 0) / results.length)
        : 0;
      const avgSeo = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.summary.seoScore, 0) / results.length)
        : 0;

      const totalA11y = {
        missingAlt: results.reduce((sum, r) => sum + r.accessibility.missingAlt, 0),
        missingLabel: results.reduce((sum, r) => sum + r.accessibility.missingLabel, 0),
        emptyLinks: results.reduce((sum, r) => sum + r.accessibility.emptyLinks, 0),
        emptyButtons: results.reduce((sum, r) => sum + r.accessibility.emptyButtons, 0),
      };

      const output = {
        analyzedFiles: results.length,
        averageA11yScore: avgA11y,
        averageSeoScore: avgSeo,
        totalAccessibilityIssues: totalA11y,
        files: results.map((r) => ({
          file: r.file,
          type: r.type,
          a11yScore: r.summary.a11yScore,
          seoScore: r.summary.seoScore,
          meta: r.meta,
          semantic: r.semantic,
          accessibility: r.accessibility,
          pageIssues: r.issues,
          elementIssues: r.elements.map((e) => ({
            tag: e.tag,
            line: e.line,
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
