#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { createRequire } from "module";
import { App } from "../ui/App.js";
import { showBanner } from "./banner.js";
import { loadConfig } from "../core/config.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

const program = new Command();

program
  .name("activo")
  .description("AI-powered code quality analyzer with Tool Calling and MCP support")
  .version(pkg.version, "-v, --version", "Display version number");

program
  .option("-p, --print", "Non-interactive mode (print and exit)")
  .option("--headless", "Headless mode for CI/CD")
  .option("--resume", "Resume from last session")
  .option("--model <model>", "Specify Ollama model")
  .argument("[prompt]", "Initial prompt")
  .action(async (prompt, options) => {
    // Show ASCII banner
    showBanner();

    // Load config
    const config = loadConfig();

    if (options.model) {
      config.ollama.model = options.model;
    }

    // Headless/print mode
    if (options.print || options.headless) {
      const { runHeadless } = await import("./headless.js");
      await runHeadless(prompt, config);
      return;
    }

    // Interactive TUI mode
    const { waitUntilExit } = render(
      React.createElement(App, {
        initialPrompt: prompt,
        config,
        resume: options.resume,
      })
    );

    await waitUntilExit();
  });

program.parse();
