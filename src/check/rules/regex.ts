import { createLineIndex, nonEmptyMatches, truncate } from "../../utils/text";
import type { CheckResult, RegexRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

/**
 * Default flags: `m`, so `^` and `$` match at every line start and end.
 */
export const DEFAULT_REGEX_FLAGS = "m";

/**
 * The flags a regex rule runs with: the rule's `flags` (default "m") plus "g".
 * "g" and "y" are managed by Chaperone and removed from user input.
 */
export function resolveRegexFlags(flags: string | undefined): string {
  const requested = (flags ?? DEFAULT_REGEX_FLAGS).replace(/[gy]/g, "");
  return `${[...new Set(requested)].join("")}g`;
}

/**
 * Run regex rule to find forbidden/required patterns
 */
export async function runRegexRule(
  rule: RegexRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const { index } = context;
  const results: CheckResult[] = [];

  // Find files matching the glob pattern (global excludes are applied by the index)
  const files = index.glob(rule.files, rule.exclude ?? []);
  const flags = resolveRegexFlags(rule.flags);
  const shownPattern = `/${rule.pattern}/${flags.replace("g", "")}`;

  // Compile the regex (validated at load time; guard programmatic callers)
  let regex: RegExp;
  try {
    regex = new RegExp(rule.pattern, flags);
  } catch (error) {
    return {
      ruleId: rule.id,
      results: [
        {
          file: ".chaperone.json",
          rule: `regex/${rule.id}`,
          message: `Invalid regex pattern ${shownPattern}: ${error instanceof Error ? error.message : String(error)}`,
          severity: "error",
          source: "custom",
        },
      ],
    };
  }

  // Legacy alias, normally normalized at load time
  const mustMatch = rule.mustMatch ?? (rule.forbidden === undefined ? false : !rule.forbidden);

  for (const file of context.inScope(files)) {
    const content = index.read(file);
    if (content === null) {
      continue;
    }

    if (mustMatch) {
      // Pattern MUST be present (zero-length matches do not count)
      const first = nonEmptyMatches(content, regex).next();
      if (first.done) {
        results.push({
          file,
          rule: `regex/${rule.id}`,
          message: rule.message,
          severity: rule.severity,
          source: "custom",
          context: {
            expectedValue: `a match for ${shownPattern}`,
            actualValue: "no match",
          },
        });
      }
      continue;
    }

    // Pattern must NOT be present (default)
    const lines = createLineIndex(content);
    for (const match of nonEmptyMatches(content, regex)) {
      // Point at the first non-whitespace character: with `^\s*...` the match can start on a blank line
      const text = match[0];
      const leading = text.length - text.trimStart().length;
      const offset = leading < text.length ? match.index + leading : match.index;
      const lineNumber = lines.lineAt(offset);

      // Surrounding lines for context
      const surroundingLines: string[] = [];
      const startLine = Math.max(1, lineNumber - 1);
      const endLine = Math.min(lines.lineCount, lineNumber + 1);
      for (let current = startLine; current <= endLine; current++) {
        const prefix = current === lineNumber ? ">" : " ";
        surroundingLines.push(`${prefix} ${current} | ${lines.line(current)}`);
      }

      results.push({
        file,
        line: lineNumber,
        column: lines.columnAt(offset),
        rule: `regex/${rule.id}`,
        message: rule.message,
        severity: rule.severity,
        source: "custom",
        context: {
          matchedText: truncate(text.trim() || text),
          surroundingLines,
        },
      });

      // If reportOnce is enabled, only report the first match per file
      if (rule.reportOnce) {
        break;
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
