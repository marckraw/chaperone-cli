import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync, matchGlob } from "../../utils/glob";
import type { CheckResult, ForbiddenImportRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { extractImports } from "./utils/import-extractor";

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export async function runForbiddenImportRule(
  rule: ForbiddenImportRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  const includeTypeImports = rule.includeTypeImports ?? false;

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    // Check import restrictions
    if (rule.restrictions) {
      const imports = extractImports(content, {
        includeTypeImports,
        includeDynamicImports: true,
        includeRequire: true,
      });

      for (const imp of imports) {
        for (const restriction of rule.restrictions) {
          const sourceRegex = compileRegex(restriction.source);
          if (!sourceRegex) {
            return {
              ruleId: rule.id,
              results: [
                {
                  file: ".chaperone.json",
                  rule: `forbidden-import/${rule.id}`,
                  message: `Invalid restriction source regex: ${restriction.source}`,
                  severity: "error",
                  source: "custom",
                },
              ],
            };
          }

          if (sourceRegex.test(imp.source)) {
            // Check if this file is in the allowedIn list
            const isAllowed = restriction.allowedIn.some((glob) =>
              matchGlob(file, glob)
            );
            if (!isAllowed) {
              results.push({
                file,
                rule: `forbidden-import/${rule.id}`,
                message:
                  restriction.message ||
                  rule.message ||
                  `Import "${imp.source}" is not allowed in this file`,
                severity: rule.severity,
                source: "custom",
                line: imp.line,
                context: {
                  matchedText: imp.source,
                },
              });
            }
          }
        }
      }
    }

    // Check code patterns (e.g., function calls)
    if (rule.checkPatterns) {
      for (const checkPattern of rule.checkPatterns) {
        const regex = compileRegex(checkPattern.pattern);
        if (!regex) {
          return {
            ruleId: rule.id,
            results: [
              {
                file: ".chaperone.json",
                rule: `forbidden-import/${rule.id}`,
                message: `Invalid checkPattern regex: ${checkPattern.pattern}`,
                severity: "error",
                source: "custom",
              },
            ],
          };
        }

        // Use global flag to find all occurrences
        const globalRegex = new RegExp(checkPattern.pattern, "g");
        let patternMatch: RegExpExecArray | null;

        while ((patternMatch = globalRegex.exec(content)) !== null) {
          const isAllowed = checkPattern.allowedIn.some((glob) =>
            matchGlob(file, glob)
          );
          if (!isAllowed) {
            // Calculate line number
            const before = content.slice(0, patternMatch.index);
            const line = before.split("\n").length;

            results.push({
              file,
              rule: `forbidden-import/${rule.id}`,
              message:
                checkPattern.message ||
                rule.message ||
                `Pattern "${checkPattern.pattern}" is not allowed in this file`,
              severity: rule.severity,
              source: "custom",
              line,
              context: {
                matchedText: patternMatch[0],
              },
            });
          }
          // Break after first match per file per pattern to avoid noise
          break;
        }
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

export function isForbiddenImportRule(
  rule: unknown
): rule is ForbiddenImportRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as ForbiddenImportRule).type === "forbidden-import"
  );
}
