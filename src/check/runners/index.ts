import type { ChaperoneConfig, CheckResult, RunnerSummary, ToolConfig } from "../types";
import type { Runner, RunnerOptions, RunnerResult } from "./types";
import { typescriptRunner } from "./typescript";
import { eslintRunner } from "./eslint";
import { prettierRunner } from "./prettier";

export * from "./types";
export { typescriptRunner, parseTypeScriptOutput, interpretTypeScriptRun } from "./typescript";
export { eslintRunner, parseESLintOutput, interpretESLintRun } from "./eslint";
export { prettierRunner, parsePrettierOutput, interpretPrettierRun } from "./prettier";

/**
 * All available runners
 */
const runners: Runner[] = [typescriptRunner, eslintRunner, prettierRunner];

/**
 * Result from running all tools
 */
export interface AllRunnersResult {
  results: CheckResult[];
  bySource: Record<string, RunnerResult>;
  /** One entry per runner, in a stable order */
  summaries: RunnerSummary[];
  success: boolean;
}

/**
 * Lifecycle callback for a single runner
 */
export type RunnerProgress = (runner: Runner, status: "start" | "done" | "skipped" | "failed") => void;

/**
 * Get tool config for a runner
 */
function getToolConfig(config: ChaperoneConfig, runnerName: string): ToolConfig | undefined {
  const rules = config.rules;
  if (!rules) return undefined;

  switch (runnerName) {
    case "typescript":
      return rules.typescript;
    case "eslint":
      return rules.eslint;
    case "prettier":
      return rules.prettier;
    default:
      return undefined;
  }
}

function summarize(runner: Runner, result: RunnerResult): RunnerSummary {
  const errors = result.results.filter((entry) => entry.severity === "error").length;
  const warnings = result.results.filter((entry) => entry.severity === "warning").length;
  const status: RunnerSummary["status"] = result.skipped
    ? "skipped"
    : result.error
      ? "error"
      : errors > 0
        ? "failed"
        : "passed";

  return {
    name: runner.name,
    label: runner.label,
    status,
    reason: result.skipped ? result.skipReason : result.error,
    durationMs: result.durationMs,
    errors,
    warnings,
  };
}

async function runOne(
  runner: Runner,
  config: ChaperoneConfig,
  options: Omit<RunnerOptions, "config">,
  onRunner?: RunnerProgress
): Promise<RunnerResult> {
  const toolConfig = getToolConfig(config, runner.name);

  if (toolConfig?.enabled === false) {
    onRunner?.(runner, "skipped");
    return {
      source: runner.name,
      results: [],
      success: true,
      skipped: true,
      skipReason: `disabled in config (rules.${runner.name}.enabled: false)`,
    };
  }

  const availability = runner.detect(options.cwd, toolConfig);
  if (!availability.available) {
    onRunner?.(runner, "skipped");
    return {
      source: runner.name,
      results: [],
      success: true,
      skipped: true,
      skipReason: availability.reason,
    };
  }

  onRunner?.(runner, "start");
  const startedAt = Date.now();
  let result: RunnerResult;
  try {
    result = await runner.run({ ...options, binary: availability.binary, config: toolConfig });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      source: runner.name,
      results: [
        {
          file: "",
          rule: `${runner.name}/runner-error`,
          message: `${runner.label} runner crashed: ${message}`,
          severity: "error",
          source: runner.name,
        },
      ],
      success: false,
      error: `${runner.label} runner crashed: ${message}`,
    };
  }
  result.durationMs = Date.now() - startedAt;
  onRunner?.(runner, result.skipped ? "skipped" : result.error ? "failed" : "done");
  return result;
}

/**
 * Run all enabled tool runners concurrently
 */
export async function runAllTools(
  config: ChaperoneConfig,
  options: Omit<RunnerOptions, "config"> & { onRunner?: RunnerProgress }
): Promise<AllRunnersResult> {
  const { onRunner, ...runnerOptions } = options;
  const finished = await Promise.all(
    runners.map((runner) => runOne(runner, config, runnerOptions, onRunner))
  );

  const bySource: Record<string, RunnerResult> = {};
  const results: CheckResult[] = [];
  const summaries: RunnerSummary[] = [];

  runners.forEach((runner, index) => {
    const result = finished[index]!;
    bySource[runner.name] = result;
    results.push(...result.results);
    summaries.push(summarize(runner, result));
  });

  return {
    results,
    bySource,
    summaries,
    success: finished.every((result) => result.success || result.skipped === true),
  };
}

/**
 * Get list of available runners
 */
export function getAvailableRunners(): Runner[] {
  return [...runners];
}
