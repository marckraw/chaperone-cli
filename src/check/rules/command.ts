import { resolve } from "node:path";
import { execCommand } from "../../utils/process";
import type { CheckResult, CommandRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

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

  if (exitCode !== expectedExitCode) {
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
