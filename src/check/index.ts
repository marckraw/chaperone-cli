import { loadConfig, getEffectivePatterns } from "./config-loader";
import { runAllTools } from "./runners";
import { runAllRules } from "./rules";
import { format, type OutputFormat } from "./formatters";
import type { CheckOptions, CheckResult, CheckSummary, ChaperoneConfig } from "./types";
import { globSync } from "../utils/glob";

export * from "./types";
export * from "./config-loader";
export { runAllTools } from "./runners";
export { runAllRules } from "./rules";
export { format, formatText, formatJson, formatAI } from "./formatters";

/**
 * Progress callback for reporting check progress
 */
export type ProgressCallback = (step: string, status: "start" | "done" | "skipped") => void;

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
 */
export async function check(options: CheckOptionsWithProgress): Promise<CheckSummary> {
  const startTime = Date.now();
  const { cwd, configPath, fix, include, exclude, onProgress, onDebug } = options;

  // Load configuration
  onProgress?.("Loading configuration", "start");
  const config = loadConfig(cwd, configPath);
  onProgress?.("Loading configuration", "done");

  // Get effective include/exclude patterns
  const patterns = getEffectivePatterns(config, include, exclude);

  // Count total files to check
  onProgress?.("Scanning files", "start");
  const allFiles = countFilesToCheck(cwd, patterns.include, patterns.exclude);
  onProgress?.("Scanning files", "done");

  // Run TypeScript
  onProgress?.("Running TypeScript", "start");
  const toolResults = await runAllTools(config, {
    cwd,
    fix,
  });

  // Report tool results
  if (toolResults.bySource.typescript?.skipped) {
    onProgress?.("Running TypeScript", "skipped");
  } else {
    onProgress?.("Running TypeScript", "done");
  }

  if (toolResults.bySource.eslint?.skipped) {
    onProgress?.("Running ESLint", "skipped");
  } else {
    onProgress?.("Running ESLint", "start");
    onProgress?.("Running ESLint", "done");
  }

  if (toolResults.bySource.prettier?.skipped) {
    onProgress?.("Running Prettier", "skipped");
  } else {
    onProgress?.("Running Prettier", "start");
    onProgress?.("Running Prettier", "done");
  }

  // Run all custom rules
  onProgress?.("Checking custom rules", "start");
  const ruleResults = await runAllRules(config, {
    cwd,
    include: patterns.include,
    exclude: patterns.exclude,
    onDebug,
  });

  const customRulesCount = config.rules?.custom?.length ?? 0;
  if (customRulesCount === 0) {
    onProgress?.("Checking custom rules", "skipped");
  } else {
    onProgress?.("Checking custom rules", "done");
  }

  // Combine results
  const allResults: CheckResult[] = [...toolResults.results, ...ruleResults.results];

  // Calculate summary
  const totalErrors = allResults.filter((r) => r.severity === "error").length;
  const totalWarnings = allResults.filter((r) => r.severity === "warning").length;

  const summary: CheckSummary = {
    totalFiles: allFiles,
    totalErrors,
    totalWarnings,
    duration: Date.now() - startTime,
    success: totalErrors === 0,
    results: allResults,
    bySource: groupBySource(allResults),
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
  });

  return { summary, output };
}

/**
 * Count files that will be checked
 */
function countFilesToCheck(cwd: string, include: string[], exclude: string[]): number {
  const allFiles = new Set<string>();

  for (const pattern of include) {
    const files = globSync(pattern, { cwd, ignore: exclude });
    for (const file of files) {
      allFiles.add(file);
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
