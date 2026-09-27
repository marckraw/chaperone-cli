import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, FilePairingRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export async function runFilePairingRule(
  rule: FilePairingRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, index } = getRuleContext(options);
  const results: CheckResult[] = [];

  const files = index.glob(rule.files, rule.exclude ?? []);

  const transformRegex = compileRegex(rule.pair.from);
  if (!transformRegex) {
    return {
      ruleId: rule.id,
      results: [
        {
          file: ".chaperone.json",
          rule: `file-pairing/${rule.id}`,
          message: `Invalid pair.from regex: ${rule.pair.from}`,
          severity: "error",
          source: "custom",
        },
      ],
    };
  }

  const mustExist = rule.mustExist ?? true;
  const requireTransformMatch = rule.requireTransformMatch ?? true;

  for (const file of files) {
    const transformed = file.replace(transformRegex, rule.pair.to);
    const didTransform = transformed !== file;

    if (!didTransform && requireTransformMatch) {
      results.push({
        file,
        rule: `file-pairing/${rule.id}`,
        message:
          rule.message ||
          `Could not transform file path with pair.from regex: ${rule.pair.from}`,
        severity: rule.severity,
        source: "custom",
        context: {
          expectedValue: `/${rule.pair.from}/ -> ${rule.pair.to}`,
          actualValue: file,
        },
      });
      continue;
    }

    // The companion may live in an excluded directory, so fall back to the filesystem.
    const companionExists = index.has(transformed) || existsSync(join(cwd, transformed));

    if (mustExist && !companionExists) {
      results.push({
        file,
        rule: `file-pairing/${rule.id}`,
        message: rule.message || `Missing companion file: ${transformed}`,
        severity: rule.severity,
        source: "custom",
        suggestion: `Create file: ${transformed}`,
        context: {
          expectedValue: transformed,
          actualValue: "missing",
        },
      });
    }

    if (!mustExist && companionExists) {
      results.push({
        file,
        rule: `file-pairing/${rule.id}`,
        message: rule.message || `Companion file should not exist: ${transformed}`,
        severity: rule.severity,
        source: "custom",
        suggestion: `Remove file: ${transformed}`,
        context: {
          expectedValue: "missing",
          actualValue: transformed,
        },
      });
    }
  }

  return {
    ruleId: rule.id,
    results,
    filesChecked: files.length,
  };
}

export function isFilePairingRule(rule: unknown): rule is FilePairingRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as FilePairingRule).type === "file-pairing"
  );
}
