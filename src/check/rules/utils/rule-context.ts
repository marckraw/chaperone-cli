import { createFileIndex } from "../../../utils/file-index";
import { createModuleResolver } from "../../../utils/module-resolver";
import type { RuleContext, RuleRunnerOptions } from "../types";
import { extractImports, type ImportEntry } from "./import-extractor";

export interface RuleContextOptions {
  /** Resolve tsconfig `paths`/`baseUrl` aliases (config: integrations.useTypescriptPaths, default true) */
  useTsconfigPaths?: boolean;
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
  };
}

/**
 * The context passed in by the orchestrator, or a fresh one for standalone calls.
 */
export function getRuleContext(options: RuleRunnerOptions): RuleContext {
  return options.context ?? createRuleContext(options.cwd, options.exclude);
}
