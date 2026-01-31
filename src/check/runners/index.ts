import type { ChaperoneConfig, CheckResult, ToolConfig } from "../types";
import type { Runner, RunnerOptions, RunnerResult } from "./types";
import { typescriptRunner } from "./typescript";
import { eslintRunner } from "./eslint";
import { prettierRunner } from "./prettier";

export * from "./types";
export { typescriptRunner } from "./typescript";
export { eslintRunner } from "./eslint";
export { prettierRunner } from "./prettier";

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
  success: boolean;
}

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

/**
 * Run all enabled tool runners
 */
export async function runAllTools(
  config: ChaperoneConfig,
  options: Omit<RunnerOptions, "config">
): Promise<AllRunnersResult> {
  const { cwd, fix, files } = options;
  const allResults: CheckResult[] = [];
  const bySource: Record<string, RunnerResult> = {};
  let allSuccess = true;

  for (const runner of runners) {
    const toolConfig = getToolConfig(config, runner.name);

    // Skip if explicitly disabled
    if (toolConfig?.enabled === false) {
      bySource[runner.name] = {
        source: runner.name,
        results: [],
        success: true,
        skipped: true,
      };
      continue;
    }

    // Check if tool is available
    const available = await runner.isAvailable(cwd);
    if (!available) {
      bySource[runner.name] = {
        source: runner.name,
        results: [],
        success: true,
        skipped: true,
      };
      continue;
    }

    // Run the tool
    const result = await runner.run({
      cwd,
      fix,
      files,
      config: toolConfig,
    });

    bySource[runner.name] = result;
    allResults.push(...result.results);

    if (!result.success && !result.skipped) {
      allSuccess = false;
    }
  }

  return {
    results: allResults,
    bySource,
    success: allSuccess,
  };
}

/**
 * Get list of available runners
 */
export function getAvailableRunners(): Runner[] {
  return [...runners];
}
