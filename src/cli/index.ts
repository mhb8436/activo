#!/usr/bin/env node

import { Command } from "commander";
import { chat } from "./commands/chat.js";
import { config } from "./commands/config.js";
import { standards } from "./commands/standards.js";
import { check } from "./commands/check.js";

const program = new Command();

program
  .name("activo")
  .description("AI-powered code quality analyzer with development standards support")
  .version("0.1.0", "-v, --version", "Display version number");

// Chat command (default)
program
  .command("chat [prompt]")
  .description("Start an interactive chat session for code analysis")
  .option("--resume", "Resume from last session")
  .option("-p, --print", "Print response and exit (non-interactive)")
  .action(async (prompt, options) => {
    await chat(prompt, options);
  });

// Config command
program
  .command("config [action]")
  .description("Manage configuration (show, set, check-ollama)")
  .argument("[key]", "Configuration key")
  .argument("[value]", "Configuration value")
  .action(async (action, key, value) => {
    await config(action, key, value);
  });

// Standards command
program
  .command("standards <action>")
  .description("Manage development standards (import, list, validate)")
  .argument("[path]", "Path to PDF or standards directory")
  .action(async (action, path) => {
    await standards(action, path);
  });

// Check command
program
  .command("check <path>")
  .description("Check code against development standards")
  .option("--strict", "Enable strict mode")
  .option("--focus <area>", "Focus on specific area (naming, security, etc.)")
  .action(async (path, options) => {
    await check(path, options);
  });

// Default to chat if no command specified
program.action(async () => {
  await chat(undefined, {});
});

program.parse();
