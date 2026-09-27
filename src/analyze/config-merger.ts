import type { ChaperoneConfig, CustomRule } from "../check/types";

/**
 * A config file exactly as written (parsed JSON), not the merged result of its presets.
 */
export type RawConfig = Record<string, unknown>;

export interface SkippedRule {
  rule: CustomRule;
  reason: string;
}

export interface MergeResult {
  /** The patched raw config: every field the user wrote is kept (extends, excludes, ...) */
  config: RawConfig;
  added: CustomRule[];
  skipped: SkippedRule[];
}

export interface MergeOptions {
  /** Replace AI-generated rules (those with `source`) already in the file */
  force?: boolean;
  /** Rule ids defined by presets the config extends; reusing one would override the preset rule */
  inheritedIds?: ReadonlySet<string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if a rule was AI-generated (has source metadata)
 */
export function isAIGeneratedRule(rule: unknown): boolean {
  return isPlainObject(rule) && typeof rule["source"] === "string";
}

/**
 * Get count of AI-generated rules in config
 */
export function countAIRules(config: ChaperoneConfig | RawConfig): number {
  const rules = (config as { rules?: { custom?: unknown } }).rules?.custom;
  return Array.isArray(rules) ? rules.filter(isAIGeneratedRule).length : 0;
}

/**
 * Add extracted rules to the user's own config file (never to the merged config, so
 * presets are not inlined and `extends` is kept).
 *
 * Two modes:
 * - Light (default): only add rules with ids that are not used yet
 * - Force: drop the AI-generated rules already in the file, then add the new ones
 */
export function mergeRulesIntoRawConfig(
  raw: RawConfig | null,
  extractedRules: CustomRule[],
  options: MergeOptions = {}
): MergeResult {
  const config: RawConfig = raw ? structuredClone(raw) : { version: "1.0.0", rules: { custom: [] } };
  const rules = isPlainObject(config["rules"]) ? { ...config["rules"] } : {};
  let custom: unknown[] = Array.isArray(rules["custom"]) ? [...rules["custom"]] : [];

  if (options.force) {
    custom = custom.filter((rule) => !isAIGeneratedRule(rule));
  }

  const ownIds = new Set(
    custom.map((rule) => (isPlainObject(rule) && typeof rule["id"] === "string" ? rule["id"] : null)).filter(Boolean)
  );
  const added: CustomRule[] = [];
  const skipped: SkippedRule[] = [];

  for (const rule of extractedRules) {
    if (ownIds.has(rule.id)) {
      skipped.push({ rule, reason: `a rule with id "${rule.id}" already exists in the config` });
    } else if (options.inheritedIds?.has(rule.id)) {
      skipped.push({ rule, reason: `id "${rule.id}" is used by an extended preset; adding it would override that rule` });
    } else {
      ownIds.add(rule.id);
      added.push(rule);
    }
  }

  config["rules"] = { ...rules, custom: [...custom, ...added] };
  return { config, added, skipped };
}

/**
 * @deprecated Use {@link mergeRulesIntoRawConfig}; kept for API compatibility.
 */
export function mergeRules(
  config: ChaperoneConfig,
  extractedRules: CustomRule[],
  force = false
): { config: ChaperoneConfig; added: CustomRule[]; skipped: CustomRule[] } {
  const result = mergeRulesIntoRawConfig(config as unknown as RawConfig, extractedRules, { force });
  return {
    config: result.config as unknown as ChaperoneConfig,
    added: result.added,
    skipped: result.skipped.map((entry) => entry.rule),
  };
}
