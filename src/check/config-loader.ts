import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getBuiltInPreset, listBuiltInPresets } from "../presets";
import {
  formatDiagnostic,
  formatPath,
  validateConfigShape,
  validateRule,
} from "./config-schema";
import {
  DEFAULT_CONFIG,
  DEFAULT_EXCLUDE,
  type ChaperoneConfig,
  type ConfigDiagnostic,
  type CustomRule,
  type RulesConfig,
  type ToolConfig,
} from "./types";

const CONFIG_FILENAME = ".chaperone.json";

/**
 * Thrown when the configuration cannot be used. Carries every diagnostic found,
 * so users can fix all problems in one pass. The CLI maps it to exit code 2.
 */
export class ConfigError extends Error {
  readonly diagnostics: ConfigDiagnostic[];

  constructor(diagnostics: ConfigDiagnostic[]) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.level === "error");
    super(
      errors.length === 1
        ? `Invalid configuration: ${formatDiagnostic(errors[0]!)}`
        : `Invalid configuration (${errors.length} errors):\n${errors
            .map((diagnostic) => `  - ${formatDiagnostic(diagnostic)}`)
            .join("\n")}`
    );
    this.name = "ConfigError";
    this.diagnostics = diagnostics;
  }
}

/**
 * The result of loading a configuration.
 */
export interface LoadedConfig {
  /** Merged configuration: defaults → presets (in order) → user config. Disabled rules removed. */
  config: ChaperoneConfig;
  /** Warnings found while loading (errors throw {@link ConfigError}) */
  diagnostics: ConfigDiagnostic[];
  /** Rules switched off with `disabled: true` */
  disabledRules: Array<{ id: string; source: string }>;
  /** Absolute path of the user's config file, or null when running with defaults */
  configPath: string | null;
}

/**
 * One config layer: a preset or the user's file, already validated.
 */
interface ConfigSource {
  label: string;
  config: Partial<ChaperoneConfig>;
  rules: CustomRule[];
}

interface LoadState {
  cwd: string;
  diagnostics: ConfigDiagnostic[];
  sources: ConfigSource[];
  /** Rule ids defined by sources loaded so far (used for override hints) */
  knownIds: Set<string>;
  /** Presets already loaded (built-in names and absolute paths): each is applied once */
  loadedPresets: Set<string>;
}

function displayPath(cwd: string, absolutePath: string): string {
  const relativePath = relative(cwd, absolutePath);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)
    ? relativePath
    : absolutePath;
}

