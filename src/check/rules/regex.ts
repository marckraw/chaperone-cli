import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, RegexRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

/**
 * Run regex rule to find forbidden/required patterns
 */
export async function runRegexRule(
  rule: RegexRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  // Find files matching the glob pattern
  const files = globSync(rule.files, {
    cwd,
    ignore: exclude,
  });

  // Compile the regex
  let regex: RegExp;
  try {
    regex = new RegExp(rule.pattern, "g");
  } catch (err) {
    return {
      ruleId: rule.id,
      results: [
        {
          file: "",
          rule: `regex/${rule.id}`,
          message: `Invalid regex pattern: ${rule.pattern}`,
          severity: "error",
          source: "custom",
        },
      ],
    };
  }

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    if (rule.mustMatch) {
      // Pattern MUST be present
      const hasMatch = regex.test(content);
      if (!hasMatch) {
        results.push({
          file,
          rule: `regex/${rule.id}`,
          message: rule.message,
          severity: rule.severity,
          source: "custom",
        });
      }
    } else {
      // Pattern must NOT be present (default)
      // Reset regex state
      regex.lastIndex = 0;

      // Find all matches with line numbers
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split("\n").length;

        // Find column
        const lastNewline = beforeMatch.lastIndexOf("\n");
        const column = match.index - lastNewline;

        results.push({
          file,
          line: lineNumber,
          column,
          rule: `regex/${rule.id}`,
          message: rule.message,
          severity: rule.severity,
          source: "custom",
        });
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

/**
 * Check if a rule is a RegexRule
 */
export function isRegexRule(rule: unknown): rule is RegexRule {
  return typeof rule === "object" && rule !== null && (rule as RegexRule).type === "regex";
}
