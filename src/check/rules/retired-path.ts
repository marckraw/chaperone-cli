import type { CheckResult, RetiredPathRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

export async function runRetiredPathRule(
  rule: RetiredPathRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const { index } = context;
  const results: CheckResult[] = [];

  for (const entry of rule.paths) {
    const files = context.inScope(index.glob(entry.pattern, rule.exclude ?? []));

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
