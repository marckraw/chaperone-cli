import { basename, posix } from "node:path";
import type { FileIndex } from "../../utils/file-index";
import { compileGlob, normalizeGlob } from "../../utils/glob";
import type { CheckResult, PublicApiRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { createUnresolvedAliasTracker, getRuleContext } from "./utils/rule-context";

/**
 * Discover module root directories matching the modules glob pattern.
 * E.g., "src/features/*" returns ["src/features/auth", "src/features/dashboard"]
 */
function discoverModuleRoots(
  modulesPattern: string,
  index: FileIndex,
  ignore: readonly string[]
): string[] {
  const pattern = normalizeGlob(modulesPattern).replace(/\/+$/, "");
  const isModuleRoot = compileGlob(pattern);
  const roots = new Set<string>();
  // The module root of a file is its shortest parent directory that matches `modules`
  // (this also works for patterns with `**`, such as "src/**/features/*").
  for (const file of index.glob(`${pattern}/**`, ignore)) {
    const segments = file.split("/");
    let directory = "";
    for (let position = 0; position < segments.length - 1; position++) {
      directory = position === 0 ? segments[0]! : `${directory}/${segments[position]}`;
      if (isModuleRoot(directory)) {
        roots.add(directory);
        break;
      }
    }
  }
  return Array.from(roots).sort();
}

/** File name without its extension(s): "index.ts" → "index", "types.d.ts" → "types" */
function stem(path: string): string {
  return basename(path).replace(/(\.d)?\.[^.]+$/, "");
}

/**
 * Whether a resolved import target is the module's public entry point.
 * `import "../features/auth"` resolves to `src/features/auth/index.ts` and passes;
 * the barrel may use any extension (index.ts, index.tsx, index.js, ...).
 */
export function isBarrelFile(resolvedPath: string, moduleRoot: string, barrelFile: string): boolean {
  return posix.dirname(resolvedPath) === moduleRoot && stem(resolvedPath) === stem(barrelFile);
}

export async function runPublicApiRule(
  rule: PublicApiRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const { index } = context;
  const results: CheckResult[] = [];
  const notices: string[] = [];

  const barrelFile = rule.barrelFile ?? "index.ts";
  const allowSameModule = rule.allowSameModule ?? true;

  // Discover module roots
  const moduleRoots = discoverModuleRoots(rule.modules, index, rule.exclude ?? []);
  if (moduleRoots.length === 0) {
    notices.push(`"modules" (${rule.modules}) matched no module directories`);
  }

  // The most specific module containing a path
  const moduleOf = (path: string) =>
    moduleRoots
      .filter((root) => path.startsWith(`${root}/`))
      .reduce<string | undefined>((best, root) => (!best || root.length > best.length ? root : best), undefined);

  // Get all files to check
  const files = index.glob(rule.files, rule.exclude ?? []);
  const unresolvedAliases = createUnresolvedAliasTracker();

  for (const file of context.inScope(files)) {
    const fileModule = moduleOf(file);

    for (const entry of context.imports(file)) {
      // Relative imports and tsconfig aliases both resolve to project files
      const resolvedPath = context.resolveImport(entry.source, file);
      if (!resolvedPath) {
        unresolvedAliases.record(entry.source);
        continue;
      }

      // Check if this import targets a module
      const targetModule = moduleOf(resolvedPath);
      if (!targetModule) continue;

      // Same-module deep imports allowed if configured
      if (allowSameModule && fileModule === targetModule) continue;

      // Check if it goes through the barrel file
      if (!isBarrelFile(resolvedPath, targetModule, barrelFile)) {
        results.push({
          file,
          rule: `public-api/${rule.id}`,
          message:
            rule.message ||
            `Import from "${targetModule}" must go through the public API (${barrelFile})`,
          severity: rule.severity,
          source: "custom",
          line: entry.line,
          context: {
            matchedText: entry.source,
            expectedValue: `Import via ${targetModule}/${barrelFile}`,
            actualValue: `Deep import: ${resolvedPath}`,
          },
        });
      }
    }
  }

  const aliasNotice = unresolvedAliases.notice();
  if (aliasNotice) notices.push(aliasNotice);

  return {
    ruleId: rule.id,
    results,
    // Without module directories nothing can be checked, whatever `files` matches
    filesChecked: moduleRoots.length === 0 ? 0 : files.length,
    notices,
  };
}

export function isPublicApiRule(rule: unknown): rule is PublicApiRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as PublicApiRule).type === "public-api"
  );
}
