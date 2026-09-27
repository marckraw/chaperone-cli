import type { CheckResult, ReactComponentCountRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { findReactComponents } from "./utils/react-components";
import { getRuleContext } from "./utils/rule-context";

/**
 * Run react-component-count rule to limit how many React components live in a file.
 */
export async function runReactComponentCountRule(
  rule: ReactComponentCountRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const results: CheckResult[] = [];
  const maxComponents = rule.maxComponents ?? 1;
  const ignoreNames = new Set(rule.ignoreNames ?? []);

  if (maxComponents < 1) {
    return {
      ruleId: rule.id,
      results: [
        {
          file: ".chaperone.json",
          rule: `react-component-count/${rule.id}`,
          message: `react-component-count rule '${rule.id}' must set maxComponents to at least 1`,
          severity: "error",
          source: "custom",
        },
      ],
    };
  }

  const { index } = getRuleContext(options);
  const files = index.glob(rule.files, rule.exclude ?? []);

  for (const file of files) {
    const content = index.read(file);
    if (content === null) {
      continue;
    }

    const components = findReactComponents(content, file).filter(
      (candidate) => !ignoreNames.has(candidate.name)
    );

    if (components.length <= maxComponents) {
      continue;
    }

    const componentNames = components.map((candidate) => candidate.name);
    const firstExtraComponent = components[maxComponents] ?? components[components.length - 1];

    results.push({
      file,
      line: firstExtraComponent?.line,
      rule: `react-component-count/${rule.id}`,
      message:
        rule.message
        || `File defines ${components.length} React components (${componentNames.join(", ")}), maximum allowed is ${maxComponents}`,
      severity: rule.severity,
      source: "custom",
      suggestion: `Move ${componentNames.slice(maxComponents).join(", ")} into separate files`,
      context: {
        expectedValue: `<= ${maxComponents} React component`,
        actualValue: `${components.length}: ${componentNames.join(", ")}`,
        detectedPatterns: componentNames,
      },
    });
  }

  return {
    ruleId: rule.id,
    results,
    filesChecked: files.length,
  };
}

/**
 * Check if a rule is a ReactComponentCountRule.
 */
export function isReactComponentCountRule(
  rule: unknown
): rule is ReactComponentCountRule {
  return (
    typeof rule === "object"
    && rule !== null
    && (rule as ReactComponentCountRule).type === "react-component-count"
  );
}
