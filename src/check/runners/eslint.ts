import { relative } from "node:path";
import { execCommand, findBinary, type ExecResult } from "../../utils/process";
import {
  ESLINT_FLAT_CONFIG_FILES,
  ESLINT_LEGACY_CONFIG_FILES,
  findConfigFile,
  packageJsonHasKey,
} from "../../utils/tool-configs";
import type { CheckResult } from "../types";
import {
  DEFAULT_RUNNER_TIMEOUT_MS,
  runnerFailure,
  type Runner,
  type RunnerAvailability,
  type RunnerOptions,
  type RunnerResult,
} from "./types";

/**
 * ESLint JSON output format
 */
interface ESLintMessage {
  ruleId: string | null;
  severity: 0 | 1 | 2;
  message: string;
  line?: number;
  column?: number;
  fatal?: boolean;
  fix?: {
    range: [number, number];
    text: string;
  };
}

interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
}

/**
 * Parse ESLint `--format json` output. Returns null when the output is not ESLint JSON.
 */
export function parseESLintOutput(output: string, cwd: string): CheckResult[] | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith("[")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }

  const results: CheckResult[] = [];
  for (const file of parsed as ESLintFileResult[]) {
    const relativePath = relative(cwd, file.filePath);
    for (const msg of file.messages ?? []) {
      if (msg.severity === 0) continue;
      results.push({
        file: relativePath,
        line: msg.line,
        column: msg.column,
        rule: `eslint/${msg.ruleId ?? (msg.fatal ? "parse-error" : "unknown")}`,
        message: msg.message,
        severity: msg.severity === 2 || msg.fatal ? "error" : "warning",
        source: "eslint",
        fixable: !!msg.fix,
      });
    }
  }
  return results;
}

/**
 * Turn a finished ESLint process into a runner result. Fails closed: exit code 2
 * (configuration or internal error) or unparseable output is an error, never a pass.
 */
export function interpretESLintRun(execResult: ExecResult, cwd: string, command: string): RunnerResult {
  const results = parseESLintOutput(execResult.stdout, cwd);

  const failure = (reason: string): RunnerResult => ({
    source: "eslint",
    results: [
      runnerFailure({
        source: "eslint",
        message: reason,
        command,
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      }),
    ],
    success: false,
    error: reason,
  });

  if (execResult.timedOut) {
    return failure("ESLint timed out");
  }
  if (execResult.spawnError) {
    return failure(`ESLint could not be started: ${execResult.spawnError}`);
  }
  if (execResult.exitCode === 2) {
    return failure("ESLint exited with code 2 (configuration or internal error)");
  }
  if (results === null) {
    if (execResult.exitCode === 0 && execResult.stdout.trim() === "") {
      return { source: "eslint", results: [], success: true };
    }
    return failure(`ESLint exited with code ${execResult.exitCode} and its output could not be parsed`);
  }
  if (execResult.exitCode !== 0 && results.length === 0) {
    return failure(`ESLint exited with code ${execResult.exitCode} without reporting any problems`);
  }

  return {
    source: "eslint",
    results,
    success: results.every((result) => result.severity !== "error"),
  };
}

function detectESLintConfig(cwd: string): string | null {
  return (
    findConfigFile(cwd, ESLINT_FLAT_CONFIG_FILES) ??
    findConfigFile(cwd, ESLINT_LEGACY_CONFIG_FILES) ??
    (packageJsonHasKey(cwd, "eslintConfig") ? "package.json" : null)
  );
}

/**
 * ESLint runner
 */
export const eslintRunner: Runner = {
  name: "eslint",
  label: "ESLint",

  detect(cwd: string): RunnerAvailability {
    if (!detectESLintConfig(cwd)) {
      return { available: false, reason: "no ESLint config in the project root" };
    }
    const binary = findBinary("eslint", cwd);
    if (!binary) {
      return {
        available: false,
        reason: "ESLint config found, but no eslint binary (looked in node_modules/.bin and PATH)",
      };
    }
    return { available: true, binary };
  },

  async isAvailable(cwd: string): Promise<boolean> {
    return this.detect(cwd).available;
  },

  async run(options: RunnerOptions): Promise<RunnerResult> {
    const { cwd, fix, config, files } = options;
    const binary = options.binary ?? findBinary("eslint", cwd);
    if (!binary) {
      return { source: "eslint", results: [], success: true, skipped: true, skipReason: "no eslint binary found" };
    }

    const args = ["--format", "json"];
    if (fix) {
      args.push("--fix");
    }
    args.push(...(config?.args ?? []));
    args.push(...(files && files.length > 0 ? files : ["."]));

    const execResult = await execCommand(binary, args, {
      cwd,
      timeout: options.timeoutMs ?? DEFAULT_RUNNER_TIMEOUT_MS,
    });

    return interpretESLintRun(execResult, cwd, ["eslint", ...args].join(" "));
  },
};
