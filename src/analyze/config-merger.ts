import type { ChaperoneConfig, CustomRule } from "../check/types";

export interface MergeResult {
  config: ChaperoneConfig;
  added: CustomRule[];
  skipped: CustomRule[];
}

/**
 * Check if a rule was AI-generated (has source metadata)
 */
export function isAIGeneratedRule(rule: CustomRule): boolean {
  return typeof rule.source === "string";
}

/**
 * Get count of AI-generated rules in config
 */
export function countAIRules(config: ChaperoneConfig): number {
  return (config.rules?.custom ?? []).filter(isAIGeneratedRule).length;
}

/**
 * Merge extracted rules into existing configuration
 *
 * Two modes:
 * - Light (default): Only add rules with new IDs
 * - Force: Replace all AI-generated rules (those with source field), keep manually added ones
 */
export function mergeRules(
  config: ChaperoneConfig,
  extractedRules: CustomRule[],
  force = false
): MergeResult {
  const existingRules = config.rules?.custom ?? [];
  const added: CustomRule[] = [];
  const skipped: CustomRule[] = [];

  if (force) {
    // Keep non-AI rules (those without source), replace AI-generated rules
    const manualRules = existingRules.filter((r) => !isAIGeneratedRule(r));

    // All extracted rules are added in force mode
    added.push(...extractedRules);

    const newConfig: ChaperoneConfig = {
      ...config,
      rules: {
        ...config.rules,
        custom: [...manualRules, ...extractedRules],
      },
    };

    return { config: newConfig, added, skipped };
  }

  // Light mode: Only add rules with new IDs
  const existingIds = new Set(existingRules.map((r) => r.id));

  for (const rule of extractedRules) {
    if (existingIds.has(rule.id)) {
      skipped.push(rule);
    } else {
      added.push(rule);
    }
  }

  const newConfig: ChaperoneConfig = {
    ...config,
    rules: {
      ...config.rules,
      custom: [...existingRules, ...added],
    },
  };

  return { config: newConfig, added, skipped };
}
