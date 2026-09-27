import type { CheckResult, ImportBoundaryRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

/**
 * Enforce architectural layer boundaries.
 *
 * Every import that resolves to a project file is checked: relative imports,
 * directory imports (index files), `.js` specifiers for `.ts` sources, and tsconfig
 * `paths`/`baseUrl` aliases such as `@/features/x`. Packages are ignored.
 */
export async function runImportBoundaryRule(
  rule: ImportBoundaryRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const { index } = context;
  const results: CheckResult[] = [];
  const notices: string[] = [];

  const includeTypeImports = rule.includeTypeImports ?? true;
  const includeDynamicImports = rule.includeDynamicImports ?? true;

  // Step 1: Build fileToLayer map (when globs overlap, the layer listed last wins)
  const fileToLayer = new Map<string, string>();
  const emptyLayers: string[] = [];

  for (const [layerName, layerConfig] of Object.entries(rule.layers)) {
    const layerFiles = index.glob(layerConfig.files, rule.exclude ?? []);
    if (layerFiles.length === 0) {
      emptyLayers.push(`${layerName} (${layerConfig.files})`);
    }
    for (const file of layerFiles) {
      fileToLayer.set(file, layerName);
    }
  }

  if (emptyLayers.length > 0 && emptyLayers.length < Object.keys(rule.layers).length) {
    notices.push(`layers with no matching files: ${emptyLayers.join(", ")}`);
  }

  // A layer whose files all belong to a later, overlapping layer enforces nothing
  const assigned = new Set(fileToLayer.values());
  const shadowed = Object.entries(rule.layers)
    .filter(([layerName, layerConfig]) => !assigned.has(layerName) && index.glob(layerConfig.files, rule.exclude ?? []).length > 0)
    .map(([layerName]) => layerName);
  if (shadowed.length > 0) {
    notices.push(
      `layers whose files all match a later layer (the layer listed last wins): ${shadowed.join(", ")}`
    );
  }

  // Step 2: For each file in any layer, check its imports (layer membership uses every file)
  const inScope = new Set(context.inScope([...fileToLayer.keys()]));
  for (const [file, sourceLayer] of fileToLayer.entries()) {
    if (!inScope.has(file)) continue;
    const allowedLayers = new Set(rule.layers[sourceLayer]?.allowImportsFrom ?? []);

    for (const entry of context.imports(file)) {
      if (!includeTypeImports && entry.isTypeImport) continue;
      if (!includeDynamicImports && entry.isDynamic) continue;

      const resolvedPath = context.resolveImport(entry.source, file);
      if (!resolvedPath) continue;

      const targetLayer = fileToLayer.get(resolvedPath);
      if (!targetLayer) continue; // Not in any defined layer

      // Self-layer imports are always allowed
      if (targetLayer === sourceLayer) continue;

      if (!allowedLayers.has(targetLayer)) {
        const allowed = Array.from(allowedLayers);
        results.push({
          file,
          rule: `import-boundary/${rule.id}`,
          message:
            rule.message ||
            `Layer "${sourceLayer}" cannot import from layer "${targetLayer}". Allowed: ${allowed.join(", ") || "none"}`,
          severity: rule.severity,
          source: "custom",
          line: entry.line,
          context: {
            matchedText: entry.source,
            expectedValue: `Import from: ${allowed.join(", ") || "self only"}`,
            actualValue: `Imports ${resolvedPath} (layer "${targetLayer}")`,
          },
        });
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
    filesChecked: fileToLayer.size,
    notices,
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