function parseJsonFile(absolutePath: string, label: string, state: LoadState): unknown {
  let text: string;
  try {
    text = readFileSync(absolutePath, "utf-8");
  } catch (error) {
    state.diagnostics.push({
      level: "error",
      source: label,
      message: `cannot read file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    state.diagnostics.push({
      level: "error",
      source: label,
      message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

/**
 * Validate a raw config object and register it (and its extends chain) as sources.
 * Presets are registered before the config that extends them.
 */
function addSource(
  raw: unknown,
  label: string,
  baseDir: string | null,
  ancestry: string[],
  state: LoadState
): void {
  state.diagnostics.push(...validateConfigShape(raw, label));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return;
  }

  const config = raw as Partial<ChaperoneConfig> & { extends?: string | string[] };
  const extendsList =
    typeof config.extends === "string"
      ? [config.extends]
      : Array.isArray(config.extends)
        ? config.extends
        : [];

  extendsList.forEach((specifier, index) => {
    if (typeof specifier === "string") {
      resolveExtends(specifier, label, `extends[${index}]`, baseDir, ancestry, state);
    }
  });

  const rules: CustomRule[] = [];
  const customRules = config.rules?.custom;
  if (Array.isArray(customRules)) {
    const seenInSource = new Set<string>();
    customRules.forEach((entry, index) => {
      const path = ["rules", "custom", index];
      const validation = validateRule(entry, label, path);
      state.diagnostics.push(...validation.diagnostics);

      const id =
        typeof (entry as { id?: unknown } | null)?.id === "string" ? (entry as { id: string }).id : null;
      const hasErrors = validation.diagnostics.some((diagnostic) => diagnostic.level === "error");
      if (id && hasErrors && state.knownIds.has(id)) {
        state.diagnostics.push({
          level: "error",
          source: label,
          path: formatPath(path),
          ruleId: id,
          message:
            "this entry overrides an inherited rule with the same id. Overrides replace the whole rule: " +
            'copy every field you want to keep, or set "disabled": true to switch the inherited rule off',
        });
      }
      if (id && seenInSource.has(id)) {
        state.diagnostics.push({
          level: "warning",
          source: label,
          path: formatPath(path),
          ruleId: id,
          message: `duplicate rule id "${id}" in the same file; the later entry wins`,
        });
      }
      if (id) seenInSource.add(id);
      if (validation.rule) rules.push(validation.rule);
    });
  }

  for (const rule of rules) {
    state.knownIds.add(rule.id);
  }
  state.sources.push({ label, config, rules });
}

function resolveExtends(
  specifier: string,
  fromLabel: string,
  path: string,
  baseDir: string | null,
  ancestry: string[],
  state: LoadState
): void {
  const fail = (message: string) =>
    state.diagnostics.push({ level: "error", source: fromLabel, path, message });

  if (specifier.startsWith("chaperone/")) {
    const name = specifier.slice("chaperone/".length);
    const preset = getBuiltInPreset(name);
    if (!preset) {
      fail(
        `unknown built-in preset "${specifier}". Available presets: ${listBuiltInPresets()
          .map((preset) => `chaperone/${preset}`)
          .join(", ")}`
      );
      return;
    }
    if (ancestry.includes(specifier)) {
      fail(`circular preset dependency: ${[...ancestry, specifier].join(" → ")}`);
      return;
    }
    // A preset reached through several `extends` paths is applied once, at its first
    // position, so a later copy cannot undo overrides made in between.
    if (state.loadedPresets.has(specifier)) return;
    state.loadedPresets.add(specifier);
    addSource(preset, specifier, null, [...ancestry, specifier], state);
    return;
  }

  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (!isRelative && !isAbsolute(specifier)) {
    fail(
      `unsupported preset specifier "${specifier}". Use "chaperone/<name>" for built-in presets or a path starting with "./" or "../" for local files`
    );
    return;
  }

  if (!baseDir) {
    fail(`built-in presets cannot extend local files ("${specifier}")`);
    return;
  }

  // Nested extends resolve relative to the file that declares them.
  const absolutePath = resolve(baseDir, specifier);
  const label = displayPath(state.cwd, absolutePath);
  if (ancestry.includes(absolutePath)) {
    fail(
      `circular preset dependency: ${[...ancestry, absolutePath]
        .map((entry) => displayPath(state.cwd, entry))
        .join(" → ")}`
    );
    return;
  }
  if (!existsSync(absolutePath)) {
    fail(`preset file not found: ${label}`);
    return;
  }
  if (state.loadedPresets.has(absolutePath)) return;
  state.loadedPresets.add(absolutePath);

  const raw = parseJsonFile(absolutePath, label, state);
  if (raw === undefined) return;
  addSource(raw, label, dirname(absolutePath), [...ancestry, absolutePath], state);
}

function mergeToolConfig(base?: ToolConfig, override?: ToolConfig): ToolConfig | undefined {
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Merge validated sources in order. Custom rules are appended and de-duplicated by id
 * (later sources win); excludes accumulate; other fields are overridden.
 * Rules marked `disabled: true` are removed, whether or not the config uses `extends`.
 */
function mergeSources(sources: ConfigSource[]): {
  config: ChaperoneConfig;
  disabledRules: Array<{ id: string; source: string }>;
  finalRules: Map<string, { rule: CustomRule; source: string }>;
} {
  let config: ChaperoneConfig = {
    ...DEFAULT_CONFIG,
    rules: { ...DEFAULT_CONFIG.rules, custom: [] },
    exclude: [],
  };
  const byId = new Map<string, { rule: CustomRule; source: string }>();
  const exclude: string[] = [];

  for (const source of sources) {
    const partial = source.config;
    const rules: RulesConfig = { ...config.rules };

    if (partial.rules) {
      rules.typescript = mergeToolConfig(rules.typescript, partial.rules.typescript);
      rules.eslint = mergeToolConfig(rules.eslint, partial.rules.eslint);
      rules.prettier = mergeToolConfig(rules.prettier, partial.rules.prettier);
    }

    for (const rule of source.rules) {
      byId.set(rule.id, { rule, source: source.label });
    }

    if (Array.isArray(partial.exclude)) {
      exclude.push(...partial.exclude);
    }

    config = {
      ...config,
      version: partial.version ?? config.version,
      project: partial.project ? { ...config.project, ...partial.project } : config.project,
      rules,
      include: Array.isArray(partial.include) ? partial.include : config.include,
      integrations: partial.integrations
        ? { ...config.integrations, ...partial.integrations }
        : config.integrations,
      aiInstructions: partial.aiInstructions
        ? { ...DEFAULT_CONFIG.aiInstructions!, ...config.aiInstructions, ...partial.aiInstructions }
        : config.aiInstructions,
    };
  }

  const disabledRules: Array<{ id: string; source: string }> = [];
  const custom: CustomRule[] = [];
  for (const [id, entry] of byId) {
    if (entry.rule.disabled) {
      disabledRules.push({ id, source: entry.source });
    } else {
      custom.push(entry.rule);
    }
  }

  config.rules = { ...config.rules, custom };
  config.exclude = [...new Set(exclude)];
  delete config.extends;

  return { config, disabledRules, finalRules: byId };
}

/**
 * Load, validate and merge the configuration.
 *
 * @throws {ConfigError} when any source has errors, listing every problem found.
 */
export function loadConfigWithDiagnostics(cwd: string, configPath?: string): LoadedConfig {
  const resolvedPath = configPath ? resolve(cwd, configPath) : join(cwd, CONFIG_FILENAME);
  const state: LoadState = { cwd, diagnostics: [], sources: [], knownIds: new Set(), loadedPresets: new Set() };

  if (!existsSync(resolvedPath)) {
    if (configPath) {
      throw new ConfigError([
        { level: "error", source: configPath, message: `config file not found: ${resolvedPath}` },
      ]);
    }
    const { config } = mergeSources([]);
    return {
      config,
      diagnostics: [
        {
          level: "warning",
          source: CONFIG_FILENAME,
          message: `no ${CONFIG_FILENAME} found in ${cwd}; only the tool runners ran, with defaults (run "chaperone init" to create a config)`,
        },
      ],
      disabledRules: [],
      configPath: null,
    };
  }

  const label = displayPath(cwd, resolvedPath);
  const raw = parseJsonFile(resolvedPath, label, state);
  if (raw !== undefined) {
    addSource(raw, label, dirname(resolvedPath), [resolvedPath], state);
  }

  if (state.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    throw new ConfigError(state.diagnostics);
  }

  const { config, disabledRules, finalRules } = mergeSources(state.sources);

  // A disabled stub whose id nothing else defines switches nothing off: say so.
  for (const disabled of disabledRules) {
    const entry = finalRules.get(disabled.id);
    const definedElsewhere = state.sources.some(
      (source) =>
        source.label !== disabled.source && source.rules.some((rule) => rule.id === disabled.id)
    );
    const isStub = !entry || typeof (entry.rule as { type?: unknown }).type !== "string";
    if (isStub && !definedElsewhere) {
      state.diagnostics.push({
        level: "warning",
        source: disabled.source,
        ruleId: disabled.id,
        message: `rule "${disabled.id}" is disabled, but no preset defines a rule with that id, so nothing was switched off`,
      });
    }
  }

  return {
    config,
    diagnostics: state.diagnostics,
    disabledRules,
    configPath: resolvedPath,
  };
}

/**
 * Load chaperone configuration from file.
 *
 * @throws {ConfigError} when the configuration is invalid
 */
export function loadConfig(cwd: string, configPath?: string): ChaperoneConfig {
  return loadConfigWithDiagnostics(cwd, configPath).config;
}

/**
 * Validate a configuration object and return its error messages (empty when valid).
 * Loading validates automatically; this is kept for programmatic use.
 */
export function validateConfig(config: ChaperoneConfig): string[] {
  const diagnostics = validateConfigShape(config, "config");
  (config.rules?.custom ?? []).forEach((rule, index) => {
    diagnostics.push(...validateRule(rule, "config", ["rules", "custom", index]).diagnostics);
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.level === "error")
    .map((diagnostic) => formatDiagnostic(diagnostic));
}

/**
 * Get effective include/exclude patterns.
 * Excludes are always merged with {@link DEFAULT_EXCLUDE}; they never replace it.
 */
export function getEffectivePatterns(
  config: ChaperoneConfig,
  overrideInclude?: string[],
  overrideExclude?: string[]
): { include: string[]; exclude: string[] } {
  const exclude = [...DEFAULT_EXCLUDE, ...(overrideExclude ?? config.exclude ?? [])];
  return {
    include: overrideInclude ?? config.include ?? DEFAULT_CONFIG.include ?? [],
    exclude: [...new Set(exclude)],
  };
}
