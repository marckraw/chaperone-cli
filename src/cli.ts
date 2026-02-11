#!/usr/bin/env bun

import { VERSION } from "./version";
import { runInit } from "./init";
import { checkAndFormat, createCheckOptions } from "./check";
import { formatAI } from "./check/formatters";
import type { OutputFormat } from "./check/formatters";
import { copyToClipboard } from "./utils/clipboard";
import { createSpinner } from "./utils/spinner";
import { runAnalyze } from "./analyze";
import { getUpdateNotification, refreshUpdateCache } from "./update-notifier";

const HELP_TEXT = `
chaperone v${VERSION} - Code enforcer CLI

USAGE:
  chaperone <command> [options]

COMMANDS:
  init        Initialize Chaperone configuration
  check       Check codebase for convention violations
  analyze     Extract rules from AI instruction files (CLAUDE.md, etc.)
  version     Show version information
  help        Show this help message

CHECK OPTIONS:
  --config, -c <path>   Config file path (default: .chaperone.json)
  --cwd <path>          Working directory (default: current directory)
  --fix                 Auto-fix issues where possible
  --format, -f <type>   Output format: text, json, ai (default: text)
  --quiet, -q           Only show errors
  --no-warnings         Hide warnings, show only errors
  --copy                Copy remaining errors to clipboard (AI format)
  --no-progress         Disable progress spinner
  --debug               Show detailed rule execution info

GENERAL OPTIONS:
  --help, -h            Show help
  --version, -v         Show version

ANALYZE OPTIONS:
  --dry-run             Preview extracted rules without saving
  --force               Replace existing AI-extracted rules
  --verbose, -v         Show detailed output

EXAMPLES:
  chaperone init
  chaperone check
  chaperone check --fix                  Auto-fix what's possible
  chaperone check --fix --copy           Fix and copy remaining to clipboard
  chaperone check --format ai            AI-friendly output
  chaperone check --format json          JSON output for CI/CD
  chaperone analyze                      Extract rules from AI files
  chaperone analyze --dry-run            Preview without saving
  chaperone version
`;

function showHelp(): void {
  console.log(HELP_TEXT);
}

function showVersion(): void {
  console.log(`chaperone v${VERSION}`);
}

interface CheckArgs {
  config?: string;
  cwd?: string;
  fix?: boolean;
  format?: OutputFormat;
  quiet?: boolean;
  copy?: boolean;
  noProgress?: boolean;
  noWarnings?: boolean;
  debug?: boolean;
  help?: boolean;
}

function parseCheckArgs(args: string[]): CheckArgs {
  const result: CheckArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;

      case "--config":
      case "-c":
        result.config = args[++i];
        break;

      case "--cwd":
        result.cwd = args[++i];
        break;

      case "--fix":
        result.fix = true;
        break;

      case "--format":
      case "-f":
        result.format = args[++i] as OutputFormat;
        break;

      case "--quiet":
      case "-q":
        result.quiet = true;
        break;

      case "--copy":
        result.copy = true;
        break;

      case "--no-progress":
        result.noProgress = true;
        break;

      case "--no-warnings":
        result.noWarnings = true;
        break;

      case "--debug":
        result.debug = true;
        break;
    }
  }

  return result;
}

const CHECK_HELP_TEXT = `
chaperone check - Check codebase for convention violations

USAGE:
  chaperone check [options]

OPTIONS:
  --config, -c <path>   Config file path (default: .chaperone.json)
  --cwd <path>          Working directory (default: current directory)
  --fix                 Auto-fix issues where possible
  --format, -f <type>   Output format: text, json, ai (default: text)
  --quiet, -q           Only show errors
  --no-warnings         Hide warnings, show only errors
  --copy                Copy remaining errors to clipboard (AI format)
  --no-progress         Disable progress spinner
  --debug               Show detailed rule execution info
  --help, -h            Show this help message

EXAMPLES:
  chaperone check
  chaperone check --fix
  chaperone check --format json
  chaperone check --fix --copy
  chaperone check --debug
`;

async function runCheck(args: string[]): Promise<number> {
  const parsedArgs = parseCheckArgs(args);

  if (parsedArgs.help) {
    console.log(CHECK_HELP_TEXT);
    return 0;
  }

  const showProgress = !parsedArgs.noProgress && parsedArgs.format !== "json";

  // Track completed steps to avoid duplicates
  const completedSteps = new Set<string>();
  const spinner = createSpinner();

  const options = createCheckOptions({
    cwd: parsedArgs.cwd ?? process.cwd(),
    configPath: parsedArgs.config,
    fix: parsedArgs.fix ?? false,
    format: parsedArgs.format ?? "text",
    quiet: parsedArgs.quiet ?? false,
    noWarnings: parsedArgs.noWarnings ?? false,
    debug: parsedArgs.debug ?? false,
    onProgress: showProgress
      ? (step, status) => {
          if (status === "start") {
            spinner.start(step);
          } else if (status === "done") {
            if (!completedSteps.has(step)) {
              completedSteps.add(step);
              spinner.succeed(step);
            }
          } else if (status === "skipped") {
            if (!completedSteps.has(step)) {
              completedSteps.add(step);
              spinner.stop();
              console.log(`\x1b[33m○\x1b[0m ${step} \x1b[2m(skipped)\x1b[0m`);
            }
          }
        }
      : undefined,
    onDebug: parsedArgs.debug
      ? (message) => {
          spinner.stop();
          console.log(`\x1b[2m${message}\x1b[0m`);
        }
      : undefined,
  });

  try {
    const { summary, output } = await checkAndFormat(options);

    // Make sure spinner is stopped before output
    spinner.stop();

    // Add a blank line before results
    if (showProgress) {
      console.log("");
    }

    console.log(output);

    // If --copy flag is set and there are remaining errors, copy to clipboard
    if (parsedArgs.copy && summary.results.length > 0) {
      // Always use AI format for clipboard (most useful for pasting to AI assistants)
      const clipboardContent = formatAI(summary);
      const success = await copyToClipboard(clipboardContent);

      if (success) {
        console.log("\n\x1b[32m✓\x1b[0m Remaining errors copied to clipboard (AI format)");
      } else {
        console.error("\n\x1b[31m✗\x1b[0m Failed to copy to clipboard");
      }
    }

    return summary.success ? 0 : 1;
  } catch (error) {
    spinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    return 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Instant: read cached update check
  let updateNotice: string | null = null;
  try {
    updateNotice = getUpdateNotification();
  } catch {}

  // Fire-and-forget: refresh cache for next run
  refreshUpdateCache().catch(() => {});

  let exitCode = 0;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
  } else if (command === "version" || command === "--version" || command === "-v") {
    showVersion();
  } else if (command === "check") {
    exitCode = await runCheck(args.slice(1));
  } else if (command === "init") {
    await runInit(args.slice(1));
  } else if (command === "analyze") {
    exitCode = await runAnalyze(args.slice(1));
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Run "chaperone help" for usage information');
    exitCode = 1;
  }

  // Print update notice last, to stderr
  if (updateNotice) {
    console.error(updateNotice);
  }

  process.exit(exitCode);
}

main();
