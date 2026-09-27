import { createFileIndex } from "../../../utils/file-index";
import { createModuleResolver } from "../../../utils/module-resolver";
import type { RuleContext, RuleRunnerOptions } from "../types";
import { extractImports, type ImportEntry } from "./import-extractor";

export interface RuleContextOptions {
  /** Resolve tsconfig `paths`/`baseUrl` aliases (config: integrations.useTypescriptPaths, default true) */
  useTsconfigPaths?: boolean;
  /** Limit file-scoped rules to these files (`--since`) */
  changedFiles?: ReadonlySet<string>;
}

/**
 * Create the shared per-run rule context: a single pruned walk of `cwd`, a content
 * cache, an import cache and a module resolver.
 */
export function createRuleContext(
  cwd: string,
  exclude: readonly string[],
  options: RuleContextOptions = {}
): RuleContext {
  const index = createFileIndex(cwd, { exclude });
  const resolver = createModuleResolver({
    root: cwd,
    fileExists: (path) => index.has(path),
    useTsconfigPaths: options.useTsconfigPaths ?? true,
  });
  const importCache = new Map<string, ImportEntry[]>();

  return {
    cwd,
    index,
    imports(file: string): ImportEntry[] {
      const cached = importCache.get(file);
      if (cached) return cached;
      const content = index.read(file);
      const entries = content === null ? [] : extractImports(content, { filePath: file });
      importCache.set(file, entries);
      return entries;
    },
    resolveImport: (specifier, fromFile) => resolver.resolve(specifier, fromFile),
    inScope: (files) => {
      const changed = options.changedFiles;
      return changed ? files.filter((file) => changed.has(file)) : [...files];
    },
  };
}

/** Specifiers that look like project aliases rather than packages: "@/x", "~/x", "#x" */
const ALIAS_LIKE = /^(?:@\/|~|#)/;

/**
 * Collects alias-like specifiers that did not resolve, so import rules can say that
 * they could not follow them instead of silently ignoring them.
 */
export function createUnresolvedAliasTracker() {
  const unresolved = new Set<string>();
  return {
    record(specifier: string): void {
      if (ALIAS_LIKE.test(specifier)) unresolved.add(specifier);
    },
    notice(): string | null {
      if (unresolved.size === 0) return null;
      const examples = [...unresolved].slice(0, 3).map((specifier) => `"${specifier}"`).join(", ");
      return (
        `${unresolved.size} alias-like import specifier(s) did not resolve to project files (e.g. ${examples}), ` +
        "so they were not checked; declare the alias in tsconfig.json compilerOptions.paths"
      );
    },
  };
}

/**
 * The context passed in by the orchestrator, or a fresh one for standalone calls.
 */
export function getRuleContext(options: RuleRunnerOptions): RuleContext {
  return options.context ?? createRuleContext(options.cwd, options.exclude);
}
