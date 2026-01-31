import type { CheckResult, ToolConfig } from "../types";

/**
 * Result from a tool runner
 */
export interface RunnerResult {
  source: string;
  results: CheckResult[];
  success: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Options for running a tool
 */
export interface RunnerOptions {
  cwd: string;
  fix?: boolean;
  config?: ToolConfig;
  files?: string[];
}

/**
 * Interface that all runners must implement
 */
export interface Runner {
  name: string;
  run(options: RunnerOptions): Promise<RunnerResult>;
  isAvailable(cwd: string): Promise<boolean>;
}
