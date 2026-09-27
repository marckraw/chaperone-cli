import { basename, posix } from "node:path";
import type { FileIndex } from "../../utils/file-index";
import type { CheckResult, PublicApiRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

/**
 * Discover module root directories matching the modules glob pattern.
 * E.g., "src/features/*" returns ["src/features/auth", "src/features/dashboard"]
 */
function discoverModuleRoots(
  modulesPattern: string,
  index: FileIndex,
  ignore: readonly string[]
): string[] {
  const parts = modulesPattern.replace(/\/+$/, "").split("/");
  const files = index.glob(`${parts.join("/")}/**`, ignore);
  const roots = new Set<string>();
  for (const file of files) {
    const fileParts = file.split("/");
    if (fileParts.length > parts.length) {
      roots.add(fileParts.slice(0, parts.length).join("/"));
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

  const moduleOf = (path: string) => moduleRoots.find((root) => path.startsWith(`${root}/`));

  // Get all files to check
  const files = index.glob(rule.files, rule.exclude ?? []);

  for (const file of context.inScope(files)) {
    const fileModule = moduleOf(file);

    for (const entry of context.imports(file)) {
      // Relative imports and tsconfig aliases both resolve to project files
      const resolvedPath = context.resolveImport(entry.source, file);
      if (!resolvedPath) continue;

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

  return {
    ruleId: rule.id,
    results,
    filesChecked: files.length,
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
