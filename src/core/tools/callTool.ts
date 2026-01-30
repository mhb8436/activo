import {
  readFile,
  listDirectory,
  grepSearch,
  globSearch,
  runCommand,
  ToolResult,
} from "./implementations/index.js";

export async function callTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case "read_file":
      return readFile(args as { filepath: string });

    case "list_directory":
      return listDirectory(args as { path: string });

    case "grep_search":
      return grepSearch(
        args as { pattern: string; path?: string; filePattern?: string }
      );

    case "glob_search":
      return globSearch(args as { pattern: string; path?: string });

    case "run_command":
      return runCommand(args as { command: string });

    default:
      return {
        success: false,
        content: "",
        error: `Unknown tool: ${toolName}`,
      };
  }
}
