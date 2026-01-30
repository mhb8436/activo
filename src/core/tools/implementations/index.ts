import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { glob } from "glob";

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export async function readFile(args: { filepath: string }): Promise<ToolResult> {
  try {
    const filepath = path.resolve(args.filepath);

    if (!fs.existsSync(filepath)) {
      return {
        success: false,
        content: "",
        error: `File not found: ${filepath}`,
      };
    }

    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) {
      return {
        success: false,
        content: "",
        error: `Path is a directory, not a file: ${filepath}`,
      };
    }

    const content = fs.readFileSync(filepath, "utf-8");
    return {
      success: true,
      content: content,
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Error reading file: ${error}`,
    };
  }
}

export async function listDirectory(args: { path: string }): Promise<ToolResult> {
  try {
    const dirPath = path.resolve(args.path || ".");

    if (!fs.existsSync(dirPath)) {
      return {
        success: false,
        content: "",
        error: `Directory not found: ${dirPath}`,
      };
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = entries.map((entry) => {
      const type = entry.isDirectory() ? "[DIR]" : "[FILE]";
      return `${type} ${entry.name}`;
    });

    return {
      success: true,
      content: result.join("\n"),
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Error listing directory: ${error}`,
    };
  }
}

export async function grepSearch(args: {
  pattern: string;
  path?: string;
  filePattern?: string;
}): Promise<ToolResult> {
  try {
    const searchPath = args.path || ".";
    const pattern = args.pattern;

    // Build grep command
    let cmd = `grep -rn "${pattern}" "${searchPath}"`;
    if (args.filePattern) {
      cmd += ` --include="${args.filePattern}"`;
    }
    cmd += " 2>/dev/null || true";

    const output = execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!output.trim()) {
      return {
        success: true,
        content: "No matches found",
      };
    }

    // Limit output to first 50 matches
    const lines = output.trim().split("\n").slice(0, 50);
    const truncated = output.trim().split("\n").length > 50;

    return {
      success: true,
      content: lines.join("\n") + (truncated ? "\n... (truncated)" : ""),
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Error searching: ${error}`,
    };
  }
}

export async function globSearch(args: {
  pattern: string;
  path?: string;
}): Promise<ToolResult> {
  try {
    const basePath = args.path || ".";
    const fullPattern = path.join(basePath, args.pattern);

    const files = await glob(fullPattern, {
      nodir: false,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });

    if (files.length === 0) {
      return {
        success: true,
        content: "No files found matching pattern",
      };
    }

    // Limit to first 100 files
    const truncated = files.length > 100;
    const result = files.slice(0, 100);

    return {
      success: true,
      content: result.join("\n") + (truncated ? `\n... (${files.length - 100} more files)` : ""),
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Error searching: ${error}`,
    };
  }
}

export async function runCommand(args: { command: string }): Promise<ToolResult> {
  try {
    // Safety check - block dangerous commands
    const dangerous = ["rm -rf", "mkfs", "dd if=", "> /dev/", "chmod -R 777"];
    if (dangerous.some((d) => args.command.includes(d))) {
      return {
        success: false,
        content: "",
        error: "Command blocked for safety reasons",
      };
    }

    const output = execSync(args.command, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });

    return {
      success: true,
      content: output,
    };
  } catch (error: any) {
    return {
      success: false,
      content: error.stdout || "",
      error: error.stderr || error.message,
    };
  }
}
