import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../check/config-loader";
import { detectAIInstructionFiles } from "../check/rules/ai-instructions";
import type { ChaperoneConfig, CustomRule } from "../check/types";
import { mergeRules, countAIRules } from "./config-merger";
import { extractRulesFromInstructions, validateExtractedRules } from "./llm-client";
import type { AnalyzeOptions, AnalyzeResult } from "./types";

const CONFIG_FILENAME = ".chaperone.json";

/**
 * Run the analyze command
 */
export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { cwd, configPath, dryRun, force, verbose, apiKey } = options;

  const log = verbose ? (msg: string) => console.log(`  ${msg}`) : () => {};

  // Load existing config
  log("Loading configuration...");
  let config: ChaperoneConfig;
  try {
    config = loadConfig(cwd, configPath);
  } catch {
    // If no config exists, create a minimal one
    config = { version: "1.0.0", rules: { custom: [] } };
  }

  const existingAIRules = countAIRules(config);
  log(`Found ${existingAIRules} existing AI-extracted rules`);

  // Detect AI instruction files
  log("Detecting AI instruction files...");
  const aiFiles = detectAIInstructionFiles(cwd, config.aiInstructions);

  if (aiFiles.length === 0) {
    return {
      success: true,
      extractedRules: [],
      addedRules: [],
      skippedRules: [],
      skippedInstructions: [],
      summary: "No AI instruction files found.",
      aiFiles: [],
    };
  }

  log(`Found ${aiFiles.length} AI instruction file(s):`);
  for (const file of aiFiles) {
    log(`  - ${file.name} (${file.tool})`);
  }

  // Extract rules using LLM
  log("Extracting rules using Claude...");
  const rawResponse = await extractRulesFromInstructions(aiFiles, {
    apiKey,
    verbose,
    onProgress: log,
  });

  // Validate extracted rules
  log("Validating extracted rules...");
  const response = validateExtractedRules(rawResponse, log);

  log(`Extracted ${response.rules.length} valid rules`);

  // Merge with existing config
  log(force ? "Replacing existing AI rules..." : "Merging with existing rules...");
  const { config: newConfig, added, skipped } = mergeRules(
    config,
    response.rules as CustomRule[],
    force
  );

  log(`Added: ${added.length}, Skipped (duplicate IDs): ${skipped.length}`);

  // Write config if not dry-run
  if (!dryRun && added.length > 0) {
    const configFile = configPath ?? join(cwd, CONFIG_FILENAME);
    log(`Writing configuration to ${configFile}...`);
    writeFileSync(configFile, JSON.stringify(newConfig, null, 2) + "\n", "utf-8");
  }

  return {
    success: true,
    extractedRules: response.rules as CustomRule[],
    addedRules: added,
    skippedRules: skipped,
    skippedInstructions: response.skipped ?? [],
    summary: response.summary,
    aiFiles,
  };
}

/**
 * Format analyze result for display
 */
export function formatAnalyzeResult(result: AnalyzeResult, dryRun: boolean): string {
  const lines: string[] = [];

  if (result.aiFiles.length === 0) {
    lines.push("No AI instruction files found.");
    lines.push("");
    lines.push("Expected files:");
    lines.push("  - CLAUDE.md");
    lines.push("  - AGENTS.md");
    lines.push("  - GEMINI.md");
    lines.push("  - CODEX.md");
    lines.push("  - .cursorrules");
    lines.push("  - .github/copilot-instructions.md");
    lines.push("  - .instructions.md");
    return lines.join("\n");
  }

  lines.push("AI Instruction Files Analyzed:");
  for (const file of result.aiFiles) {
    lines.push(`  \x1b[36m${file.name}\x1b[0m (${file.tool})`);
  }
  lines.push("");

  lines.push(`Extracted Rules: \x1b[33m${result.extractedRules.length}\x1b[0m`);

  if (result.addedRules.length > 0) {
    lines.push("");
    lines.push(dryRun ? "Rules that would be added:" : "Rules Added:");
    for (const rule of result.addedRules) {
      const typeColor = rule.source ? "\x1b[35m" : "\x1b[34m";
      lines.push(`  \x1b[32m+\x1b[0m ${typeColor}[${rule.type}]\x1b[0m ${rule.id}`);
      if ("message" in rule && rule.message) {
        lines.push(`    ${rule.message}`);
      }
    }
  }

  if (result.skippedRules.length > 0) {
    lines.push("");
    lines.push("Rules Skipped (already exist):");
    for (const rule of result.skippedRules) {
      lines.push(`  \x1b[33m○\x1b[0m ${rule.id}`);
    }
  }

  if (result.skippedInstructions.length > 0) {
    lines.push("");
    lines.push("Instructions Not Converted:");
    for (const item of result.skippedInstructions.slice(0, 5)) {
      lines.push(`  \x1b[2m- ${truncate(item.text, 60)}\x1b[0m`);
      lines.push(`    \x1b[2mReason: ${item.reason}\x1b[0m`);
    }
    if (result.skippedInstructions.length > 5) {
      lines.push(`  \x1b[2m... and ${result.skippedInstructions.length - 5} more\x1b[0m`);
    }
  }

  lines.push("");
  if (dryRun) {
    lines.push("\x1b[33mDry run - no changes written.\x1b[0m");
    lines.push("Run without --dry-run to save changes.");
  } else if (result.addedRules.length > 0) {
    lines.push(`\x1b[32m✓\x1b[0m Configuration updated with ${result.addedRules.length} new rule(s).`);
  } else {
    lines.push("No new rules to add.");
  }

  return lines.join("\n");
}

