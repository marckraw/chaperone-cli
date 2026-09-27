import { resolve } from "node:path";
import { loadConfigWithDiagnostics, getEffectivePatterns } from "./config-loader";
import { runAllTools } from "./runners";
import { runAllRules, summarizeRules } from "./rules";
import { format, type OutputFormat } from "./formatters";
import type { CheckOptions, CheckResult, CheckSummary } from "./types";
import { createRuleContext } from "./rules/utils/rule-context";
import type { FileIndex } from "../utils/file-index";
import { changedFilesSince } from "../utils/git";

export * from "./types";
export * from "./config-loader";
export { formatDiagnostic, validateRule, RULE_TYPES, REMOVED_RULE_TYPES } from "./config-schema";
export { runAllTools } from "./runners";
export { runAllRules } from "./rules";
export { format, formatText, formatJson, formatAI } from "./formatters";

/**
 * Progress callback for reporting check progress.
 * Steps can overlap: tool runners and custom rules run concurrently.
 */
export type ProgressCallback = (step: string, status: "start" | "done" | "skipped" | "failed") => void;

/**
 * Debug callback for detailed output
 */
export type DebugCallback = (message: string) => void;

/**
 * Extended check options with progress callback
 */
export interface CheckOptionsWithProgress extends CheckOptions {
  onProgress?: ProgressCallback;
  onDebug?: DebugCallback;
}

/**
 * Main check function - orchestrates all checks
 *
 * @throws {ConfigError} when the configuration is invalid
 */
export async function check(options: CheckOptionsWithProgress): Promise<CheckSummary> {
  const startTime = Date.now();
  const { configPath, fix, include, exclude, since, onProgress, onDebug } = options;
  const cwd = resolve(options.cwd);

  // Load and validate configuration (throws ConfigError on invalid config)
  onProgress?.("Loading configuration", "start");
  const { config, diagnostics, disabledRules } = loadConfigWithDiagnostics(cwd, configPath);
  onProgress?.("Loading configuration", "done");

  // Get effective include/exclude patterns
  const patterns = getEffectivePatterns(config, include, exclude);

  // --since: limit file-scoped rules to changed files (throws GitError on a bad ref)
  const changedFiles = since ? await changedFilesSince(cwd, since) : undefined;

  // Walk the tree once; every rule shares this index and its content cache
  onProgress?.("Scanning files", "start");
  const context = createRuleContext(cwd, patterns.exclude, {
    useTsconfigPaths: config.integrations?.useTypescriptPaths !== false,
    changedFiles,
  });
  const totalFiles = countFilesToCheck(context.index, patterns.include, changedFiles);
  onProgress?.("Scanning files", "done");

  // Start the tool runners; they run concurrently with each other and with the rules
  const toolsPromise = runAllTools(config, {
    cwd,
    fix,
    onRunner: (runner, status) => onProgress?.(runner.label, status),
  });

  // --fix rewrites files, so rules must wait for the fixers to finish
  if (fix) {
    await toolsPromise;
  }

  const customRules = config.rules?.custom ?? [];
  const rulesStep = `Custom rules (${customRules.length})`;
  onProgress?.(rulesStep, customRules.length === 0 ? "skipped" : "start");
  const ruleResults = await runAllRules(config, {
    cwd,
    include: patterns.include,
    exclude: patterns.exclude,
    onDebug,
    context,
  });
  if (customRules.length > 0) {
    onProgress?.(rulesStep, "done");
  }

  const toolResults = await toolsPromise;
  for (const runner of toolResults.summaries) {
    onDebug?.(
      `Tool ${runner.name}: ${runner.status}${runner.reason ? ` (${runner.reason})` : ""}${
        runner.durationMs !== undefined ? ` in ${runner.durationMs}ms` : ""
      }`
    );
  }

  // Combine results
  const allResults: CheckResult[] = [...toolResults.results, ...ruleResults.results];

  // Calculate summary
  const totalErrors = allResults.filter((r) => r.severity === "error").length;
  const totalWarnings = allResults.filter((r) => r.severity === "warning").length;

  const summary: CheckSummary = {
    totalFiles,
    totalErrors,
    totalWarnings,
    duration: Date.now() - startTime,
    success: totalErrors === 0,
    results: allResults,
    bySource: groupBySource(allResults),
    diagnostics,
    runners: toolResults.summaries,
    rules: summarizeRules(customRules, ruleResults.byRule),
    disabledRules,
    since: since && changedFiles ? { ref: since, changedFiles: changedFiles.size } : undefined,
  };

  return summary;
}

/**
 * Run check and return formatted output
 */
export async function checkAndFormat(options: CheckOptionsWithProgress): Promise<{
  summary: CheckSummary;
  output: string;
}> {
  const summary = await check(options);
  const output = format(summary, options.format as OutputFormat, {
    quiet: options.quiet,
    noWarnings: options.noWarnings,
    color: options.color,
  });

  return { summary, output };
}

/**
 * Count indexed files matched by the include patterns (only changed ones with --since)
 */
function countFilesToCheck(index: FileIndex, include: string[], changedFiles?: ReadonlySet<string>): number {
  const allFiles = new Set<string>();

  for (const pattern of include) {
    for (const file of index.glob(pattern)) {
      if (!changedFiles || changedFiles.has(file)) {
        allFiles.add(file);
      }
    }
  }

  return allFiles.size;
}

/**
 * Group results by source
 */
function groupBySource(results: CheckResult[]): Record<string, CheckResult[]> {
  const groups: Record<string, CheckResult[]> = {};

  for (const result of results) {
    const source = result.source ?? "unknown";
    if (!groups[source]) {
      groups[source] = [];
    }
    groups[source].push(result);
  }

  return groups;
}

/**
 * Create default check options
 */
export function createCheckOptions(overrides: Partial<CheckOptionsWithProgress> = {}): CheckOptionsWithProgress {
  return {
    cwd: process.cwd(),
    format: "text",
    fix: false,
    quiet: false,
    ...overrides,
  };
}
