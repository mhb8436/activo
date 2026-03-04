import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve apex rulesets directory.
 * Priority:
 *   1. Explicit path (user-provided)
 *   2. Local apex-ai installation: /Users/.../apex-ai/configs/rulesets
 *   3. Bundled data: <activo-package>/data/apex-rulesets/
 */
export function resolveRulesetsDir(explicit?: string): string {
  // 1. Explicit path
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  // 2. Local apex-ai (development)
  const localApex = path.resolve(process.cwd(), "../apex-ai/configs/rulesets");
  if (fs.existsSync(localApex)) {
    return localApex;
  }

  // 3. Bundled with activo package
  //    src/core/tools/apexPaths.ts → dist/core/tools/apexPaths.js
  //    data/apex-rulesets/ is at package root
  const bundled = path.resolve(__dirname, "../../../data/apex-rulesets");
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  // Fallback: current directory
  return ".";
}

/**
 * Resolve apex rule-schema.yaml path.
 * Same priority as resolveRulesetsDir.
 */
export function resolveSchemaPath(explicit?: string): string {
  // 1. Explicit path
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  // 2. Local apex-ai (development)
  const localSchema = path.resolve(process.cwd(), "../apex-ai/configs/rule-schema.yaml");
  if (fs.existsSync(localSchema)) {
    return localSchema;
  }

  // 3. Bundled
  const bundledSchema = path.resolve(__dirname, "../../../data/apex-rulesets/rule-schema.yaml");
  if (fs.existsSync(bundledSchema)) {
    return bundledSchema;
  }

  return "";
}