/**
 * Truncate a string to a maximum length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * CLI entry point for analyze command
 */
export async function runAnalyze(args: string[]): Promise<number> {
  const options = parseAnalyzeArgs(args);

  if (options.help) {
    console.log(ANALYZE_HELP_TEXT);
    return 0;
  }

  console.log("\x1b[1mChaperone Analyze\x1b[0m - Extract rules from AI instruction files\n");

  try {
    const result = await analyze({
      cwd: options.cwd ?? process.cwd(),
      configPath: options.config,
      dryRun: options.dryRun,
      force: options.force,
      verbose: options.verbose,
      apiKey: options.apiKey,
    });

    console.log(formatAnalyzeResult(result, options.dryRun ?? false));

    return result.success ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("ANTHROPIC_API_KEY")) {
      console.error(`\x1b[31mError:\x1b[0m ${message}`);
      console.error("");
      console.error("To set the API key:");
      console.error("  export ANTHROPIC_API_KEY=your-key-here");
      console.error("  chaperone analyze");
      console.error("");
      console.error("Or pass it directly:");
      console.error("  ANTHROPIC_API_KEY=your-key-here chaperone analyze");
    } else if (message.includes("rate_limit")) {
      console.error("\x1b[31mError:\x1b[0m API rate limit exceeded.");
      console.error("Please wait a moment and try again.");
    } else {
      console.error(`\x1b[31mError:\x1b[0m ${message}`);
    }

    return 1;
  }
}

interface AnalyzeArgs {
  config?: string;
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  apiKey?: string;
  help?: boolean;
}

function parseAnalyzeArgs(args: string[]): AnalyzeArgs {
  const result: AnalyzeArgs = {};

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

      case "--dry-run":
        result.dryRun = true;
        break;

      case "--force":
        result.force = true;
        break;

      case "--verbose":
      case "-v":
        result.verbose = true;
        break;

      case "--api-key":
        result.apiKey = args[++i];
        break;
    }
  }

  return result;
}

const ANALYZE_HELP_TEXT = `
chaperone analyze - Extract rules from AI instruction files

USAGE:
  chaperone analyze [options]

DESCRIPTION:
  Analyzes AI instruction files (CLAUDE.md, AGENTS.md, etc.) and extracts
  enforceable rules using Claude. Extracted rules are written to .chaperone.json.

OPTIONS:
  --config, -c <path>   Config file path (default: .chaperone.json)
  --cwd <path>          Working directory (default: current directory)
  --dry-run             Preview extracted rules without saving
  --force               Replace existing AI-extracted rules
  --verbose, -v         Show detailed output
  --api-key <key>       Anthropic API key (or use ANTHROPIC_API_KEY env var)
  --help, -h            Show this help message

ENVIRONMENT:
  ANTHROPIC_API_KEY     Required. Your Anthropic API key for Claude.

EXAMPLES:
  chaperone analyze                     Extract and add new rules
  chaperone analyze --dry-run           Preview without saving
  chaperone analyze --force             Replace existing AI-extracted rules
  chaperone analyze --verbose           Show detailed output

AI INSTRUCTION FILES:
  The following files are detected automatically:
  - CLAUDE.md              Claude Code
  - AGENTS.md              Universal (OpenAI Codex, Copilot, Cursor, Jules)
  - GEMINI.md              Gemini CLI
  - CODEX.md               OpenAI Codex
  - .cursorrules           Cursor (legacy)
  - .github/copilot-instructions.md    GitHub Copilot
  - .instructions.md       GitHub Copilot Agent
`;

// Re-export types
export type { AnalyzeOptions, AnalyzeResult, SkippedInstruction } from "./types";
