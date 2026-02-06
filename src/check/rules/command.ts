import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { CheckResult, CommandRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_EXPECTED_EXIT_CODE = 0;
const RESULT_FILE = ".chaperone.json";

function validatePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
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

  const processResult = spawnSync(rule.command, args, {
    cwd,
    timeout: timeoutMs,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  const commandDisplay = [rule.command, ...args].join(" ").trim();
  const stdout = processResult.stdout ?? "";
  const stderr = processResult.stderr ?? "";
  const exitCode = processResult.status ?? -1;

  if (processResult.error) {
    results.push({
      file: RESULT_FILE,
      rule: `command/${rule.id}`,
      message: rule.message || `Failed to execute command: ${processResult.error.message}`,
      severity: rule.severity,
      source: "custom",
      context: {
        command: commandDisplay,
        exitCode,
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
      suggestion: `Fix command checks: ${commandDisplay}`,
      context: {
        command: commandDisplay,
        exitCode,
        expectedValue: String(expectedExitCode),
        actualValue: String(exitCode),
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
