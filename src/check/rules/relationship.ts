import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { globSync } from "../../utils/glob";
import type {
  CheckResult,
  RelationshipRule,
  RelationshipAction,
} from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { extractImports } from "./utils/import-extractor";

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Resolve the companion path from a file path using either suffix or pair config.
 */
function resolveCompanionPath(
  file: string,
  config: { suffix?: string; pair?: { from: string; to: string } }
): string | null {
  if (config.suffix) {
    // Replace the extension with the suffix
    // e.g., "foo.container.tsx" with suffix ".presentational.tsx"
    // Find the first '.' in the basename to determine the stem
    const dir = dirname(file);
    const base = basename(file);
    const firstDot = base.indexOf(".");
    if (firstDot === -1) return null;
    const stem = base.slice(0, firstDot);
    const companion = join(dir, stem + config.suffix);
    return companion;
  }

  if (config.pair) {
    const regex = compileRegex(config.pair.from);
    if (!regex) return null;
    const result = file.replace(regex, config.pair.to);
    if (result === file) return null; // No transform occurred
    return result;
  }

  return null;
}

export async function runRelationshipRule(
  rule: RelationshipRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const files = globSync(rule.when.files, {
    cwd,
    ignore: allExcludes,
  });

  for (const file of files) {
    let companionPath: string | null = null;
    let companionContent: string | null = null;
    let skipRemainingActions = false;

    for (const action of rule.then) {
      if (skipRemainingActions) break;

      // mustHaveCompanion
      if ("mustHaveCompanion" in action) {
        companionPath = resolveCompanionPath(
          file,
          action.mustHaveCompanion
        );
        if (!companionPath) {
          results.push({
            file,
            rule: `relationship/${rule.id}`,
            message:
              rule.message ||
              `Could not resolve companion path for "${file}"`,
            severity: rule.severity,
            source: "custom",
          });
          skipRemainingActions = true;
          continue;
        }
        const fullCompanionPath = join(cwd, companionPath);
        if (!existsSync(fullCompanionPath)) {
          results.push({
            file,
            rule: `relationship/${rule.id}`,
            message:
              rule.message ||
              `Missing required companion file: ${companionPath}`,
            severity: rule.severity,
            source: "custom",
            context: {
              expectedValue: companionPath,
              actualValue: "missing",
            },
          });
          skipRemainingActions = true;
          continue;
        }
        try {
          companionContent = readFileSync(fullCompanionPath, "utf-8");
        } catch {
          skipRemainingActions = true;
          continue;
        }
      }

      // mustNotHaveCompanion
      else if ("mustNotHaveCompanion" in action) {
        const notCompanionPath = resolveCompanionPath(
          file,
          action.mustNotHaveCompanion
        );
        if (notCompanionPath) {
          const fullPath = join(cwd, notCompanionPath);
          if (existsSync(fullPath)) {
            results.push({
              file,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `Companion file should not exist: ${notCompanionPath}`,
              severity: rule.severity,
              source: "custom",
            });
          }
        }
      }

      // mustImport
      else if ("mustImport" in action) {
        const fullPath = join(cwd, file);
        let content = "";
        try {
          content = readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }

        const imports = extractImports(content);

        if (action.mustImport.companion && companionPath) {
          // Check that the file imports its companion
          const companionBasename = basename(companionPath);
          const companionStem = companionBasename.replace(/\.[^.]+$/, "");
          const hasCompanionImport = imports.some(
            (imp) =>
              imp.source.includes(companionStem) ||
              imp.source.endsWith(
                companionPath!.replace(/\.[^.]+$/, "")
              )
          );
          if (!hasCompanionImport) {
            results.push({
              file,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `File must import its companion: ${companionPath}`,
              severity: rule.severity,
              source: "custom",
            });
          }
        }

        if (action.mustImport.modules) {
          for (const mod of action.mustImport.modules) {
            const hasImport = imports.some((imp) =>
              imp.source.includes(mod)
            );
            if (!hasImport) {
              results.push({
                file,
                rule: `relationship/${rule.id}`,
                message:
                  rule.message || `File must import module: ${mod}`,
                severity: rule.severity,
                source: "custom",
              });
            }
          }
        }
      }

      // mustNotImport
      else if ("mustNotImport" in action) {
        const fullPath = join(cwd, file);
        let content = "";
        try {
          content = readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }

        const imports = extractImports(content);

        for (const mod of action.mustNotImport.modules) {
          const badImport = imports.find((imp) =>
            imp.source.includes(mod)
          );
          if (badImport) {
            results.push({
              file,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `File must not import module: ${mod}`,
              severity: rule.severity,
              source: "custom",
              line: badImport.line,
            });
          }
        }
      }

      // companionMustContain
      else if ("companionMustContain" in action) {
        if (!companionContent || !companionPath) continue;
        for (const pattern of action.companionMustContain.patterns) {
          const regex = compileRegex(pattern);
          if (!regex) continue;
          if (!regex.test(companionContent)) {
            results.push({
              file: companionPath,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `Companion file must contain pattern: /${pattern}/`,
              severity: rule.severity,
              source: "custom",
              context: {
                expectedValue: `/${pattern}/`,
                actualValue: "not found",
              },
            });
          }
        }
      }

      // companionMustNot
      else if ("companionMustNot" in action) {
        if (!companionContent || !companionPath) continue;
        for (const pattern of action.companionMustNot.patterns) {
          const regex = compileRegex(pattern);
          if (!regex) continue;
          const match = regex.exec(companionContent);
          if (match) {
            results.push({
              file: companionPath,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `Companion file must not contain pattern: /${pattern}/`,
              severity: rule.severity,
              source: "custom",
              context: {
                matchedText: match[0],
              },
            });
          }
        }
      }

      // fileMustContain
      else if ("fileMustContain" in action) {
        const fullPath = join(cwd, file);
        let content = "";
        try {
          content = readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }
        for (const pattern of action.fileMustContain.patterns) {
          const regex = compileRegex(pattern);
          if (!regex) continue;
          if (!regex.test(content)) {
            results.push({
              file,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `File must contain pattern: /${pattern}/`,
              severity: rule.severity,
              source: "custom",
              context: {
                expectedValue: `/${pattern}/`,
                actualValue: "not found",
              },
            });
          }
        }
      }

      // fileMustNot
      else if ("fileMustNot" in action) {
        const fullPath = join(cwd, file);
        let content = "";
        try {
          content = readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }
        for (const pattern of action.fileMustNot.patterns) {
          const regex = compileRegex(pattern);
          if (!regex) continue;
          const match = regex.exec(content);
          if (match) {
            results.push({
              file,
              rule: `relationship/${rule.id}`,
              message:
                rule.message ||
                `File must not contain pattern: /${pattern}/`,
              severity: rule.severity,
              source: "custom",
              context: {
                matchedText: match[0],
              },
            });
          }
        }
      }

      // companionMaxLines
      else if ("companionMaxLines" in action) {
        if (!companionContent || !companionPath) continue;
        const lineCount = companionContent.split("\n").length;
        if (lineCount > action.companionMaxLines) {
          results.push({
            file: companionPath,
            rule: `relationship/${rule.id}`,
            message:
              rule.message ||
              `Companion file exceeds maximum of ${action.companionMaxLines} lines (has ${lineCount})`,
            severity: rule.severity,
            source: "custom",
            context: {
              expectedValue: `<= ${action.companionMaxLines} lines`,
              actualValue: `${lineCount} lines`,
            },
          });
        }
      }

      // maxLines
      else if ("maxLines" in action) {
        const fullPath = join(cwd, file);
        let content = "";
        try {
          content = readFileSync(fullPath, "utf-8");
        } catch {
          continue;
        }
        const lineCount = content.split("\n").length;
        if (lineCount > (action as { maxLines: number }).maxLines) {
          results.push({
            file,
            rule: `relationship/${rule.id}`,
            message:
              rule.message ||
              `File exceeds maximum of ${(action as { maxLines: number }).maxLines} lines (has ${lineCount})`,
            severity: rule.severity,
            source: "custom",
            context: {
              expectedValue: `<= ${(action as { maxLines: number }).maxLines} lines`,
              actualValue: `${lineCount} lines`,
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

export function isRelationshipRule(rule: unknown): rule is RelationshipRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as RelationshipRule).type === "relationship"
  );
}
