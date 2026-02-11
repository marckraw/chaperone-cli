import { readFileSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve, basename } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, PublicApiRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { extractImports } from "./utils/import-extractor";

const EXTENSIONS_TO_TRY = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Discover module root directories matching the modules glob pattern.
 * E.g., "src/features/*" returns ["src/features/auth", "src/features/dashboard"]
 */
function discoverModuleRoots(
  modulesPattern: string,
  cwd: string,
  ignore: string[]
): string[] {
  const parts = modulesPattern.split("/");
  const lastPart = parts[parts.length - 1];

  if (lastPart === "*") {
    const parentPath = parts.slice(0, -1).join("/");
    const fullParentPath = join(cwd, parentPath);

    if (!existsSync(fullParentPath)) {
      return [];
    }

    try {
      const { readdirSync } = require("node:fs");
      const entries = readdirSync(fullParentPath, { withFileTypes: true });
      return entries
        .filter((e: any) => e.isDirectory())
        .map((e: any) => join(parentPath, e.name));
    } catch {
      return [];
    }
  }

  // Fallback: glob for files and extract unique module root paths
  const files = globSync(modulesPattern + "/**/*", { cwd, ignore });
  const roots = new Set<string>();
  for (const file of files) {
    const fileParts = file.split("/");
    if (fileParts.length > parts.length) {
      const rootPath = fileParts.slice(0, parts.length).join("/");
      roots.add(rootPath);
    }
  }
  return Array.from(roots).sort();
}

/**
 * Check if a resolved import path goes through a module's barrel file.
 */
function isBarrelImport(
  importSource: string,
  resolvedPath: string,
  moduleRoot: string,
  barrelFile: string
): boolean {
  // The import should resolve to the module root's barrel file
  const barrelPath = join(moduleRoot, barrelFile);

  // Check if resolved path IS the barrel file
  if (resolvedPath === barrelPath) return true;

  // Also check without extension
  const barrelNoExt = barrelPath.replace(/\.[^.]+$/, "");
  const resolvedNoExt = resolvedPath.replace(/\.[^.]+$/, "");
  if (resolvedNoExt === barrelNoExt) return true;

  // Check if import targets module root directly (will resolve to index)
  const resolvedDir = dirname(resolvedPath);
  if (
    resolvedDir === moduleRoot &&
    basename(resolvedPath).startsWith("index.")
  ) {
    return true;
  }

  return false;
}

export async function runPublicApiRule(
  rule: PublicApiRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const barrelFile = rule.barrelFile ?? "index.ts";
  const allowSameModule = rule.allowSameModule ?? true;

  // Discover module roots
  const moduleRoots = discoverModuleRoots(rule.modules, cwd, allExcludes);

  // Get all files to check
  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const imports = extractImports(content, {
      includeTypeImports: true,
      includeDynamicImports: true,
      includeRequire: true,
    });

    // Determine which module this file belongs to (if any)
    const fileModule = moduleRoots.find(
      (root) => file.startsWith(root + "/") || file === root
    );

    for (const imp of imports) {
      // Only check relative imports
      if (!imp.source.startsWith("./") && !imp.source.startsWith("../")) {
        continue;
      }

      // Resolve the import path
      const importingDir = dirname(join(cwd, file));
      const resolved = resolve(importingDir, imp.source);
      const relativeResolved = relative(cwd, resolved);

      // Find the actual file (try extensions)
      let resolvedPath: string | null = null;
      if (existsSync(resolved)) {
        resolvedPath = relativeResolved;
      } else {
        for (const ext of EXTENSIONS_TO_TRY) {
          const withExt = resolved + ext;
          if (existsSync(withExt)) {
            resolvedPath = relative(cwd, withExt);
            break;
          }
        }
        // Try index files
        if (!resolvedPath) {
          for (const ext of EXTENSIONS_TO_TRY) {
            const indexPath = join(resolved, "index" + ext);
            if (existsSync(indexPath)) {
              resolvedPath = relative(cwd, indexPath);
              break;
            }
          }
        }
      }

      if (!resolvedPath) continue;

      // Check if this import targets a module
      const targetModule = moduleRoots.find(
        (root) =>
          resolvedPath!.startsWith(root + "/") || resolvedPath === root
      );

      if (!targetModule) continue;

      // Same-module deep imports allowed if configured
      if (allowSameModule && fileModule === targetModule) continue;

      // Check if it goes through the barrel file
      if (!isBarrelImport(imp.source, resolvedPath, targetModule, barrelFile)) {
        results.push({
          file,
          rule: `public-api/${rule.id}`,
          message:
            rule.message ||
            `Import from "${targetModule}" must go through the public API (${barrelFile})`,
          severity: rule.severity,
          source: "custom",
          line: imp.line,
          context: {
            matchedText: imp.source,
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
  };
}

export function isPublicApiRule(rule: unknown): rule is PublicApiRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as PublicApiRule).type === "public-api"
  );
}
