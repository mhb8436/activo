import { OllamaClient } from "../core/llm/ollama.js";
import { processMessage } from "../core/agent.js";
import { Config } from "../core/config.js";
import chalk from "chalk";
import {
  createSession,
  saveSession,
  getSessionContext,
  cleanOldSessions,
} from "../core/conversation.js";

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

  // Load previous context
  let contextSummary = "";
  try {
    const { summary } = await getSessionContext(client, 5);
    contextSummary = summary;
  } catch {
    // Ignore context loading errors
  }

  // Create new session
  const session = createSession();

  try {
    const result = await processMessage(prompt, [], client, config, (event) => {
      if (event.type === "tool_use") {
        console.error(chalk.dim(`[Tool] ${event.tool}: ${event.status}`));
      } else if (event.type === "thinking") {
        // Skip thinking in headless mode
      }
    }, contextSummary);

    console.log(result.content);

    // Save conversation to session
    session.messages.push({ role: "user", content: prompt });
    session.messages.push({ role: "assistant", content: result.content });
    saveSession(session);

    // Clean old sessions
    cleanOldSessions(10);
  } catch (error) {
    console.error(chalk.red(`Error: ${error}`));
    process.exit(1);
  }
}
