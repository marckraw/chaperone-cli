import type { CheckResult, ToolConfig } from "../types";

/**
 * Result from a tool runner
 */
export interface RunnerResult {
  source: string;
  results: CheckResult[];
  success: boolean;
  skipped?: boolean;
  /** Why the runner did not run (set when skipped) */
  skipReason?: string;
  /** Why the runner failed to produce a trustworthy result */
  error?: string;
  durationMs?: number;
}

/**
 * Options for running a tool
 */
export interface RunnerOptions {
  cwd: string;
  fix?: boolean;
  config?: ToolConfig;
  files?: string[];
  /** Resolved executable (from {@link Runner.detect}) */
  binary?: string;
  /** Kill the tool after this many milliseconds (default: 10 minutes) */
  timeoutMs?: number;
}

/**
 * Whether a runner can run in a project, and why not.
 */
export type RunnerAvailability =
  | { available: true; binary: string }
  | { available: false; reason: string };

/**
 * Interface that all runners must implement
 */
export interface Runner {
  name: string;
  /** Human-readable name, e.g. "TypeScript" */
  label: string;
  detect(cwd: string, config?: ToolConfig): RunnerAvailability;
  run(options: RunnerOptions): Promise<RunnerResult>;
  /** @deprecated use detect() */
  isAvailable(cwd: string): Promise<boolean>;
}

export const DEFAULT_RUNNER_TIMEOUT_MS = 10 * 60 * 1000;

const MAX_OUTPUT_IN_RESULT = 4000;

/**
 * Trim tool output for display in a result's context.
 */
export function outputTail(stdout: string, stderr: string): string | undefined {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  if (!combined) return undefined;
  if (combined.length <= MAX_OUTPUT_IN_RESULT) return combined;
  return `... output truncated ...\n${combined.slice(-MAX_OUTPUT_IN_RESULT)}`;
}

/**
 * A single error result for a runner that could not produce a trustworthy answer.
 * Fail closed: an unexplained non-zero exit is never reported as a pass.
 */
export function runnerFailure(params: {
  source: string;
  message: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  file?: string;
}): CheckResult {
  return {
    file: params.file ?? "",
    rule: `${params.source}/runner-error`,
    message: params.message,
    severity: "error",
    source: params.source,
    suggestion: `Run it directly for details: ${params.command}`,
    context: {
      command: params.command,
      exitCode: params.exitCode,
      commandOutput: outputTail(params.stdout, params.stderr),
    },
  };
}
