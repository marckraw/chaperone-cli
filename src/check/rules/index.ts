import type { ChaperoneConfig, CheckResult, CustomRule } from "../types";
import type { RuleRunnerOptions, RuleResult } from "./types";
import { runFileNamingRule, isFileNamingRule } from "./file-naming";
import { runRegexRule, isRegexRule } from "./regex";
import {
  detectAIInstructionFiles,
  parseAIInstructions,
  runAIInstructionRules,
  isAIInstructionsRule,
} from "./ai-instructions";

export * from "./types";
export { runFileNamingRule, isFileNamingRule } from "./file-naming";
export { runRegexRule, isRegexRule } from "./regex";
export {
  detectAIInstructionFiles,
  parseAIInstructions,
  runAIInstructionRules,
  isAIInstructionsRule,
} from "./ai-instructions";

/**
 * Result from running all custom rules
 */
export interface AllRulesResult {
  results: CheckResult[];
  byRule: Record<string, RuleResult>;
  aiFilesDetected: string[];
}

/**
 * Run all custom rules
 */
export async function runAllRules(
  config: ChaperoneConfig,
  options: RuleRunnerOptions
): Promise<AllRulesResult> {
  const { cwd } = options;
  const allResults: CheckResult[] = [];
  const byRule: Record<string, RuleResult> = {};
  const aiFilesDetected: string[] = [];

  // Run custom rules from config
  const customRules = config.rules?.custom ?? [];

  for (const rule of customRules) {
    let result: RuleResult | null = null;

    if (isFileNamingRule(rule)) {
      result = await runFileNamingRule(rule, options);
    } else if (isRegexRule(rule)) {
      result = await runRegexRule(rule, options);
    } else if (isAIInstructionsRule(rule)) {
      const results = await runAIInstructionRules([rule], options);
      result = results[0] ?? null;
    }

    if (result) {
      byRule[rule.id] = result;
      allResults.push(...result.results);
    }
  }

  // Detect and run AI instruction rules
  const aiConfig = config.aiInstructions;
  if (aiConfig?.autoDetect !== false) {
    const aiFiles = detectAIInstructionFiles(cwd, aiConfig);
    aiFilesDetected.push(...aiFiles.map((f) => f.path));

    if (aiConfig?.extractRules !== false && aiFiles.length > 0) {
      const aiRules = parseAIInstructions(aiFiles);
      const aiResults = await runAIInstructionRules(aiRules, options);

      for (const result of aiResults) {
        byRule[result.ruleId] = result;
        allResults.push(...result.results);
      }
    }
  }

  return {
    results: allResults,
    byRule,
    aiFilesDetected,
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
    } else if (isAIInstructionsRule(rule)) {
      // AI rules are auto-generated, minimal validation
    } else {
      errors.push(`Rule '${ruleId}' has unknown type: ${ruleType}`);
    }
  }

  return errors;
}
