import fs from "fs";
import path from "path";
import os from "os";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  contextLength: number;
  keepAlive: number;
}

export interface Config {
  ollama: OllamaConfig;
  standards: {
    directory: string;
  };
  mcp: {
    servers: Record<string, MCPServerConfig>;
  };
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

const DEFAULT_CONFIG: Config = {
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "mistral:latest",
    contextLength: 4096,
    keepAlive: 1800, // 30 minutes
  },
  standards: {
    directory: ".activo/standards",
  },
  mcp: {
    servers: {},
  },
};

function getConfigPath(): string {
  return path.join(os.homedir(), ".activo", "config.json");
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, "utf-8");
      const loaded = JSON.parse(data);
      return {
        ollama: { ...DEFAULT_CONFIG.ollama, ...loaded.ollama },
        standards: { ...DEFAULT_CONFIG.standards, ...loaded.standards },
        mcp: { ...DEFAULT_CONFIG.mcp, ...loaded.mcp },
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  return DEFAULT_CONFIG;
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function getProjectConfig(): Config {
  const projectConfigPath = path.join(process.cwd(), ".activo", "config.json");

  if (fs.existsSync(projectConfigPath)) {
    try {
      const data = fs.readFileSync(projectConfigPath, "utf-8");
      const projectConfig = JSON.parse(data);
      const globalConfig = loadConfig();

      return {
        ollama: { ...globalConfig.ollama, ...projectConfig.ollama },
        standards: { ...globalConfig.standards, ...projectConfig.standards },
        mcp: { ...globalConfig.mcp, ...projectConfig.mcp },
      };
    } catch {
      return loadConfig();
    }
  }

  return loadConfig();
}
