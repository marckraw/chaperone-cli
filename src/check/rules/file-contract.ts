import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, FileContractRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveCapture(
  file: string,
  rule: FileContractRule
): { value: string | null; error: string | null } {
  if (!rule.captureFromPath) {
    return { value: null, error: null };
  }

  const regex = compileRegex(rule.captureFromPath.pattern);
  if (!regex) {
    return {
      value: null,
      error: `Invalid captureFromPath.pattern regex: ${rule.captureFromPath.pattern}`,
    };
  }

  const sourceValue =
    rule.captureFromPath.source === "basename" ? basename(file) : file;
  const match = regex.exec(sourceValue);

  if (!match) {
    return {
      value: null,
      error: `captureFromPath.pattern did not match file path`,
    };
  }

  const group = rule.captureFromPath.group ?? 1;
  const captured =
    typeof group === "number"
      ? match[group]
      : match.groups
        ? match.groups[group]
        : undefined;

  if (typeof captured !== "string") {
    return {
      value: null,
      error: `captureFromPath.group '${String(group)}' was not found`,
    };
  }

  return { value: captured, error: null };
}

function expandTemplatedPatterns(patterns: string[], capture: string | null): string[] {
  if (!capture) {
    return patterns;
  }

  const escapedCapture = escapeRegExp(capture);
  return patterns.map((pattern) => pattern.replaceAll("{{capture}}", escapedCapture));
}

function reportConfigError(rule: FileContractRule, message: string): RuleResult {
  return {
    ruleId: rule.id,
    results: [
      {
        file: ".chaperone.json",
        rule: `file-contract/${rule.id}`,
        message,
        severity: "error",
        source: "custom",
      },
    ],
  };
}

export async function runFileContractRule(
  rule: FileContractRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  const staticRequiredPatterns = rule.requiredPatterns ?? [];
  const staticRequiredAnyPatterns = rule.requiredAnyPatterns ?? [];
  const staticForbiddenPatterns = rule.forbiddenPatterns ?? [];

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const captureResult = resolveCapture(file, rule);
    if (captureResult.error) {
      if (captureResult.error.startsWith("Invalid")) {
        return reportConfigError(rule, captureResult.error);
      }

      results.push({
        file,
        rule: `file-contract/${rule.id}`,
        message: rule.message || captureResult.error,
        severity: rule.severity,
        source: "custom",
      });
      continue;
    }

    const requiredPatterns = [
      ...staticRequiredPatterns,
      ...expandTemplatedPatterns(
        rule.templatedRequiredPatterns ?? [],
        captureResult.value
      ),
    ];

    const requiredAnyPatterns = [
      ...staticRequiredAnyPatterns,
      ...expandTemplatedPatterns(
        rule.templatedRequiredAnyPatterns ?? [],
        captureResult.value
      ),
    ];

    const forbiddenPatterns = [
      ...staticForbiddenPatterns,
      ...expandTemplatedPatterns(
        rule.templatedForbiddenPatterns ?? [],
        captureResult.value
      ),
    ];

    for (const pattern of requiredPatterns) {
      const regex = compileRegex(pattern);
      if (!regex) {
        return reportConfigError(rule, `Invalid required regex pattern: ${pattern}`);
      }

      if (!regex.test(content)) {
        results.push({
          file,
          rule: `file-contract/${rule.id}`,
          message: rule.message || `Missing required pattern: /${pattern}/`,
          severity: rule.severity,
          source: "custom",
          context: {
            expectedValue: `/${pattern}/`,
            actualValue: "not found",
          },
        });
      }
    }

    if (requiredAnyPatterns.length > 0) {
      let anyMatch = false;

      for (const pattern of requiredAnyPatterns) {
        const regex = compileRegex(pattern);
        if (!regex) {
          return reportConfigError(rule, `Invalid requiredAny regex pattern: ${pattern}`);
        }

        if (regex.test(content)) {
          anyMatch = true;
          break;
        }
      }

      if (!anyMatch) {
        results.push({
          file,
          rule: `file-contract/${rule.id}`,
          message:
            rule.message ||
            `None of requiredAny patterns matched: ${requiredAnyPatterns
              .map((value) => `/${value}/`)
              .join(", ")}`,
          severity: rule.severity,
          source: "custom",
        });
      }
    }

    for (const pattern of forbiddenPatterns) {
      const regex = compileRegex(pattern);
      if (!regex) {
        return reportConfigError(rule, `Invalid forbidden regex pattern: ${pattern}`);
      }

      const match = regex.exec(content);
      if (match) {
        results.push({
          file,
          rule: `file-contract/${rule.id}`,
          message: rule.message || `Forbidden pattern found: /${pattern}/`,
          severity: rule.severity,
          source: "custom",
          context: {
            matchedText: match[0],
          },
        });
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

export function isFileContractRule(rule: unknown): rule is FileContractRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as FileContractRule).type === "file-contract"
  );
}
