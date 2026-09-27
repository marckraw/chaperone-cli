import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConfigError, loadConfigWithDiagnostics } from "../check/config-loader";
import { formatDiagnostic, validateRule } from "../check/config-schema";
import { detectAIInstructionFiles } from "../check/rules/ai-instructions";
import { DEFAULT_CONFIG, type ChaperoneConfig, type CustomRule } from "../check/types";
import { countAIRules, mergeRulesIntoRawConfig, type RawConfig, type SkippedRule } from "./config-merger";
import { extractRulesFromInstructions } from "./llm-client";
import type { AnalyzeOptions, AnalyzeResult, SkippedInstruction } from "./types";
import { EXIT, parseArgs, UsageError } from "../utils/args";

const CONFIG_FILENAME = ".chaperone.json";

/**
 * Read the user's config file as written. Never falls back to a default: an unreadable
 * or invalid file stops analyze before anything is written.
 */
function readRawConfig(configFile: string, label: string): RawConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configFile, "utf-8"));
  } catch (error) {
    throw new ConfigError([
      {
        level: "error",
        source: label,
        message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError([{ level: "error", source: label, message: "config must be a JSON object" }]);
  }
  return parsed as RawConfig;
}

/**
 * Validate extracted rules with the same schema `chaperone check` uses.
 */
function validateExtracted(rules: unknown[]): { valid: CustomRule[]; invalid: SkippedInstruction[] } {
  const valid: CustomRule[] = [];
  const invalid: SkippedInstruction[] = [];

  rules.forEach((rule, index) => {
    const { diagnostics, rule: normalized } = validateRule(rule, "extracted rules", ["rules", index]);
    const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
    if (normalized && errors.length === 0) {
      valid.push(normalized);
      return;
    }
    const raw = rule as { id?: unknown; originalText?: unknown };
    invalid.push({
      text: typeof raw?.originalText === "string" ? raw.originalText : String(raw?.id ?? `rule #${index}`),
      reason: `Invalid rule: ${errors.map((diagnostic) => formatDiagnostic(diagnostic)).join("; ")}`,
    });
  });

  return { valid, invalid };
}

/**
 * Run the analyze command.
 *
 * Only the user's own config file is patched: `extends` and every other field are kept,
 * presets are never inlined, and nothing is written when the config fails to load.
 *
 * @throws {ConfigError} when the existing configuration is invalid (nothing is written)
 */
export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { cwd, configPath, dryRun, force, verbose, apiKey } = options;
  const extract = options.extract ?? extractRulesFromInstructions;

  const log = verbose ? (msg: string) => console.log(`  ${msg}`) : () => {};

  const configFile = configPath ? resolve(cwd, configPath) : join(cwd, CONFIG_FILENAME);
  const label = configPath ?? CONFIG_FILENAME;

  // Load the existing configuration; any error aborts before the LLM call and before writing.
  log("Loading configuration...");
  let raw: RawConfig | null = null;
  let merged: ChaperoneConfig = DEFAULT_CONFIG;
  if (existsSync(configFile)) {
    raw = readRawConfig(configFile, label);
    merged = loadConfigWithDiagnostics(cwd, configFile).config;
  } else {
    log(`No config at ${label}; a new one will be created`);
  }

  log(`Found ${countAIRules(raw ?? {})} existing AI-extracted rules`);

  // Detect AI instruction files
  log("Detecting AI instruction files...");
  const aiFiles = detectAIInstructionFiles(cwd, merged.aiInstructions);

  if (aiFiles.length === 0) {
    return {
      success: true,
      extractedRules: [],
      addedRules: [],
      skippedRules: [],
      skippedInstructions: [],
      summary: "No AI instruction files found.",
      aiFiles: [],
      configPath: configFile,
      written: false,
    };
  }

  log(`Found ${aiFiles.length} AI instruction file(s):`);
  for (const file of aiFiles) {
    log(`  - ${file.name} (${file.tool})`);
  }

  // Extract rules using LLM
  log("Extracting rules using Claude...");
  const response = await extract(aiFiles, { apiKey, verbose, onProgress: log });

  // Validate extracted rules with the full config schema
  log("Validating extracted rules...");
  const { valid, invalid } = validateExtracted(response.rules as unknown[]);
  for (const entry of invalid) {
    log(`Warning: ${entry.reason}`);
  }
  log(`Extracted ${valid.length} valid rules`);

  // Merge into the user's own file; ids inherited from presets are not reused
  const ownIds = new Set(
    ((raw?.["rules"] as { custom?: unknown } | undefined)?.custom as Array<{ id?: unknown }> | undefined ?? [])
      .map((rule) => rule?.id)
      .filter((id): id is string => typeof id === "string")
  );
  const inheritedIds = new Set(
    (merged.rules?.custom ?? []).map((rule) => rule.id).filter((id) => !ownIds.has(id))
  );

  log(force ? "Replacing existing AI rules..." : "Merging with existing rules...");
  const { config: patched, added, skipped } = mergeRulesIntoRawConfig(raw, valid, { force, inheritedIds });
  log(`Added: ${added.length}, Skipped: ${skipped.length}`);

  // Write config if not dry-run
  let written = false;
  if (!dryRun && added.length > 0) {
    log(`Writing configuration to ${configFile}...`);
    writeFileSync(configFile, JSON.stringify(patched, null, 2) + "\n", "utf-8");
    written = true;
  }

  return {
    success: true,
    extractedRules: valid,
    addedRules: added,
    skippedRules: skipped,
    skippedInstructions: [...(response.skipped ?? []), ...invalid],
    summary: response.summary,
    aiFiles,
    configPath: configFile,
    written,
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
    lines.push("Rules Skipped:");
    for (const { rule, reason } of result.skippedRules) {
      lines.push(`  \x1b[33m○\x1b[0m ${rule.id} \x1b[2m(${reason})\x1b[0m`);
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
  } else if (result.written) {
    lines.push(`\x1b[32m✓\x1b[0m ${result.configPath} updated with ${result.addedRules.length} new rule(s).`);
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
  let options: ReturnType<typeof parseAnalyzeArgs>;
  try {
    options = parseAnalyzeArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}`);
      console.error('Run "chaperone analyze --help" for usage information.');
      return EXIT.ERROR;
    }
    throw error;
  }

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

    return result.success ? EXIT.OK : EXIT.ERROR;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\x1b[31mError:\x1b[0m ${error.message}`);
      console.error("");
      console.error("The configuration was not changed. Fix it first (chaperone check lists every problem).");
      return EXIT.ERROR;
    }
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

    return EXIT.ERROR;
  }
}

function parseAnalyzeArgs(args: string[]) {
  return parseArgs(args, {
    help: { names: ["--help", "-h"], type: "boolean" },
    config: { names: ["--config", "-c"], type: "string" },
    cwd: { names: ["--cwd"], type: "string" },
    dryRun: { names: ["--dry-run"], type: "boolean" },
    force: { names: ["--force"], type: "boolean" },
    verbose: { names: ["--verbose", "-v"], type: "boolean" },
    apiKey: { names: ["--api-key"], type: "string" },
  });
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
export type { SkippedRule } from "./config-merger";
