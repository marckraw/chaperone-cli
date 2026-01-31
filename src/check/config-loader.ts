import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ChaperoneConfig, DEFAULT_CONFIG } from "./types";

const CONFIG_FILENAME = ".chaperone.json";

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
