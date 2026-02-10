import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, FileContractRule, FileContractAssertions } from "../types";
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

function checkAssertions(
  content: string,
  assertions: FileContractAssertions,
  file: string,
  ruleId: string,
  severity: "error" | "warning",
  message?: string
): CheckResult[] {
  const results: CheckResult[] = [];
  const lines = content.split("\n");

  // firstLine: First non-empty, non-comment line must match
  if (assertions.firstLine !== undefined) {
    let firstMeaningfulLine: string | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        continue;
      }
      firstMeaningfulLine = trimmed;
      break;
    }
    if (firstMeaningfulLine !== null) {
      const regex = compileRegex(assertions.firstLine);
      if (regex && !regex.test(firstMeaningfulLine)) {
        results.push({
          file,
          rule: `file-contract/${ruleId}`,
          message: message || `First meaningful line must match: /${assertions.firstLine}/`,
          severity,
          source: "custom",
          context: {
            expectedValue: assertions.firstLine,
            actualValue: firstMeaningfulLine,
          },
        });
      }
    }
  }

  // mustExportDefault
  if (assertions.mustExportDefault) {
    const hasDefault = /\bexport\s+default\b/.test(content);
    if (!hasDefault) {
      results.push({
        file,
        rule: `file-contract/${ruleId}`,
        message: message || "File must have a default export",
        severity,
        source: "custom",
      });
    }
  }

  // mustExportNamed
  if (assertions.mustExportNamed) {
    const hasNamed = /\bexport\s+(?:const|let|var|function|class|interface|type|enum|async\s+function)\b/.test(content);
    if (!hasNamed) {
      results.push({
        file,
        rule: `file-contract/${ruleId}`,
        message: message || "File must have at least one named export",
        severity,
        source: "custom",
      });
    }
  }

  // mustNotImport
  if (assertions.mustNotImport) {
    for (const mod of assertions.mustNotImport) {
      // Convert glob-like patterns to regex (e.g., "@tauri-apps/*" -> "@tauri-apps/.*")
      const pattern = mod.replace(/\*/g, ".*");
      const regex = compileRegex(`['"]${pattern}['"]`);
      if (regex) {
        const importRegex = new RegExp(`\\bimport\\s[\\s\\S]*?from\\s+['"]${pattern}['"]`, "m");
        if (importRegex.test(content)) {
          results.push({
            file,
            rule: `file-contract/${ruleId}`,
            message: message || `File must not import from: ${mod}`,
            severity,
            source: "custom",
            context: {
              matchedText: mod,
            },
          });
        }
      }
    }
  }

  // mustImport
  if (assertions.mustImport) {
    for (const mod of assertions.mustImport) {
      const pattern = mod.replace(/\*/g, ".*");
      const importRegex = new RegExp(`\\bimport\\s[\\s\\S]*?from\\s+['"]${pattern}['"]`, "m");
      if (!importRegex.test(content)) {
        results.push({
          file,
          rule: `file-contract/${ruleId}`,
          message: message || `File must import from: ${mod}`,
          severity,
          source: "custom",
          context: {
            expectedValue: mod,
            actualValue: "not found",
          },
        });
      }
    }
  }

  // maxLines
  if (assertions.maxLines !== undefined) {
    if (lines.length > assertions.maxLines) {
      results.push({
        file,
        rule: `file-contract/${ruleId}`,
        message: message || `File exceeds maximum of ${assertions.maxLines} lines (has ${lines.length})`,
        severity,
        source: "custom",
        context: {
          expectedValue: `<= ${assertions.maxLines}`,
          actualValue: `${lines.length}`,
        },
      });
    }
  }

  // minLines
  if (assertions.minLines !== undefined) {
    if (lines.length < assertions.minLines) {
      results.push({
        file,
        rule: `file-contract/${ruleId}`,
        message: message || `File has fewer than minimum ${assertions.minLines} lines (has ${lines.length})`,
        severity,
        source: "custom",
        context: {
          expectedValue: `>= ${assertions.minLines}`,
          actualValue: `${lines.length}`,
        },
      });
    }
  }

  // mustHaveJSDoc: Exported functions must have JSDoc
  if (assertions.mustHaveJSDoc) {
    const exportedFuncRegex = /^(export\s+(?:async\s+)?function\s+\w+|export\s+(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\()/gm;
    let funcMatch: RegExpExecArray | null;
    while ((funcMatch = exportedFuncRegex.exec(content)) !== null) {
      const before = content.slice(0, funcMatch.index);
      const prevLines = before.split("\n");
      // Check if the line before has a JSDoc comment closing
      let hasJSDoc = false;
      for (let i = prevLines.length - 1; i >= 0; i--) {
        const trimmed = prevLines[i].trim();
        if (trimmed === "") continue;
        if (trimmed.endsWith("*/")) {
          hasJSDoc = true;
        }
        break;
      }
      if (!hasJSDoc) {
        const lineNum = before.split("\n").length;
        results.push({
          file,
          rule: `file-contract/${ruleId}`,
          message: message || `Exported function at line ${lineNum} must have JSDoc`,
          severity,
          source: "custom",
          line: lineNum,
        });
      }
    }
  }

  // maxExports
  if (assertions.maxExports !== undefined) {
    const exportMatches = content.match(/\bexport\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum|async\s+function)\b/g);
    const reExportMatches = content.match(/\bexport\s+\{/g);
    const exportCount = (exportMatches?.length ?? 0) + (reExportMatches?.length ?? 0);
    if (exportCount > assertions.maxExports) {
      results.push({
        file,
        rule: `file-contract/${ruleId}`,
        message: message || `File has ${exportCount} exports, maximum allowed is ${assertions.maxExports}`,
        severity,
        source: "custom",
        context: {
          expectedValue: `<= ${assertions.maxExports}`,
          actualValue: `${exportCount}`,
        },
      });
    }
  }

  // mustBeModule
  if (assertions.mustBeModule) {
    const hasImportOrExport = /\b(?:import|export)\s/.test(content);
    if (!hasImportOrExport) {
      results.push({
        file,
        rule: `file-contract/${ruleId}`,
        message: message || "File must be a module (must have at least one import or export)",
        severity,
        source: "custom",
      });
    }
  }

  return results;
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

    // Check assertions (if defined)
    if (rule.assertions) {
      const assertionResults = checkAssertions(
        content,
        rule.assertions,
        file,
        rule.id,
        rule.severity,
        rule.message
      );
      results.push(...assertionResults);
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
