import gradient from "gradient-string";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

const ACTIVO_ASCII = `
    _    ____ _____ _____     _____
   / \\  / ___|_   _|_ _\\ \\   / / _ \\
  / _ \\| |     | |  | | \\ \\ / / | | |
 / ___ \\ |___  | |  | |  \\ V /| |_| |
/_/   \\_\\____| |_| |___|  \\_/  \\___/
`;

const SUBTITLE = "AI-Powered Code Quality Analyzer";
const VERSION = `v${pkg.version}`;

export function showBanner(): void {
  const activoGradient = gradient(["#00d4ff", "#7b2ff7", "#f107a3"]);

  console.log(activoGradient.multiline(ACTIVO_ASCII));
  console.log();
  console.log(`  ${gradient(["#7b2ff7", "#00d4ff"])(SUBTITLE)}  ${VERSION}`);
  console.log();
  console.log("  Type your request in natural language.");
  console.log("  Examples:");
  console.log("    • 이 프로젝트의 코드 품질을 분석해줘");
  console.log("    • PDF 파일을 마크다운 규칙으로 변환해줘");
  console.log("    • src 폴더의 명명규칙 위반을 찾아줘");
  console.log();
  console.log("  Press Ctrl+C twice to exit");
  console.log("─".repeat(50));
  console.log();
}

export function getShortBanner(): string {
  return gradient(["#00d4ff", "#7b2ff7"])("ACTIVO") + " - Code Quality Analyzer";
}
