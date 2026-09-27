import type { CheckResult, RegexRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

/**
 * Run regex rule to find forbidden/required patterns
 */
export async function runRegexRule(
  rule: RegexRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { index } = getRuleContext(options);
  const results: CheckResult[] = [];

  // Find files matching the glob pattern (global excludes are applied by the index)
  const files = index.glob(rule.files, rule.exclude ?? []);

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
    const content = index.read(file);
    if (content === null) {
      continue;
    }

    if (rule.mustMatch) {
      // Pattern MUST be present
      regex.lastIndex = 0;
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
      const lines = content.split("\n");

      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNumber = beforeMatch.split("\n").length;

        // Find column
        const lastNewline = beforeMatch.lastIndexOf("\n");
        const column = match.index - lastNewline;

        // Get surrounding lines for context
        const surroundingLines: string[] = [];
        const startLine = Math.max(0, lineNumber - 2);
        const endLine = Math.min(lines.length, lineNumber + 1);
        for (let i = startLine; i < endLine; i++) {
          const prefix = i === lineNumber - 1 ? ">" : " ";
          surroundingLines.push(`${prefix} ${i + 1} | ${lines[i]}`);
        }

        results.push({
          file,
          line: lineNumber,
          column,
          rule: `regex/${rule.id}`,
          message: rule.message,
          severity: rule.severity,
          source: "custom",
          context: {
            matchedText: match[0],
            surroundingLines,
          },
        });

        // If reportOnce is enabled, only report the first match per file
        if (rule.reportOnce) {
          break;
        }
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
    filesChecked: files.length,
  };
}

/**
 * Check if a rule is a RegexRule
 */
export function isRegexRule(rule: unknown): rule is RegexRule {
  return typeof rule === "object" && rule !== null && (rule as RegexRule).type === "regex";
}
