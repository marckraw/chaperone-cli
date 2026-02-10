import { globSync } from "../../utils/glob";
import type { CheckResult, RetiredPathRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

export async function runRetiredPathRule(
  rule: RetiredPathRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];

  for (const entry of rule.paths) {
    const files = globSync(entry.pattern, {
      cwd,
      ignore: allExcludes,
    });

    for (const file of files) {
      let message = rule.message || `File exists in retired path matching "${entry.pattern}"`;
      if (entry.reason) {
        message += `. Reason: ${entry.reason}`;
      }
      if (entry.migratedTo) {
        message += `. Migrate to: ${entry.migratedTo}`;
      }

      results.push({
        file,
        rule: `retired-path/${rule.id}`,
        message,
        severity: rule.severity,
        source: "custom",
        suggestion: entry.migratedTo
          ? `Move this file to ${entry.migratedTo}`
          : undefined,
      });
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

export function isRetiredPathRule(rule: unknown): rule is RetiredPathRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as RetiredPathRule).type === "retired-path"
  );
}
