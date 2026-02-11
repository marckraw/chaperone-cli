import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { ChaperoneConfig, CustomRule, DEFAULT_CONFIG } from "./types";
import { getBuiltInPreset } from "../presets";
import type { ChaperonePreset } from "../presets";

const CONFIG_FILENAME = ".chaperone.json";

/**
 * Resolve extends specifiers to preset configs, then merge into a base config.
 * Supports:
 *   - "chaperone/<name>" → built-in preset
 *   - "./<path>" or "../<path>" → local JSON file relative to configDir
 */
function resolveExtends(
  specifiers: string[],
  configDir: string,
  ancestry: Set<string> = new Set()
): Partial<ChaperoneConfig>[] {
  const resolved: Partial<ChaperoneConfig>[] = [];

  for (const specifier of specifiers) {
    if (ancestry.has(specifier)) {
      throw new Error(`Circular preset dependency detected: ${specifier}`);
    }

    const newAncestry = new Set(ancestry);
    newAncestry.add(specifier);

    let preset: ChaperonePreset | Partial<ChaperoneConfig> | null = null;

    if (specifier.startsWith("chaperone/")) {
      const name = specifier.slice("chaperone/".length);
      preset = getBuiltInPreset(name);
      if (!preset) {
        throw new Error(`Unknown built-in preset: ${specifier}. Available presets: ${["react-layered"].join(", ")}`);
      }
    } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const presetPath = resolve(configDir, specifier);
      if (!existsSync(presetPath)) {
        throw new Error(`Preset file not found: ${presetPath}`);
      }
      try {
        const content = readFileSync(presetPath, "utf-8");
        preset = JSON.parse(content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load preset from ${presetPath}: ${message}`);
      }
    } else {
      throw new Error(`Unsupported preset specifier: "${specifier}". Use "chaperone/<name>" for built-in presets or "./<path>" for local files.`);
    }

    if (!preset) continue;

    // Recursively resolve nested extends
    const nestedExtends = (preset as ChaperonePreset).extends ?? (preset as Partial<ChaperoneConfig>).extends;
    if (nestedExtends && nestedExtends.length > 0) {
      const nestedResolved = resolveExtends(nestedExtends, configDir, newAncestry);
      resolved.push(...nestedResolved);
    }

    // Convert preset to partial config shape
    const partialConfig: Partial<ChaperoneConfig> = {
      rules: (preset as ChaperonePreset).rules ?? (preset as Partial<ChaperoneConfig>).rules,
      include: (preset as ChaperonePreset).include ?? (preset as Partial<ChaperoneConfig>).include,
      exclude: (preset as ChaperonePreset).exclude ?? (preset as Partial<ChaperoneConfig>).exclude,
      integrations: (preset as ChaperonePreset).integrations ?? (preset as Partial<ChaperoneConfig>).integrations,
    };

    resolved.push(partialConfig);
  }

  return resolved;
}

/**
 * Merge custom rules arrays: append + deduplicate by id (later wins).
 * Rules with disabled: true are filtered out.
 */
function mergeCustomRules(
  base: CustomRule[],
  override: CustomRule[]
): CustomRule[] {
  const byId = new Map<string, CustomRule>();

  for (const rule of base) {
    byId.set(rule.id, rule);
  }

  for (const rule of override) {
    byId.set(rule.id, rule);
  }

  // Filter out disabled rules
  return Array.from(byId.values()).filter((rule) => !rule.disabled);
}

/**
 * Load chaperone configuration from file
 */
export function loadConfig(cwd: string, configPath?: string): ChaperoneConfig {
  const resolvedPath = configPath ? resolve(cwd, configPath) : join(cwd, CONFIG_FILENAME);
  const isExplicitPath = !!configPath;

  if (!existsSync(resolvedPath)) {
    if (isExplicitPath) {
      // Error if user explicitly specified a config that doesn't exist
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    // Return default config if no config file exists
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<ChaperoneConfig>;
    const configDir = dirname(resolvedPath);

    // Resolve extends chain
    if (parsed.extends && parsed.extends.length > 0) {
      const presetConfigs = resolveExtends(parsed.extends, configDir);

      // Build merged config: DEFAULT → preset1 → preset2 → ... → user config
      let merged = { ...DEFAULT_CONFIG };
      for (const presetConfig of presetConfigs) {
        merged = mergeConfigWithCustomRuleMerge(merged, presetConfig);
      }
      merged = mergeConfigWithCustomRuleMerge(merged, parsed);
      return merged;
    }

    // Merge with defaults
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config from ${resolvedPath}: ${message}`);
  }
}

/**
 * Deep merge configuration objects
 */
function mergeConfig(
  defaults: ChaperoneConfig,
  overrides: Partial<ChaperoneConfig>
): ChaperoneConfig {
  const result = { ...defaults };

  if (overrides.version) {
    result.version = overrides.version;
  }

  if (overrides.project) {
    result.project = { ...defaults.project, ...overrides.project };
  }

  if (overrides.rules) {
    result.rules = {
      ...defaults.rules,
      ...overrides.rules,
      typescript: overrides.rules.typescript
        ? { ...defaults.rules?.typescript, ...overrides.rules.typescript }
        : defaults.rules?.typescript,
      eslint: overrides.rules.eslint
        ? { ...defaults.rules?.eslint, ...overrides.rules.eslint }
        : defaults.rules?.eslint,
      prettier: overrides.rules.prettier
        ? { ...defaults.rules?.prettier, ...overrides.rules.prettier }
        : defaults.rules?.prettier,
      custom: overrides.rules.custom ?? defaults.rules?.custom,
    };
  }

  if (overrides.include) {
    result.include = overrides.include;
  }

  if (overrides.exclude) {
    result.exclude = overrides.exclude;
  }

  if (overrides.integrations) {
    result.integrations = { ...defaults.integrations, ...overrides.integrations };
  }

  if (overrides.aiInstructions) {
    result.aiInstructions = {
      ...defaults.aiInstructions,
      ...overrides.aiInstructions,
    };
  }

  return result;
}

/**
 * Deep merge configuration objects with custom rules merge strategy (append + dedup by id)
 */
function mergeConfigWithCustomRuleMerge(
  defaults: ChaperoneConfig,
  overrides: Partial<ChaperoneConfig>
): ChaperoneConfig {
  const result = { ...defaults };

  if (overrides.version) {
    result.version = overrides.version;
  }

  if (overrides.project) {
    result.project = { ...defaults.project, ...overrides.project };
  }

  if (overrides.rules) {
    const baseCustom = defaults.rules?.custom ?? [];
    const overrideCustom = overrides.rules.custom ?? [];

    result.rules = {
      ...defaults.rules,
      ...overrides.rules,
      typescript: overrides.rules.typescript
        ? { ...defaults.rules?.typescript, ...overrides.rules.typescript }
        : defaults.rules?.typescript,
      eslint: overrides.rules.eslint
        ? { ...defaults.rules?.eslint, ...overrides.rules.eslint }
        : defaults.rules?.eslint,
      prettier: overrides.rules.prettier
        ? { ...defaults.rules?.prettier, ...overrides.rules.prettier }
        : defaults.rules?.prettier,
      custom: mergeCustomRules(baseCustom, overrideCustom),
    };
  }

  if (overrides.include) {
    result.include = overrides.include;
  }

  if (overrides.exclude) {
    result.exclude = overrides.exclude;
  }

  if (overrides.integrations) {
    result.integrations = { ...defaults.integrations, ...overrides.integrations };
  }

  if (overrides.aiInstructions) {
    result.aiInstructions = {
      ...defaults.aiInstructions,
      ...overrides.aiInstructions,
    };
  }

  return result;
}

/**
 * Validate configuration
 */
export function validateConfig(config: ChaperoneConfig): string[] {
  const errors: string[] = [];

  if (!config.version) {
    errors.push("Missing version field");
  }

  if (config.rules?.custom) {
    for (let i = 0; i < config.rules.custom.length; i++) {
      const rule = config.rules.custom[i];
      const ruleId = rule.id;
      const ruleType = rule.type;

      if (!ruleId) {
        errors.push(`Custom rule at index ${i} is missing 'id'`);
      }

      if (!ruleType) {
        errors.push(`Custom rule '${ruleId || i}' is missing 'type'`);
      }

      if (ruleType === "file-naming") {
        if (!rule.pattern) {
          errors.push(`File naming rule '${ruleId}' is missing 'pattern'`);
        }
      }

      if (ruleType === "file-pairing") {
        if (!rule.files) {
          errors.push(`File pairing rule '${ruleId}' is missing 'files'`);
        }

        if (!rule.pair?.from) {
          errors.push(`File pairing rule '${ruleId}' is missing 'pair.from'`);
        }

        if (!rule.pair?.to) {
          errors.push(`File pairing rule '${ruleId}' is missing 'pair.to'`);
        }
      }

      if (ruleType === "file-contract") {
        if (!rule.files) {
          errors.push(`File contract rule '${ruleId}' is missing 'files'`);
        }
      }

      if (ruleType === "regex") {
        if (!rule.pattern) {
          errors.push(`Regex rule '${ruleId}' is missing 'pattern'`);
        }
        if (!rule.files) {
          errors.push(`Regex rule '${ruleId}' is missing 'files'`);
        }
        if (!rule.message) {
          errors.push(`Regex rule '${ruleId}' is missing 'message'`);
        }
      }

      if (ruleType === "package-fields") {
        if (!rule.requiredFields || !Array.isArray(rule.requiredFields) || rule.requiredFields.length === 0) {
          errors.push(`Package fields rule '${ruleId}' is missing 'requiredFields'`);
        }
      }

      if (ruleType === "component-location") {
        if (!rule.files) {
          errors.push(`Component location rule '${ruleId}' is missing 'files'`);
        }
        if (!rule.componentType) {
          errors.push(`Component location rule '${ruleId}' is missing 'componentType'`);
        }
        if (!rule.requiredLocation) {
          errors.push(`Component location rule '${ruleId}' is missing 'requiredLocation'`);
        }
      }

      if (ruleType === "command") {
        if (!rule.command) {
          errors.push(`Command rule '${ruleId}' is missing 'command'`);
        }
      }

      if (ruleType === "symbol-reference") {
        if (!rule.sourceFiles) {
          errors.push(`Symbol reference rule '${ruleId}' is missing 'sourceFiles'`);
        }
        if (!rule.targetFiles) {
          errors.push(`Symbol reference rule '${ruleId}' is missing 'targetFiles'`);
        }
      }

      if (ruleType === "retired-path") {
        if (!rule.paths || !Array.isArray(rule.paths) || rule.paths.length === 0) {
          errors.push(`Retired path rule '${ruleId}' is missing 'paths'`);
        }
      }

      if (ruleType === "file-suffix-content") {
        if (!rule.suffix) {
          errors.push(`File suffix content rule '${ruleId}' is missing 'suffix'`);
        }
        if (!rule.files) {
          errors.push(`File suffix content rule '${ruleId}' is missing 'files'`);
        }
      }

      if (ruleType === "file-structure") {
        if (!rule.parentDirs) {
          errors.push(`File structure rule '${ruleId}' is missing 'parentDirs'`);
        }
        if (!rule.required || !Array.isArray(rule.required) || rule.required.length === 0) {
          errors.push(`File structure rule '${ruleId}' is missing 'required'`);
        }
      }

      if (ruleType === "forbidden-import") {
        if (!rule.files) {
          errors.push(`Forbidden import rule '${ruleId}' is missing 'files'`);
        }
      }

      if (ruleType === "import-boundary") {
        if (!rule.layers || typeof rule.layers !== "object" || Object.keys(rule.layers).length === 0) {
          errors.push(`Import boundary rule '${ruleId}' is missing 'layers'`);
        }
      }

      if (ruleType === "public-api") {
        if (!rule.modules) {
          errors.push(`Public API rule '${ruleId}' is missing 'modules'`);
        }
        if (!rule.files) {
          errors.push(`Public API rule '${ruleId}' is missing 'files'`);
        }
      }

      if (ruleType === "relationship") {
        if (!rule.when?.files) {
          errors.push(`Relationship rule '${ruleId}' is missing 'when.files'`);
        }
        if (!rule.then || !Array.isArray(rule.then) || rule.then.length === 0) {
          errors.push(`Relationship rule '${ruleId}' is missing 'then'`);
        }
      }
    }
  }

  return errors;
}

/**
 * Get effective include/exclude patterns
 */
export function getEffectivePatterns(
  config: ChaperoneConfig,
  overrideInclude?: string[],
  overrideExclude?: string[]
): { include: string[]; exclude: string[] } {
  return {
    include: overrideInclude ?? config.include ?? DEFAULT_CONFIG.include ?? [],
    exclude: overrideExclude ?? config.exclude ?? DEFAULT_CONFIG.exclude ?? [],
  };
}
