#!/usr/bin/env bun

import { VERSION } from "./version";
import { runInit } from "./init";
import { checkAndFormat, createCheckOptions, ConfigError, formatDiagnostic } from "./check";
import { formatAI, OUTPUT_FORMATS } from "./check/formatters";
import type { OutputFormat } from "./check/formatters";
import { copyToClipboard } from "./utils/clipboard";
import { createSpinner } from "./utils/spinner";
import { createPalette, shouldUseColor } from "./utils/ansi";
import { EXIT, parseArgs, UsageError, type FlagSpec } from "./utils/args";
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
  --quiet, -q           List only errors (all formats)
  --no-warnings         Hide warnings, show only errors
  --copy                Copy remaining errors to clipboard (AI format)
  --no-progress         Disable progress spinner
  --debug               Show detailed rule execution info (stderr)

GENERAL OPTIONS:
  --help, -h            Show help
  --version, -v         Show version

ANALYZE OPTIONS:
  --dry-run             Preview extracted rules without saving
  --force               Replace existing AI-extracted rules
  --verbose, -v         Show detailed output

EXIT CODES:
  0  passed
  1  the check found errors
  2  configuration error, usage error or internal error

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

const CHECK_HELP_TEXT = `
chaperone check - Check codebase for convention violations

USAGE:
  chaperone check [options]

OPTIONS:
  --config, -c <path>   Config file path (default: .chaperone.json)
  --cwd <path>          Working directory (default: current directory)
  --fix                 Auto-fix issues where possible
  --format, -f <type>   Output format: text, json, ai (default: text)
  --quiet, -q           List only errors (all formats)
  --no-warnings         Hide warnings, show only errors
  --copy                Copy remaining errors to clipboard (AI format)
  --no-progress         Disable progress spinner
  --debug               Show detailed rule execution info (stderr)
  --help, -h            Show this help message

OUTPUT:
  Results go to stdout; progress, debug output and notices go to stderr.
  json and ai output never contain ANSI codes, and text output is coloured
  only on a terminal (NO_COLOR and FORCE_COLOR are honoured).

EXIT CODES:
  0  passed
  1  the check found errors
  2  configuration error, usage error or internal error

EXAMPLES:
  chaperone check
  chaperone check --fix
  chaperone check --format json
  chaperone check --fix --copy
  chaperone check --debug
`;

const CHECK_FLAGS = {
  help: { names: ["--help", "-h"], type: "boolean" },
  config: { names: ["--config", "-c"], type: "string" },
  cwd: { names: ["--cwd"], type: "string" },
  fix: { names: ["--fix"], type: "boolean" },
  format: { names: ["--format", "-f"], type: "string", choices: OUTPUT_FORMATS },
  quiet: { names: ["--quiet", "-q"], type: "boolean" },
  copy: { names: ["--copy"], type: "boolean" },
  noProgress: { names: ["--no-progress"], type: "boolean" },
  noWarnings: { names: ["--no-warnings"], type: "boolean" },
  debug: { names: ["--debug"], type: "boolean" },
} satisfies Record<string, FlagSpec>;

function printConfigError(error: ConfigError, format: OutputFormat): number {
  const errors = error.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const warnings = error.diagnostics.filter((diagnostic) => diagnostic.level === "warning");

  if (format === "json") {
    // Keep stdout parseable for machines even when the run cannot start.
    console.log(
      JSON.stringify(
        { success: false, error: "invalid-config", exitCode: EXIT.ERROR, diagnostics: error.diagnostics },
        null,
        2
      )
    );
  }

  const colors = createPalette(shouldUseColor(process.stderr));
  const counts = [
    `${errors.length} error${errors.length === 1 ? "" : "s"}`,
    ...(warnings.length > 0 ? [`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`] : []),
  ].join(", ");
  console.error(`${colors.red}Invalid configuration${colors.reset} (${counts}):`);
  for (const diagnostic of errors) {
    console.error(`  ${colors.red}error${colors.reset}   ${formatDiagnostic(diagnostic)}`);
  }
  for (const diagnostic of warnings) {
    console.error(`  ${colors.yellow}warning${colors.reset} ${formatDiagnostic(diagnostic)}`);
  }
  console.error("");
  console.error("Nothing was checked. Fix the configuration and run again (exit code 2).");
  return EXIT.ERROR;
}

