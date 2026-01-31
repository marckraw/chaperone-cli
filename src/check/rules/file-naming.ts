import { existsSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, FileNamingRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

/**
 * Apply transform pattern to create companion file path
 * $1 refers to the filename without extension
 */
function applyTransform(filePath: string, transform: string): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const baseName = basename(filePath, ext);

  // Replace $1 with the base name
  const transformedName = transform.replace(/\$1/g, baseName);

  return join(dir, transformedName);
}

/**
 * Run file naming rule
 */
export async function runFileNamingRule(
  rule: FileNamingRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  // Merge global excludes with rule-specific excludes
  const allExcludes = [...exclude, ...(rule.exclude ?? [])];

  // Find files matching the pattern
  const files = globSync(rule.pattern, {
    cwd,
    ignore: allExcludes,
  });

  for (const file of files) {
    // Check if companion file is required
    if (rule.requireCompanion) {
      const companionPath = applyTransform(file, rule.requireCompanion.transform);
      const fullCompanionPath = join(cwd, companionPath);

      if (!existsSync(fullCompanionPath)) {
        results.push({
          file,
          rule: `file-naming/${rule.id}`,
          message: rule.message || `Missing companion file: ${companionPath}`,
          severity: rule.severity,
          source: "custom",
          suggestion: `Create file: ${companionPath}`,
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
 * Check if a rule is a FileNamingRule
 */
export function isFileNamingRule(rule: unknown): rule is FileNamingRule {
  return (
    typeof rule === "object" && rule !== null && (rule as FileNamingRule).type === "file-naming"
  );
}
