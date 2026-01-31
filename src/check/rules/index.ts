import type { ChaperoneConfig, CheckResult, CustomRule } from "../types";
import type { RuleRunnerOptions, RuleResult } from "./types";
import { runFileNamingRule, isFileNamingRule } from "./file-naming";
import { runRegexRule, isRegexRule } from "./regex";
import { runPackageFieldsRule, isPackageFieldsRule } from "./package-fields";
import { runComponentLocationRule, isComponentLocationRule } from "./component-location";

export * from "./types";
export { runFileNamingRule, isFileNamingRule } from "./file-naming";
export { runRegexRule, isRegexRule } from "./regex";
export { runPackageFieldsRule, isPackageFieldsRule } from "./package-fields";
export { runComponentLocationRule, isComponentLocationRule } from "./component-location";
export { detectAIInstructionFiles } from "./ai-instructions";

/**
 * Result from running all custom rules
 */
export interface AllRulesResult {
  results: CheckResult[];
  byRule: Record<string, RuleResult>;
}

/**
 * Run all custom rules
 */
export async function runAllRules(
  config: ChaperoneConfig,
  options: RuleRunnerOptions
): Promise<AllRulesResult> {
  const { onDebug } = options;
  const allResults: CheckResult[] = [];
  const byRule: Record<string, RuleResult> = {};

  // Run custom rules from config
  const customRules = config.rules?.custom ?? [];

  onDebug?.(`Found ${customRules.length} custom rule(s) in config`);

  for (const rule of customRules) {
    let result: RuleResult | null = null;
    const isAIGenerated = !!rule.source;
    const typeLabel = isAIGenerated ? `${rule.type}*` : rule.type;
    const excludeInfo = rule.exclude?.length ? ` (excluding: ${rule.exclude.join(", ")})` : "";

    if (isFileNamingRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking pattern "${rule.pattern}"${excludeInfo}`);
      result = await runFileNamingRule(rule, options);
    } else if (isRegexRule(rule)) {
      const mode = rule.mustMatch ? "must match" : "must NOT match";
      onDebug?.(`  [${typeLabel}] ${rule.id}: ${mode} /${rule.pattern}/ in "${rule.files}"${excludeInfo}`);
      result = await runRegexRule(rule, options);
    } else if (isPackageFieldsRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking package.json fields [${rule.requiredFields.join(", ")}]`);
      result = await runPackageFieldsRule(rule, options);
    } else if (isComponentLocationRule(rule)) {
      const mode = rule.mustBeIn ? "must be in" : "must NOT be in";
      onDebug?.(`  [${typeLabel}] ${rule.id}: ${rule.componentType} components ${mode} "${rule.requiredLocation}"${excludeInfo}`);
      result = await runComponentLocationRule(rule, options);
    }

    if (result) {
      byRule[rule.id] = result;
      allResults.push(...result.results);
      const issues = result.results.length;
      if (issues > 0) {
        onDebug?.(`    → ${issues} issue(s) found`);
      } else {
        onDebug?.(`    → passed`);
      }
    }
  }

  return {
    results: allResults,
    byRule,
  };
}

/**
 * Validate custom rules
 */
export function validateCustomRules(rules: CustomRule[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const ruleId = rule.id;
    const ruleType = rule.type;

    if (!ruleId) {
      errors.push(`Rule at index ${i} is missing 'id'`);
    }

    if (!ruleType) {
      errors.push(`Rule '${ruleId || i}' is missing 'type'`);
      continue;
    }

    if (isFileNamingRule(rule)) {
      if (!rule.pattern) {
        errors.push(`File naming rule '${ruleId}' is missing 'pattern'`);
      }
    } else if (isRegexRule(rule)) {
      if (!rule.pattern) {
        errors.push(`Regex rule '${ruleId}' is missing 'pattern'`);
      }
      if (!rule.files) {
        errors.push(`Regex rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.message) {
        errors.push(`Regex rule '${ruleId}' is missing 'message'`);
      }
      // Validate regex syntax
      if (rule.pattern) {
        try {
          new RegExp(rule.pattern);
        } catch {
          errors.push(`Regex rule '${ruleId}' has invalid pattern: ${rule.pattern}`);
        }
      }
    } else if (isPackageFieldsRule(rule)) {
      if (!rule.requiredFields || rule.requiredFields.length === 0) {
        errors.push(`Package fields rule '${ruleId}' is missing 'requiredFields'`);
      }
    } else if (isComponentLocationRule(rule)) {
      if (!rule.files) {
        errors.push(`Component location rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.componentType) {
        errors.push(`Component location rule '${ruleId}' is missing 'componentType'`);
      }
      if (!rule.requiredLocation) {
        errors.push(`Component location rule '${ruleId}' is missing 'requiredLocation'`);
      }
    } else {
      errors.push(`Rule '${ruleId}' has unknown type: ${ruleType}`);
    }
  }

  return errors;
}
