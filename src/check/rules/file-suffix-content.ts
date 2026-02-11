import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, FileSuffixContentRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export async function runFileSuffixContentRule(
  rule: FileSuffixContentRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const allFiles = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  // Filter to only files that end with the specified suffix
  const matchedFiles = allFiles.filter((f) => f.endsWith(rule.suffix));

  for (const file of matchedFiles) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    // Check forbidden patterns
    if (rule.forbiddenPatterns) {
      for (const entry of rule.forbiddenPatterns) {
        const regex = compileRegex(entry.pattern);
        if (!regex) {
          return {
            ruleId: rule.id,
            results: [
              {
                file: ".chaperone.json",
                rule: `file-suffix-content/${rule.id}`,
                message: `Invalid regex pattern for "${entry.name}": ${entry.pattern}`,
                severity: "error",
                source: "custom",
              },
            ],
          };
        }

        const match = regex.exec(content);
        if (match) {
          results.push({
            file,
            rule: `file-suffix-content/${rule.id}`,
            message:
              rule.message ||
              `Files with suffix "${rule.suffix}" must not contain ${entry.name}`,
            severity: rule.severity,
            source: "custom",
            context: {
              matchedText: match[0],
            },
          });
        }
      }
    }

    // Check required patterns
    if (rule.requiredPatterns) {
      for (const entry of rule.requiredPatterns) {
        const regex = compileRegex(entry.pattern);
        if (!regex) {
          return {
            ruleId: rule.id,
            results: [
              {
                file: ".chaperone.json",
                rule: `file-suffix-content/${rule.id}`,
                message: `Invalid regex pattern for "${entry.name}": ${entry.pattern}`,
                severity: "error",
                source: "custom",
              },
            ],
          };
        }

        if (!regex.test(content)) {
          results.push({
            file,
            rule: `file-suffix-content/${rule.id}`,
            message:
              rule.message ||
              `Files with suffix "${rule.suffix}" must contain ${entry.name}`,
            severity: rule.severity,
            source: "custom",
            context: {
              expectedValue: `/${entry.pattern}/`,
              actualValue: "not found",
            },
          });
        }
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

export function isFileSuffixContentRule(
  rule: unknown
): rule is FileSuffixContentRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as FileSuffixContentRule).type === "file-suffix-content"
  );
}
