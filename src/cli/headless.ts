import { OllamaClient } from "../core/llm/ollama.js";
import { processMessage } from "../core/agent.js";
import { Config } from "../core/config.js";
import chalk from "chalk";

export async function runHeadless(prompt: string | undefined, config: Config): Promise<void> {
  if (!prompt) {
    console.error(chalk.red("Error: Prompt is required in headless mode"));
    console.error(chalk.yellow("Usage: activo -p \"your prompt here\""));
    process.exit(1);
  }

  const client = new OllamaClient(config.ollama);

  // Check connection
  const isConnected = await client.isConnected();
  if (!isConnected) {
    console.error(chalk.red("Error: Cannot connect to Ollama"));
    console.error(chalk.yellow(`Make sure Ollama is running at ${config.ollama.baseUrl}`));
    process.exit(1);
  }

  try {
    const result = await processMessage(prompt, [], client, config, (event) => {
      if (event.type === "tool_use") {
        console.error(chalk.dim(`[Tool] ${event.tool}: ${event.status}`));
      } else if (event.type === "thinking") {
        // Skip thinking in headless mode
      }
    });

    console.log(result.content);
  } catch (error) {
    console.error(chalk.red(`Error: ${error}`));
    process.exit(1);
  }
}
