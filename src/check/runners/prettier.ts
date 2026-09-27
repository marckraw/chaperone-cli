import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { execCommand, findBinary, type ExecResult } from "../../utils/process";
import { findConfigFile, packageJsonHasKey, PRETTIER_CONFIG_FILES } from "../../utils/tool-configs";
import type { CheckResult } from "../types";
import {
  DEFAULT_RUNNER_TIMEOUT_MS,
  runnerFailure,
  type Runner,
  type RunnerAvailability,
  type RunnerOptions,
  type RunnerResult,
} from "./types";

const SUMMARY_LINE =
  /^(Checking formatting|All matched files use Prettier|Code style issues|Error occurred when checking code style)/i;

/**
 * Parse `prettier --check` output (stdout and stderr combined).
 *
 * Prettier 3 prints `[warn] path` for each unformatted file and `[error] path: message`
 * for files it cannot parse, on stderr. Older versions printed bare paths.
 */
export function parsePrettierOutput(output: string, cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const seen = new Set<string>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const tagged = /^\[(warn|error)\]\s+(.*)$/.exec(line);
    const level = tagged?.[1];
    const body = (tagged ? tagged[2]! : line).trim();
    if (!body || SUMMARY_LINE.test(body)) continue;

    if (level === "error") {
      // "[error] src/a.ts: SyntaxError: ..." (continuation lines have no file prefix)
      const separator = body.indexOf(": ");
      const file = separator > 0 ? body.slice(0, separator) : "";
      if (file && existsSync(isAbsolute(file) ? file : join(cwd, file))) {
        results.push({
          file: isAbsolute(file) ? relative(cwd, file) : file,
          rule: "prettier/syntax-error",
          message: body.slice(separator + 2),
          severity: "error",
          source: "prettier",
        });
      }
      continue;
    }

    const file = isAbsolute(body) ? relative(cwd, body) : body;
    if (!seen.has(file) && existsSync(join(cwd, file))) {
      seen.add(file);
      results.push({
        file,
        rule: "prettier/format",
        message: "File is not formatted according to Prettier rules",
        severity: "warning",
        source: "prettier",
        fixable: true,
      });
    }
  }

  return results;
}

/**
 * Turn a finished Prettier process into a runner result. Fails closed: exit code 2,
 * or a non-zero exit without any file reported, is an error, never a pass.
 */
export function interpretPrettierRun(
  execResult: ExecResult,
  cwd: string,
  command: string,
  fix = false
): RunnerResult {
  const results = parsePrettierOutput(`${execResult.stdout}\n${execResult.stderr}`, cwd);
  const reported = fix ? results.filter((result) => result.severity === "error") : results;

  const failure = (reason: string): RunnerResult => ({
    source: "prettier",
    results: [
      ...reported,
      runnerFailure({
        source: "prettier",
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

  if (execResult.timedOut) return failure("Prettier timed out");
  if (execResult.spawnError) return failure(`Prettier could not be started: ${execResult.spawnError}`);
  if (execResult.exitCode === 2 && !reported.some((result) => result.severity === "error")) {
    return failure("Prettier exited with code 2 (something went wrong)");
  }
  if (execResult.exitCode !== 0 && reported.length === 0) {
    return failure(`Prettier exited with code ${execResult.exitCode} without reporting any file`);
  }

  return {
    source: "prettier",
    results: reported,
    success: execResult.exitCode === 0,
  };
}

function hasPrettierConfig(cwd: string): boolean {
  return findConfigFile(cwd, PRETTIER_CONFIG_FILES) !== null || packageJsonHasKey(cwd, "prettier");
}

/**
 * Prettier runner
 */
export const prettierRunner: Runner = {
  name: "prettier",
  label: "Prettier",

  detect(cwd: string): RunnerAvailability {
    if (!hasPrettierConfig(cwd)) {
      return { available: false, reason: "no Prettier config in the project root" };
    }
    const binary = findBinary("prettier", cwd);
    if (!binary) {
      return {
        available: false,
        reason: "Prettier config found, but no prettier binary (looked in node_modules/.bin and PATH)",
      };
    }
    return { available: true, binary };
  },

  async isAvailable(cwd: string): Promise<boolean> {
    return this.detect(cwd).available;
  },

  async run(options: RunnerOptions): Promise<RunnerResult> {
    const { cwd, fix, config, files } = options;
    const binary = options.binary ?? findBinary("prettier", cwd);
    if (!binary) {
      return { source: "prettier", results: [], success: true, skipped: true, skipReason: "no prettier binary found" };
    }

    const args = [fix ? "--write" : "--check", ...(config?.args ?? [])];
    args.push(...(files && files.length > 0 ? files : ["."]));

    const execResult = await execCommand(binary, args, {
      cwd,
      timeout: options.timeoutMs ?? DEFAULT_RUNNER_TIMEOUT_MS,
    });

    return interpretPrettierRun(execResult, cwd, ["prettier", ...args].join(" "), fix);
  },
};
