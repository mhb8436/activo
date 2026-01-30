import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { glob } from "glob";
import { Tool, ToolResult } from "./types.js";

// Read File Tool
export const readFileTool: Tool = {
  name: "read_file",
  description: "Read the contents of a file. Use this to view source code or any text file.",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to the file (relative or absolute)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      if (!fs.existsSync(filepath)) {
        return { success: false, content: "", error: `File not found: ${filepath}` };
      }
      const stat = fs.statSync(filepath);
      if (stat.isDirectory()) {
        return { success: false, content: "", error: "Path is a directory" };
      }
      const content = fs.readFileSync(filepath, "utf-8");
      return { success: true, content };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Write File Tool
export const writeFileTool: Tool = {
  name: "write_file",
  description: "Write content to a file. Creates directories if needed.",
  parameters: {
    type: "object",
    required: ["filepath", "content"],
    properties: {
      filepath: {
        type: "string",
        description: "Path to write the file",
      },
      content: {
        type: "string",
        description: "Content to write",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const filepath = path.resolve(args.filepath as string);
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filepath, args.content as string);
      return { success: true, content: `Written to ${filepath}` };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// List Directory Tool
export const listDirectoryTool: Tool = {
  name: "list_directory",
  description: "List files and directories in a path.",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Directory path to list",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const dirPath = path.resolve((args.path as string) || ".");
      if (!fs.existsSync(dirPath)) {
        return { success: false, content: "", error: `Directory not found: ${dirPath}` };
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = entries.map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`);
      return { success: true, content: result.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Grep Search Tool
export const grepSearchTool: Tool = {
  name: "grep_search",
  description: "Search for a pattern in files using regex.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Search pattern (regex)",
      },
      path: {
        type: "string",
        description: "Directory or file to search (default: current)",
      },
      filePattern: {
        type: "string",
        description: "File pattern filter (e.g., *.ts)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const searchPath = (args.path as string) || ".";
      let cmd = `grep -rn "${args.pattern}" "${searchPath}"`;
      if (args.filePattern) {
        cmd += ` --include="${args.filePattern}"`;
      }
      cmd += " 2>/dev/null || true";

      const output = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
      if (!output.trim()) {
        return { success: true, content: "No matches found" };
      }
      const lines = output.trim().split("\n").slice(0, 50);
      return { success: true, content: lines.join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Glob Search Tool
export const globSearchTool: Tool = {
  name: "glob_search",
  description: "Find files matching a glob pattern.",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g., **/*.ts)",
      },
      path: {
        type: "string",
        description: "Base directory (default: current)",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const basePath = (args.path as string) || ".";
      const fullPattern = path.join(basePath, args.pattern as string);
      const files = await glob(fullPattern, {
        ignore: ["**/node_modules/**", "**/.git/**"],
      });
      if (files.length === 0) {
        return { success: true, content: "No files found" };
      }
      return { success: true, content: files.slice(0, 100).join("\n") };
    } catch (error) {
      return { success: false, content: "", error: String(error) };
    }
  },
};

// Run Command Tool
export const runCommandTool: Tool = {
  name: "run_command",
  description: "Execute a shell command. Be careful with destructive commands.",
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description: "Command to execute",
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const cmd = args.command as string;
      // Block dangerous commands
      const blocked = ["rm -rf /", "mkfs", "dd if=", "> /dev/"];
      if (blocked.some((b) => cmd.includes(b))) {
        return { success: false, content: "", error: "Command blocked for safety" };
      }
      const output = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
      return { success: true, content: output };
    } catch (error: any) {
      return { success: false, content: error.stdout || "", error: error.stderr || error.message };
    }
  },
};

// All built-in tools
export const builtInTools: Tool[] = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  grepSearchTool,
  globSearchTool,
  runCommandTool,
];
