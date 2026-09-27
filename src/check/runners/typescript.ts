import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc } from "../../utils/jsonc";
import { execCommand, findBinary, type ExecResult } from "../../utils/process";
import { findConfigFile, TYPESCRIPT_CONFIG_FILES } from "../../utils/tool-configs";
import type { CheckResult, ToolConfig } from "../types";
import {
  DEFAULT_RUNNER_TIMEOUT_MS,
  runnerFailure,
  type Runner,
  type RunnerAvailability,
  type RunnerOptions,
  type RunnerResult,
} from "./types";

// file(line,col): error TSxxxx: message
const LOCATED_DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/;
// error TSxxxx: message (global diagnostics such as TS18003 "No inputs were found")
const GLOBAL_DIAGNOSTIC = /^(error|warning)\s+(TS\d+):\s*(.*)$/;

/**
 * Parse `tsc --pretty false` output. Indented continuation lines are appended
 * to the preceding diagnostic's message.
 */
export function parseTypeScriptOutput(output: string): CheckResult[] {
  const results: CheckResult[] = [];

  for (const line of output.split(/\r?\n/)) {
    const located = LOCATED_DIAGNOSTIC.exec(line);
    if (located) {
      const [, file, lineNumber, column, severity, code, message] = located;
      results.push({
        file: file!.trim(),
        line: Number.parseInt(lineNumber!, 10),
        column: Number.parseInt(column!, 10),
        rule: `typescript/${code}`,
        message: message!.trim(),
        severity: severity === "error" ? "error" : "warning",
        source: "typescript",
      });
      continue;
    }

    const global = GLOBAL_DIAGNOSTIC.exec(line.trim());
    if (global) {
      const [, severity, code, message] = global;
      results.push({
        file: "tsconfig.json",
        rule: `typescript/${code}`,
        message: message!.trim(),
        severity: severity === "error" ? "error" : "warning",
        source: "typescript",
      });
      continue;
    }

    const previous = results[results.length - 1];
    if (previous && /^\s+\S/.test(line)) {
      previous.message = `${previous.message}\n${line.trim()}`;
    }
  }

  return results;
}

/**
 * Turn a finished tsc process into a runner result. Fails closed: a non-zero exit
 * without parseable diagnostics is an error, never a pass.
 */
export function interpretTypeScriptRun(execResult: ExecResult, command: string): RunnerResult {
  const results = parseTypeScriptOutput(`${execResult.stdout}\n${execResult.stderr}`);

  if (execResult.exitCode !== 0 && results.length === 0) {
    const reason = execResult.timedOut
      ? "tsc timed out"
      : execResult.spawnError
        ? `tsc could not be started: ${execResult.spawnError}`
        : `tsc exited with code ${execResult.exitCode} without reporting any diagnostics`;
    return {
      source: "typescript",
      results: [
        runnerFailure({
          source: "typescript",
          message: reason,
          command,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          file: "tsconfig.json",
        }),
      ],
      success: false,
      error: reason,
    };
  }

  return {
    source: "typescript",
    results,
    success: results.every((result) => result.severity !== "error"),
  };
}

const PROJECT_ARGS = new Set(["-p", "--project", "-b", "--build"]);

/**
 * A "solution-style" tsconfig (`"files": []` plus `references`, as in the Vite
 * templates) contains no files of its own: `tsc --noEmit` would type-check nothing
 * and exit 0. Returns true for such a config unless the user points tsc elsewhere.
 */
export function checksNothing(tsconfigText: string, args: readonly string[] = []): boolean {
  if (args.some((arg) => PROJECT_ARGS.has(arg) || arg.startsWith("--project="))) {
    return false;
  }
  let raw: unknown;
  try {
    raw = parseJsonc(tsconfigText);
  } catch {
    return false; // tsc reports invalid configs itself
  }
  const config = raw as { files?: unknown; include?: unknown; references?: unknown };
  return (
    Array.isArray(config.files) &&
    config.files.length === 0 &&
    config.include === undefined &&
    Array.isArray(config.references) &&
    config.references.length > 0
  );
}

/**
 * TypeScript runner - runs tsc --noEmit
 */
export const typescriptRunner: Runner = {
  name: "typescript",
  label: "TypeScript",

  detect(cwd: string, config?: ToolConfig): RunnerAvailability {
    const tsconfig = findConfigFile(cwd, TYPESCRIPT_CONFIG_FILES);
    if (!tsconfig) {
      return { available: false, reason: "no tsconfig.json in the project root" };
    }
    let tsconfigText = "";
    try {
      tsconfigText = readFileSync(join(cwd, tsconfig), "utf-8");
    } catch {
      // tsc will report an unreadable config
    }
    if (checksNothing(tsconfigText, config?.args)) {
      return {
        available: false,
        reason:
          'tsconfig.json only references other projects ("files": []), so tsc --noEmit would check nothing; ' +
          'point it at a project with rules.typescript.args, e.g. ["-p", "tsconfig.app.json"]',
      };
    }
    const binary = findBinary("tsc", cwd);
    if (!binary) {
      return {
        available: false,
        reason: "tsconfig.json found, but no tsc binary (install typescript; looked in node_modules/.bin and PATH)",
      };
    }
    return { available: true, binary };
  },

  async isAvailable(cwd: string): Promise<boolean> {
    return this.detect(cwd).available;
  },

  async run(options: RunnerOptions): Promise<RunnerResult> {
    const { cwd, config } = options;
    const binary = options.binary ?? findBinary("tsc", cwd);
    if (!binary) {
      return {
        source: "typescript",
        results: [],
        success: true,
        skipped: true,
        skipReason: "no tsc binary found",
      };
    }

    const args = ["--noEmit", "--pretty", "false", ...(config?.args ?? [])];
    const execResult = await execCommand(binary, args, {
      cwd,
      timeout: options.timeoutMs ?? DEFAULT_RUNNER_TIMEOUT_MS,
    });

    return interpretTypeScriptRun(execResult, ["tsc", ...args].join(" "));
  },
};