async function runCheck(args: string[]): Promise<number> {
  let parsedArgs;
  try {
    parsedArgs = parseArgs(args, CHECK_FLAGS);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}`);
      console.error('Run "chaperone check --help" for usage information.');
      return EXIT.ERROR;
    }
    throw error;
  }

  if (parsedArgs.help) {
    console.log(CHECK_HELP_TEXT);
    return EXIT.OK;
  }

  const format = (parsedArgs.format ?? "text") as OutputFormat;
  const interactive = Boolean(process.stdout.isTTY) && Boolean(process.stderr.isTTY);
  const showProgress = format === "text" && interactive && !parsedArgs.noProgress && !parsedArgs.quiet;
  const stderrColors = createPalette(shouldUseColor(process.stderr));

  // Steps overlap (tools and rules run concurrently): show every active step
  const activeSteps: string[] = [];
  const completedSteps = new Set<string>();
  const spinner = createSpinner("", { enabled: showProgress });
  const refreshSpinner = () => {
    if (activeSteps.length === 0) {
      spinner.stop();
    } else {
      spinner.update(activeSteps.join(", "));
      spinner.start();
    }
  };

  const options = createCheckOptions({
    cwd: parsedArgs.cwd ?? process.cwd(),
    configPath: parsedArgs.config,
    fix: parsedArgs.fix ?? false,
    format,
    quiet: parsedArgs.quiet ?? false,
    noWarnings: parsedArgs.noWarnings ?? false,
    debug: parsedArgs.debug ?? false,
    color: format === "text" && shouldUseColor(process.stdout),
    onProgress: showProgress
      ? (step, status) => {
          if (status === "start") {
            if (!activeSteps.includes(step)) activeSteps.push(step);
            refreshSpinner();
            return;
          }
          if (completedSteps.has(step)) return;
          completedSteps.add(step);
          const position = activeSteps.indexOf(step);
          if (position !== -1) activeSteps.splice(position, 1);
          const marker =
            status === "done"
              ? `${stderrColors.green}✓${stderrColors.reset} ${step}`
              : status === "failed"
                ? `${stderrColors.red}✗${stderrColors.reset} ${step} ${stderrColors.dim}(could not run)${stderrColors.reset}`
                : `${stderrColors.yellow}○${stderrColors.reset} ${step} ${stderrColors.dim}(skipped)${stderrColors.reset}`;
          spinner.log(marker);
          refreshSpinner();
        }
      : undefined,
    onDebug: parsedArgs.debug
      ? (message) => {
          spinner.stop();
          console.error(`${stderrColors.dim}${message}${stderrColors.reset}`);
        }
      : undefined,
  });

  try {
    const { summary, output } = await checkAndFormat(options);

    // Make sure spinner is stopped before output
    spinner.stop();

    // Separate progress lines from the results
    if (showProgress) {
      process.stderr.write("\n");
    }

    console.log(output);

    // If --copy flag is set and there are remaining errors, copy to clipboard
    if (parsedArgs.copy && summary.results.length > 0) {
      // Always use AI format for clipboard (most useful for pasting to AI assistants)
      const clipboardContent = formatAI(summary);
      const success = await copyToClipboard(clipboardContent);

      if (success) {
        console.error(`\n${stderrColors.green}✓${stderrColors.reset} Remaining errors copied to clipboard (AI format)`);
      } else {
        console.error(`\n${stderrColors.red}✗${stderrColors.reset} Failed to copy to clipboard`);
      }
    }

    return summary.success ? EXIT.OK : EXIT.VIOLATIONS;
  } catch (error) {
    spinner.stop();
    if (error instanceof ConfigError) {
      return printConfigError(error, format);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    if (format === "json") {
      console.log(
        JSON.stringify({ success: false, error: "internal-error", exitCode: EXIT.ERROR, message }, null, 2)
      );
    }
    return EXIT.ERROR;
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

  let exitCode: number = EXIT.OK;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP_TEXT);
  } else if (command === "version" || command === "--version" || command === "-v") {
    console.log(`chaperone v${VERSION}`);
  } else if (command === "check") {
    exitCode = await runCheck(args.slice(1));
  } else if (command === "init") {
    exitCode = await runInit(args.slice(1));
  } else if (command === "analyze") {
    exitCode = await runAnalyze(args.slice(1));
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Run "chaperone help" for usage information');
    exitCode = EXIT.ERROR;
  }

  // Print update notice last, to stderr
  if (updateNotice) {
    console.error(updateNotice);
  }

  process.exit(exitCode);
}

main();
