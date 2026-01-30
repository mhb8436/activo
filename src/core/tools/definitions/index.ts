import { Tool } from "../../llm/ollama.js";

export const readFileTool: Tool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the contents of a file at the specified path",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description: "The path to the file to read (relative or absolute)",
        },
      },
    },
  },
};

export const listDirectoryTool: Tool = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List files and directories in the specified path",
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "The directory path to list (default: current directory)",
        },
      },
    },
  },
};

export const grepSearchTool: Tool = {
  type: "function",
  function: {
    name: "grep_search",
    description: "Search for a pattern in files using grep-like functionality",
    parameters: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "The search pattern (regex supported)",
        },
        path: {
          type: "string",
          description: "The directory or file to search in (default: current directory)",
        },
        filePattern: {
          type: "string",
          description: "File pattern to filter (e.g., '*.ts', '*.java')",
        },
      },
    },
  },
};

export const globSearchTool: Tool = {
  type: "function",
  function: {
    name: "glob_search",
    description: "Find files matching a glob pattern",
    parameters: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.java')",
        },
        path: {
          type: "string",
          description: "Base directory for the search (default: current directory)",
        },
      },
    },
  },
};

export const runCommandTool: Tool = {
  type: "function",
  function: {
    name: "run_command",
    description: "Run a shell command and return its output",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "The command to execute",
        },
      },
    },
  },
};

export const allTools: Tool[] = [
  readFileTool,
  listDirectoryTool,
  grepSearchTool,
  globSearchTool,
  runCommandTool,
];
