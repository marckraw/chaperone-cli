import { isAbsolute, posix, relative, resolve } from "node:path";
import { execCommand } from "../../utils/process";
import type { CheckResult, CommandRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { findingMessage } from "./utils/findings";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_EXPECTED_EXIT_CODE = 0;
const RESULT_FILE = ".chaperone.json";
const MAX_OUTPUT_LENGTH = 4000;

function validatePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function formatCommandOutput(stdout: string, stderr: string): string | undefined {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");

  if (!combined) {
    return undefined;
  }

  if (combined.length <= MAX_OUTPUT_LENGTH) {
    return combined;
  }

  return `${combined.slice(0, MAX_OUTPUT_LENGTH)}\n... output truncated ...`;
}

/** One violation a command reports with `output: "results"` */
export interface CommandResultEntry {
  /** Relative to the project root and normalized; an absolute path inside the project is made relative */
  file: string;
  message: string;
  /** The violation's identity for the baseline; computed from the message and line when omitted */
  fingerprint?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/**
 * A result's file as a normalized POSIX path relative to the project root, so `./src/a.ts`,
 * `src//a.ts` and the absolute path are one baseline entry. Null when it is outside the project.
 */
function projectPath(file: string, projectRoot: string): string | null {
  const relativePath = isAbsolute(file) ? relative(projectRoot, file) : file;
  const normalized = posix.normalize(relativePath.split("\\").join("/"));
  if (normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized) || isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * The result list a command printed: `{ "results": [{ "file", "message", "fingerprint"? }] }`.
 * Pure. Returns the reason when stdout is not such a list.
 */
export function parseCommandResults(
  stdout: string,
  projectRoot: string
): { results: CommandResultEntry[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: stdout.trim() ? `stdout is not JSON (${detail})` : "stdout is empty" };
  }
  const list = typeof data === "object" && data !== null ? (data as { results?: unknown }).results : undefined;
  if (!Array.isArray(list)) {
    return { error: 'stdout must be a JSON object with a "results" array' };
  }

  const results: CommandResultEntry[] = [];
  for (const [index, item] of list.entries()) {
    const where = `results[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { error: `${where} must be an object` };
    }
    const entry = item as Record<string, unknown>;
    for (const field of ["file", "message"] as const) {
      if (typeof entry[field] !== "string" || entry[field] === "") {
        return { error: `${where} needs a nonempty string "${field}"` };
      }
    }
    for (const field of ["fingerprint", "suggestion"] as const) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        return { error: `${where} has "${field}" ${JSON.stringify(entry[field])}; it must be a string` };
      }
    }
    for (const field of ["line", "column"] as const) {
      if (entry[field] !== undefined && !isPositiveInteger(entry[field])) {
        return { error: `${where} has "${field}" ${JSON.stringify(entry[field])}; it must be a whole number of at least 1` };
      }
    }
    const file = projectPath(entry["file"] as string, projectRoot);
    if (file === null || file === ".") {
      return { error: `${where} has "file" ${JSON.stringify(entry["file"])}, which is not a file in the project` };
    }
    results.push({
      file,
      message: entry["message"] as string,
      ...(entry["fingerprint"] !== undefined && { fingerprint: entry["fingerprint"] as string }),
      ...(entry["line"] !== undefined && { line: entry["line"] as number }),
      ...(entry["column"] !== undefined && { column: entry["column"] as number }),
      ...(entry["suggestion"] !== undefined && { suggestion: entry["suggestion"] as string }),
    });
  }
  return { results };
}

/**
 * Run command rule to enforce command-based invariants.
 */
export async function runCommandRule(
  rule: CommandRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const results: CheckResult[] = [];
  const args = rule.args ?? [];
  const expectedExitCode = rule.expectedExitCode ?? DEFAULT_EXPECTED_EXIT_CODE;
  const cwd = rule.cwd ? resolve(options.cwd, rule.cwd) : options.cwd;
  const timeoutMs = rule.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Asynchronous so tool runners keep streaming while the command runs
  const processResult = await execCommand(rule.command, args, { cwd, timeout: timeoutMs });

  const commandDisplay = [rule.command, ...args].join(" ").trim();
  const { stdout, stderr } = processResult;
  const exitCode = processResult.exitCode;
  const commandOutput = formatCommandOutput(stdout, stderr);
  const failureReason = processResult.spawnError
    ? processResult.spawnError
    : processResult.timedOut
      ? `timed out after ${timeoutMs}ms`
      : null;

  if (failureReason) {
    results.push({
      file: RESULT_FILE,
      rule: `command/${rule.id}`,
      // An execution failure is not a rule verdict: always say what went wrong.
      message: `Failed to execute command "${commandDisplay}": ${failureReason}`,
      ruleError: true,
      severity: rule.severity,
      source: "custom",
      context: {
        command: commandDisplay,
        exitCode,
        commandOutput,
      },
    });
    return { ruleId: rule.id, results };
  }

  if (rule.output === "results") {
    // Each listed result is a violation of its own, baselined on its own. A list that cannot be
    // read, or an unexpected exit code with nothing listed, means the command could not check.
    const parsed = parseCommandResults(stdout, options.cwd);
    const cannotCheck =
      "error" in parsed
        ? `Cannot read results from "${commandDisplay}": ${parsed.error}`
        : parsed.results.length === 0 && exitCode !== expectedExitCode
          ? `Command "${commandDisplay}" exited with ${exitCode} (expected ${expectedExitCode}) but listed no results`
          : null;
    if (cannotCheck) {
      results.push({
        file: RESULT_FILE,
        rule: `command/${rule.id}`,
        message: cannotCheck,
        ruleError: true,
        severity: "error",
        source: "custom",
        context: { command: commandDisplay, exitCode, commandOutput },
      });
    } else if ("results" in parsed) {
      for (const entry of parsed.results) {
        results.push({
          file: entry.file,
          line: entry.line,
          column: entry.column,
          rule: `command/${rule.id}`,
          message: findingMessage(rule.message, entry.message),
          severity: rule.severity,
          source: "custom",
          suggestion: entry.suggestion ?? `Run directly for details: ${commandDisplay}`,
          ...(entry.fingerprint !== undefined && { fingerprint: entry.fingerprint }),
          context: { command: commandDisplay },
        });
      }
    }
  } else if (exitCode !== expectedExitCode) {
    results.push({
      file: RESULT_FILE,
      rule: `command/${rule.id}`,
      message: rule.message
        || `Command failed: expected exit code ${expectedExitCode}, got ${exitCode}`,
      severity: rule.severity,
      source: "custom",
      suggestion: `Run directly for details: ${commandDisplay}`,
      context: {
        command: commandDisplay,
        exitCode,
        expectedValue: String(expectedExitCode),
        actualValue: String(exitCode),
        commandOutput,
      },
    });
  }

  if (rule.stdoutPattern) {
    const stdoutRegex = validatePattern(rule.stdoutPattern);
    if (!stdoutRegex) {
      results.push({
        file: RESULT_FILE,
        rule: `command/${rule.id}`,
        message: `Invalid stdoutPattern regex: ${rule.stdoutPattern}`,
        ruleError: true,
        severity: "error",
        source: "custom",
        context: {
          command: commandDisplay,
          commandOutput,
        },
      });
    } else if (!stdoutRegex.test(stdout)) {
      results.push({
        file: RESULT_FILE,
        rule: `command/${rule.id}`,
        message: rule.message || "Command stdout did not match required pattern",
        severity: rule.severity,
        source: "custom",
        context: {
          command: commandDisplay,
          expectedValue: `/${rule.stdoutPattern}/`,
          actualValue: stdout.slice(0, 500),
          commandOutput,
        },
      });
    }
  }

  if (rule.stderrPattern) {
    const stderrRegex = validatePattern(rule.stderrPattern);
    if (!stderrRegex) {
      results.push({
        file: RESULT_FILE,
        rule: `command/${rule.id}`,
        message: `Invalid stderrPattern regex: ${rule.stderrPattern}`,
        ruleError: true,
        severity: "error",
        source: "custom",
        context: {
          command: commandDisplay,
          commandOutput,
        },
      });
    } else if (!stderrRegex.test(stderr)) {
      results.push({
        file: RESULT_FILE,
        rule: `command/${rule.id}`,
        message: rule.message || "Command stderr did not match required pattern",
        severity: rule.severity,
        source: "custom",
        context: {
          command: commandDisplay,
          expectedValue: `/${rule.stderrPattern}/`,
          actualValue: stderr.slice(0, 500),
          commandOutput,
        },
      });
    }
  }

  return { ruleId: rule.id, results };
}

/**
 * Check if a rule is a CommandRule.
 */
export function isCommandRule(rule: unknown): rule is CommandRule {
  return typeof rule === "object" && rule !== null && (rule as CommandRule).type === "command";
}
