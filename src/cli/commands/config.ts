import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";

interface Config {
  ollama: {
    baseUrl: string;
    model: string;
  };
  standards: {
    directory: string;
  };
}

const DEFAULT_CONFIG: Config = {
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "codellama:7b",
  },
  standards: {
    directory: ".activo/standards",
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
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
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

async function checkOllama(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function config(
  action?: string,
  key?: string,
  value?: string
): Promise<void> {
  const currentConfig = loadConfig();

  if (!action || action === "show") {
    console.log(chalk.bold("\n⚙️  Activo Configuration\n"));
    console.log(chalk.cyan("Ollama:"));
    console.log(`  Base URL: ${currentConfig.ollama.baseUrl}`);
    console.log(`  Model:    ${currentConfig.ollama.model}`);
    console.log(chalk.cyan("\nStandards:"));
    console.log(`  Directory: ${currentConfig.standards.directory}`);
    console.log("");
    return;
  }

  if (action === "check-ollama") {
    console.log(chalk.cyan("\nChecking Ollama connection..."));
    const isConnected = await checkOllama(currentConfig.ollama.baseUrl);

    if (isConnected) {
      console.log(chalk.green("✓ Ollama is running and accessible"));

      // List available models
      try {
        const response = await fetch(`${currentConfig.ollama.baseUrl}/api/tags`);
        const data = await response.json() as { models: Array<{ name: string }> };

        if (data.models && data.models.length > 0) {
          console.log(chalk.cyan("\nAvailable models:"));
          data.models.forEach((model: { name: string }) => {
            const marker = model.name === currentConfig.ollama.model ? chalk.green(" ← current") : "";
            console.log(`  - ${model.name}${marker}`);
          });
        }
      } catch {
        // Ignore error listing models
      }
    } else {
      console.log(chalk.red("✗ Cannot connect to Ollama"));
      console.log(chalk.yellow(`  Make sure Ollama is running at ${currentConfig.ollama.baseUrl}`));
      console.log(chalk.yellow("  Run: ollama serve"));
    }
    console.log("");
    return;
  }

  if (action === "set" && key && value) {
    const keys = key.split(".");
    let obj: any = currentConfig;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in obj)) {
        console.log(chalk.red(`Unknown config key: ${key}`));
        return;
      }
      obj = obj[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    if (!(lastKey in obj)) {
      console.log(chalk.red(`Unknown config key: ${key}`));
      return;
    }

    obj[lastKey] = value;
    saveConfig(currentConfig);
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
    return;
  }

  console.log(chalk.yellow("Usage:"));
  console.log("  activo config              Show current configuration");
  console.log("  activo config check-ollama Check Ollama connection");
  console.log("  activo config set <key> <value>  Set configuration value");
  console.log("");
  console.log("Available keys:");
  console.log("  ollama.baseUrl    Ollama server URL");
  console.log("  ollama.model      Default model name");
  console.log("  standards.directory  Standards directory path");
}
