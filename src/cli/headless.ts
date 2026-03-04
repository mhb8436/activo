import { OllamaClient } from "../core/llm/ollama.js";
import { AnthropicClient } from "../core/llm/anthropic.js";
import type { LLMClient } from "../core/llm/types.js";
import { processMessage } from "../core/agent.js";
import { Config } from "../core/config.js";
import { initMCPServers, shutdownMCPServers } from "../core/mcp/init.js";
import chalk from "chalk";
import {
  createSession,
  saveSession,
  getSessionContext,
  cleanOldSessions,
} from "../core/conversation.js";

function createClient(config: Config): LLMClient {
  if (config.provider === "anthropic") {
    return new AnthropicClient(config.anthropic);
  }
  return new OllamaClient(config.ollama);
}

export async function runHeadless(prompt: string | undefined, config: Config): Promise<void> {
  if (!prompt) {
    console.error(chalk.red("Error: Prompt is required in headless mode"));
    console.error(chalk.yellow("Usage: activo -p \"your prompt here\""));
    process.exit(1);
  }

  const client = createClient(config);

  // Initialize MCP servers (non-fatal)
  await initMCPServers(config);

  // Check connection
  const isConnected = await client.isConnected();
  if (!isConnected) {
    if (config.provider === "anthropic") {
      console.error(chalk.red("Error: Cannot connect to Anthropic API"));
      console.error(chalk.yellow("Check ANTHROPIC_API_KEY environment variable or config.json"));
    } else {
      console.error(chalk.red("Error: Cannot connect to Ollama"));
      console.error(chalk.yellow(`Make sure Ollama is running at ${config.ollama.baseUrl}`));
    }
    process.exit(1);
  }

  // Load previous context (only for Ollama — Anthropic doesn't support embed for context summarization)
  let contextSummary = "";
  if (config.provider === "ollama") {
    try {
      const { summary } = await getSessionContext(client as OllamaClient, 5);
      contextSummary = summary;
    } catch {
      // Ignore context loading errors
    }
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
    await shutdownMCPServers();
    process.exit(1);
  } finally {
    await shutdownMCPServers();
  }
}
