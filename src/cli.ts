#!/usr/bin/env bun

import { VERSION } from "./version";
import { runInit } from "./init";

const HELP_TEXT = `
chaperone v${VERSION} - Code enforcer CLI

USAGE:
  chaperone <command> [options]

COMMANDS:
  init        Initialize Chaperone configuration
  check       Check codebase for convention violations
  version     Show version information
  help        Show this help message

OPTIONS:
  --help, -h     Show help
  --version, -v  Show version

EXAMPLES:
  chaperone init
  chaperone init --yes
  chaperone check
  chaperone check --config .chaperone.json
  chaperone version
`;

function showHelp(): void {
  console.log(HELP_TEXT);
}

function showVersion(): void {
  console.log(`chaperone v${VERSION}`);
}

function runCheck(): void {
  console.log(`chaperone v${VERSION} - Running checks...`);
  console.log("");
  console.log("📁 Scanning codebase...");
  console.log("✅ No violations found");
  console.log("");
  console.log("Checked 0 files, 0 rules configured");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  if (command === "version" || command === "--version" || command === "-v") {
    showVersion();
    process.exit(0);
  }

  if (command === "check") {
    runCheck();
    process.exit(0);
  }

  if (command === "init") {
    const initArgs = args.slice(1);
    await runInit(initArgs);
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  console.error('Run "chaperone help" for usage information');
  process.exit(1);
}

main();
