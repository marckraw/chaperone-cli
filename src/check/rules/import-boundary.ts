import { readFileSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, ImportBoundaryRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { extractImports } from "./utils/import-extractor";

const EXTENSIONS_TO_TRY = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/**
 * Resolve a relative import to a file path relative to cwd.
 * Tries common extensions if the exact path doesn't exist.
 */
function resolveImportPath(
  importSource: string,
  importingFile: string,
  cwd: string
): string | null {
  if (!importSource.startsWith("./") && !importSource.startsWith("../")) {
    return null; // Skip bare specifiers (npm packages)
  }

  const importingDir = dirname(join(cwd, importingFile));
  const resolved = resolve(importingDir, importSource);
  const relativeResolved = relative(cwd, resolved);

  // Try exact path first
  if (existsSync(resolved)) {
    return relativeResolved;
  }

  // Try with extensions
  for (const ext of EXTENSIONS_TO_TRY) {
    const withExt = resolved + ext;
    if (existsSync(withExt)) {
      return relative(cwd, withExt);
    }
  }

  return null;
}

export async function runImportBoundaryRule(
  rule: ImportBoundaryRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const includeTypeImports = rule.includeTypeImports ?? true;
  const includeDynamicImports = rule.includeDynamicImports ?? true;

  // Step 1: Build fileToLayer map
  const fileToLayer = new Map<string, string>();

  for (const [layerName, layerConfig] of Object.entries(rule.layers)) {
    const layerFiles = globSync(layerConfig.files, {
      cwd,
      ignore: allExcludes,
    });

    for (const file of layerFiles) {
      fileToLayer.set(file, layerName);
    }
  }

  // Step 2: For each file in any layer, check its imports
  for (const [file, sourceLayer] of fileToLayer.entries()) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const imports = extractImports(content, {
      includeTypeImports,
      includeDynamicImports,
      includeRequire: true,
    });

    const allowedLayers = new Set(
      rule.layers[sourceLayer].allowImportsFrom
    );

    for (const imp of imports) {
      // Only check relative imports
      if (!imp.source.startsWith("./") && !imp.source.startsWith("../")) {
        continue;
      }

      const resolvedPath = resolveImportPath(imp.source, file, cwd);
      if (!resolvedPath) continue;

      const targetLayer = fileToLayer.get(resolvedPath);
      if (!targetLayer) continue; // Not in any defined layer

      // Self-layer imports are always allowed
      if (targetLayer === sourceLayer) continue;

      if (!allowedLayers.has(targetLayer)) {
        results.push({
          file,
          rule: `import-boundary/${rule.id}`,
          message:
            rule.message ||
            `Layer "${sourceLayer}" cannot import from layer "${targetLayer}". Allowed: ${Array.from(allowedLayers).join(", ") || "none"}`,
          severity: rule.severity,
          source: "custom",
          line: imp.line,
          context: {
            matchedText: imp.source,
            expectedValue: `Import from: ${Array.from(allowedLayers).join(", ") || "self only"}`,
            actualValue: `Imports from: ${targetLayer}`,
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

export function isImportBoundaryRule(
  rule: unknown
): rule is ImportBoundaryRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as ImportBoundaryRule).type === "import-boundary"
  );
}
