import fs from "fs";
import path from "path";
import os from "os";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  contextLength: number;
  keepAlive: number;
}

export interface AnthropicConfig {
  apiKey?: string;
  model: string;
  maxTokens: number;
  timeout?: number; // per-request timeout in ms (default: 120000 = 2 min)
}

export type Provider = "ollama" | "anthropic";

export interface Config {
  provider: Provider;
  ollama: OllamaConfig;
  anthropic: AnthropicConfig;
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
  provider: "ollama",
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "mistral:latest",
    contextLength: 4096,
    keepAlive: 1800, // 30 minutes
  },
  anthropic: {
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    timeout: 120000, // 2 minutes per request
  },
  standards: {
    directory: ".activo/standards",
  },
  mcp: {
    servers: {},
  },
};

/**
 * Auto-detect provider: if ANTHROPIC_API_KEY env var or config apiKey exists, use anthropic.
 * Otherwise use ollama.
 */
export function resolveProvider(loaded?: Partial<Config>): Provider {
  // CLI --provider flag (propagated via env) takes highest priority
  const envProvider = process.env.ACTIVO_PROVIDER;
  if (envProvider === "ollama" || envProvider === "anthropic") {
    return envProvider;
  }
  // Explicit provider in config takes priority
  if (loaded?.provider && (loaded.provider === "ollama" || loaded.provider === "anthropic")) {
    return loaded.provider;
  }
  // Auto-detect based on API key availability
  if (process.env.ANTHROPIC_API_KEY || loaded?.anthropic?.apiKey) {
    return "anthropic";
  }
  return "ollama";
}

function getConfigPath(): string {
  return path.join(os.homedir(), ".activo", "config.json");
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, "utf-8");
      const loaded = JSON.parse(data);
      const config: Config = {
        provider: "ollama", // placeholder, resolved below
        ollama: { ...DEFAULT_CONFIG.ollama, ...loaded.ollama },
        anthropic: { ...DEFAULT_CONFIG.anthropic, ...loaded.anthropic },
        standards: { ...DEFAULT_CONFIG.standards, ...loaded.standards },
        mcp: { ...DEFAULT_CONFIG.mcp, ...loaded.mcp },
      };
      config.provider = resolveProvider(loaded);
      return config;
    } catch {
      return { ...DEFAULT_CONFIG, provider: resolveProvider() };
    }
  }

  return { ...DEFAULT_CONFIG, provider: resolveProvider() };
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

      const config: Config = {
        provider: globalConfig.provider,
        ollama: { ...globalConfig.ollama, ...projectConfig.ollama },
        anthropic: { ...globalConfig.anthropic, ...projectConfig.anthropic },
        standards: { ...globalConfig.standards, ...projectConfig.standards },
        mcp: { ...globalConfig.mcp, ...projectConfig.mcp },
      };
      // Project-level provider override
      if (projectConfig.provider) {
        config.provider = projectConfig.provider;
      }
      return config;
    } catch {
      return loadConfig();
    }
  }

  return loadConfig();
}
