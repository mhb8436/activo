import chalk from "chalk";
import ora from "ora";
import readline from "readline";
import { OllamaClient, ChatMessage } from "../../core/llm/ollama.js";
import { allTools } from "../../core/tools/definitions/index.js";
import { callTool } from "../../core/tools/callTool.js";
import {
  createSession,
  saveSession,
  loadLastSession,
  Session,
} from "../../session/index.js";

const SYSTEM_PROMPT = `You are Activo, an AI-powered code quality analyzer assistant.
You help developers analyze and improve their code quality.

You have access to the following tools:
- read_file: Read file contents
- list_directory: List directory contents
- grep_search: Search for patterns in files
- glob_search: Find files by pattern
- run_command: Run shell commands

When analyzing code:
1. First understand the project structure
2. Read relevant files
3. Identify issues and improvements
4. Provide clear explanations and suggestions

Always be helpful and provide actionable feedback.`;

interface ChatOptions {
  resume?: boolean;
  print?: boolean;
}

async function processToolCalls(
  client: OllamaClient,
  messages: ChatMessage[],
  response: ChatMessage
): Promise<ChatMessage> {
  if (!response.toolCalls?.length) {
    return response;
  }

  // Process each tool call
  for (const toolCall of response.toolCalls) {
    const toolName = toolCall.function.name;
    let args: Record<string, unknown>;

    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = {};
    }

    console.log(chalk.dim(`\n🔧 Using tool: ${toolName}`));

    const result = await callTool(toolName, args);

    if (result.success) {
      console.log(chalk.dim(`✓ Tool completed`));
    } else {
      console.log(chalk.dim(`✗ Tool error: ${result.error}`));
    }

    // Add tool result to messages
    messages.push({
      role: "tool",
      content: result.success
        ? result.content
        : `Error: ${result.error}`,
    });
  }

  // Get next response after tool calls
  const nextResponse = await client.chat(messages, { tools: allTools });
  messages.push(nextResponse);

  // Recursively process if there are more tool calls
  if (nextResponse.toolCalls?.length) {
    return processToolCalls(client, messages, nextResponse);
  }

  return nextResponse;
}

export async function chat(
  initialPrompt?: string,
  options: ChatOptions = {}
): Promise<void> {
  const client = new OllamaClient();

  // Check Ollama connection
  const isConnected = await client.isConnected();
  if (!isConnected) {
    console.log(chalk.red("\n✗ Cannot connect to Ollama"));
    console.log(chalk.yellow("Make sure Ollama is running: ollama serve"));
    process.exit(1);
  }

  let session: Session;

  // Resume or create session
  if (options.resume) {
    const lastSession = loadLastSession();
    if (lastSession) {
      session = lastSession;
      console.log(chalk.cyan(`\nResumed session: ${session.title}`));
    } else {
      console.log(chalk.yellow("No previous session found, starting new session"));
      session = createSession();
    }
  } else {
    session = createSession();
  }

  // Initialize messages with system prompt
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...session.history,
  ];

  // Non-interactive mode
  if (options.print && initialPrompt) {
    const userMessage: ChatMessage = { role: "user", content: initialPrompt };
    messages.push(userMessage);
    session.history.push(userMessage);

    const spinner = ora("Thinking...").start();

    try {
      const response = await client.chat(messages, { tools: allTools });
      messages.push(response);
      spinner.stop();

      // Process tool calls if any
      const finalResponse = await processToolCalls(client, messages, response);
      console.log(finalResponse.content);

      session.history.push(finalResponse);
      saveSession(session);
    } catch (error) {
      spinner.fail("Error");
      console.error(chalk.red(`Error: ${error}`));
    }

    return;
  }

  // Interactive mode
  console.log(chalk.bold.cyan("\n🚀 Activo Code Analyzer"));
  console.log(chalk.dim("Type your message or 'exit' to quit\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(chalk.green("You: "), async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        saveSession(session);
        console.log(chalk.cyan("\nSession saved. Goodbye!"));
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      const userMessage: ChatMessage = { role: "user", content: trimmed };
      messages.push(userMessage);
      session.history.push(userMessage);

      const spinner = ora("Thinking...").start();

      try {
        const response = await client.chat(messages, { tools: allTools });
        messages.push(response);
        spinner.stop();

        // Process tool calls if any
        const finalResponse = await processToolCalls(client, messages, response);

        console.log(chalk.blue("\nActivo: ") + finalResponse.content + "\n");

        session.history.push(finalResponse);
        saveSession(session);
      } catch (error) {
        spinner.fail("Error");
        console.error(chalk.red(`Error: ${error}\n`));
      }

      prompt();
    });
  };

  // If initial prompt provided, process it first
  if (initialPrompt) {
    const userMessage: ChatMessage = { role: "user", content: initialPrompt };
    messages.push(userMessage);
    session.history.push(userMessage);

    const spinner = ora("Thinking...").start();

    try {
      const response = await client.chat(messages, { tools: allTools });
      messages.push(response);
      spinner.stop();

      const finalResponse = await processToolCalls(client, messages, response);
      console.log(chalk.blue("\nActivo: ") + finalResponse.content + "\n");

      session.history.push(finalResponse);
      saveSession(session);
    } catch (error) {
      spinner.fail("Error");
      console.error(chalk.red(`Error: ${error}\n`));
    }
  }

  prompt();
}
