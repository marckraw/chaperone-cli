import { existsSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, FilePairingRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

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
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

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

    const fullCompanionPath = join(cwd, transformed);
    const companionExists = existsSync(fullCompanionPath);

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
  };
}

export function isFilePairingRule(rule: unknown): rule is FilePairingRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as FilePairingRule).type === "file-pairing"
  );
}
