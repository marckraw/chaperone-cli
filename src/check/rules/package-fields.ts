import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, PackageFieldsRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

/**
 * Run package-fields rule to validate package.json has required fields
 */
export async function runPackageFieldsRule(
  rule: PackageFieldsRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd } = options;
  const results: CheckResult[] = [];

  const packagePath = join(cwd, "package.json");

  if (!existsSync(packagePath)) {
    results.push({
      file: "package.json",
      rule: `package-fields/${rule.id}`,
      message: "package.json not found",
      severity: rule.severity,
      source: "custom",
    });
    return { ruleId: rule.id, results };
  }

  let packageJson: Record<string, unknown>;
  try {
    const content = readFileSync(packagePath, "utf-8");
    packageJson = JSON.parse(content);
  } catch (err) {
    results.push({
      file: "package.json",
      rule: `package-fields/${rule.id}`,
      message: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
      severity: rule.severity,
      source: "custom",
    });
    return { ruleId: rule.id, results };
  }

  // Check required fields
  for (const field of rule.requiredFields) {
    const value = getNestedField(packageJson, field);

    if (value === undefined) {
      results.push({
        file: "package.json",
        rule: `package-fields/${rule.id}`,
        message: rule.message || `Missing required field: "${field}"`,
        severity: rule.severity,
        source: "custom",
        suggestion: `Add "${field}" field to package.json`,
        context: {
          field,
          expectedValue: `Field "${field}" should exist`,
          actualValue: "undefined (field not found)",
        },
      });
    }
  }

  // Check forbidden fields
  if (rule.forbiddenFields) {
    for (const field of rule.forbiddenFields) {
      const value = getNestedField(packageJson, field);

      if (value !== undefined) {
        results.push({
          file: "package.json",
          rule: `package-fields/${rule.id}`,
          message: `Forbidden field found: "${field}"`,
          severity: rule.severity,
          source: "custom",
          suggestion: `Remove "${field}" field from package.json`,
          context: {
            field,
            expectedValue: "Field should not exist",
            actualValue: JSON.stringify(value),
          },
        });
      }
    }
  }

  // Check field values match expected patterns
  if (rule.fieldPatterns) {
    // Track fields already reported as missing from requiredFields
    const missingFields = new Set(
      rule.requiredFields.filter((f) => getNestedField(packageJson, f) === undefined)
    );

    for (const [field, pattern] of Object.entries(rule.fieldPatterns)) {
      const value = getNestedField(packageJson, field);

      if (value === undefined) {
        // Skip if already reported as missing in requiredFields
        if (missingFields.has(field)) {
          continue;
        }
        // Field doesn't exist - report missing
        results.push({
          file: "package.json",
          rule: `package-fields/${rule.id}`,
          message: rule.message || `Missing field "${field}" (should match pattern: ${pattern})`,
          severity: rule.severity,
          source: "custom",
          suggestion: `Add "${field}" field matching pattern: ${pattern}`,
          context: {
            field,
            expectedValue: `Must match pattern: /${pattern}/`,
            actualValue: "undefined (field not found)",
          },
        });
      } else if (typeof value === "string") {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          results.push({
            file: "package.json",
            rule: `package-fields/${rule.id}`,
            message: rule.message || `Field "${field}" does not match required pattern: ${pattern}`,
            severity: rule.severity,
            source: "custom",
            suggestion: `Change "${field}" to match pattern: ${pattern}`,
            context: {
              field,
              expectedValue: `Must match pattern: /${pattern}/`,
              actualValue: JSON.stringify(value),
            },
          });
        }
      }
    }
  }

  return { ruleId: rule.id, results };
}

/**
 * Get nested field from object using dot notation (e.g., "scripts.build")
 */
function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a rule is a PackageFieldsRule
 */
export function isPackageFieldsRule(rule: unknown): rule is PackageFieldsRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as PackageFieldsRule).type === "package-fields"
  );
}
