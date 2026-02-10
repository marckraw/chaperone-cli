import type { ChaperoneConfig, CheckResult, CustomRule } from "../types";
import type { RuleRunnerOptions, RuleResult } from "./types";
import { runFileNamingRule, isFileNamingRule } from "./file-naming";
import { runFilePairingRule, isFilePairingRule } from "./file-pairing";
import { runFileContractRule, isFileContractRule } from "./file-contract";
import { runRegexRule, isRegexRule } from "./regex";
import { runPackageFieldsRule, isPackageFieldsRule } from "./package-fields";
import { runComponentLocationRule, isComponentLocationRule } from "./component-location";
import { runCommandRule, isCommandRule } from "./command";
import { runSymbolReferenceRule, isSymbolReferenceRule } from "./symbol-reference";
import { runRetiredPathRule, isRetiredPathRule } from "./retired-path";
import { runFileSuffixContentRule, isFileSuffixContentRule } from "./file-suffix-content";
import { runFileStructureRule, isFileStructureRule } from "./file-structure";
import { runForbiddenImportRule, isForbiddenImportRule } from "./forbidden-import";
import { runImportBoundaryRule, isImportBoundaryRule } from "./import-boundary";
import { runPublicApiRule, isPublicApiRule } from "./public-api";
import { runRelationshipRule, isRelationshipRule } from "./relationship";

export * from "./types";
export { runFileNamingRule, isFileNamingRule } from "./file-naming";
export { runFilePairingRule, isFilePairingRule } from "./file-pairing";
export { runFileContractRule, isFileContractRule } from "./file-contract";
export { runRegexRule, isRegexRule } from "./regex";
export { runPackageFieldsRule, isPackageFieldsRule } from "./package-fields";
export { runComponentLocationRule, isComponentLocationRule } from "./component-location";
export { runCommandRule, isCommandRule } from "./command";
export { runSymbolReferenceRule, isSymbolReferenceRule } from "./symbol-reference";
export { runRetiredPathRule, isRetiredPathRule } from "./retired-path";
export { runFileSuffixContentRule, isFileSuffixContentRule } from "./file-suffix-content";
export { runFileStructureRule, isFileStructureRule } from "./file-structure";
export { runForbiddenImportRule, isForbiddenImportRule } from "./forbidden-import";
export { runImportBoundaryRule, isImportBoundaryRule } from "./import-boundary";
export { runPublicApiRule, isPublicApiRule } from "./public-api";
export { runRelationshipRule, isRelationshipRule } from "./relationship";
export { detectAIInstructionFiles } from "./ai-instructions";

/**
 * Result from running all custom rules
 */
export interface AllRulesResult {
  results: CheckResult[];
  byRule: Record<string, RuleResult>;
}

/**
 * Run all custom rules
 */
export async function runAllRules(
  config: ChaperoneConfig,
  options: RuleRunnerOptions
): Promise<AllRulesResult> {
  const { onDebug } = options;
  const allResults: CheckResult[] = [];
  const byRule: Record<string, RuleResult> = {};

  // Run custom rules from config
  const customRules = config.rules?.custom ?? [];

  onDebug?.(`Found ${customRules.length} custom rule(s) in config`);

  for (const rule of customRules) {
    let result: RuleResult | null = null;
    const isAIGenerated = !!rule.source;
    const typeLabel = isAIGenerated ? `${rule.type}*` : rule.type;
    const excludeInfo = rule.exclude?.length ? ` (excluding: ${rule.exclude.join(", ")})` : "";

    if (isFileNamingRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking pattern "${rule.pattern}"${excludeInfo}`);
      result = await runFileNamingRule(rule, options);
    } else if (isFilePairingRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking pairing for "${rule.files}"${excludeInfo}`);
      result = await runFilePairingRule(rule, options);
    } else if (isFileContractRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking file contract in "${rule.files}"${excludeInfo}`);
      result = await runFileContractRule(rule, options);
    } else if (isRegexRule(rule)) {
      const mode = rule.mustMatch ? "must match" : "must NOT match";
      onDebug?.(`  [${typeLabel}] ${rule.id}: ${mode} /${rule.pattern}/ in "${rule.files}"${excludeInfo}`);
      result = await runRegexRule(rule, options);
    } else if (isPackageFieldsRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking package.json fields [${rule.requiredFields.join(", ")}]`);
      result = await runPackageFieldsRule(rule, options);
    } else if (isComponentLocationRule(rule)) {
      const mode = rule.mustBeIn ? "must be in" : "must NOT be in";
      onDebug?.(`  [${typeLabel}] ${rule.id}: ${rule.componentType} components ${mode} "${rule.requiredLocation}"${excludeInfo}`);
      result = await runComponentLocationRule(rule, options);
    } else if (isCommandRule(rule)) {
      const commandDisplay = [rule.command, ...(rule.args ?? [])].join(" ").trim();
      onDebug?.(`  [${typeLabel}] ${rule.id}: running command "${commandDisplay}"`);
      result = await runCommandRule(rule, options);
    } else if (isSymbolReferenceRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking exported symbols from "${rule.sourceFiles}" against "${rule.targetFiles}"${excludeInfo}`);
      result = await runSymbolReferenceRule(rule, options);
    } else if (isRetiredPathRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking retired paths (${rule.paths.length} pattern(s))${excludeInfo}`);
      result = await runRetiredPathRule(rule, options);
    } else if (isFileSuffixContentRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking content for files with suffix "${rule.suffix}" in "${rule.files}"${excludeInfo}`);
      result = await runFileSuffixContentRule(rule, options);
    } else if (isFileStructureRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking structure in "${rule.parentDirs}"${excludeInfo}`);
      result = await runFileStructureRule(rule, options);
    } else if (isForbiddenImportRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking forbidden imports in "${rule.files}"${excludeInfo}`);
      result = await runForbiddenImportRule(rule, options);
    } else if (isImportBoundaryRule(rule)) {
      const layerNames = Object.keys(rule.layers).join(", ");
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking import boundaries across layers [${layerNames}]${excludeInfo}`);
      result = await runImportBoundaryRule(rule, options);
    } else if (isPublicApiRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking public API imports for modules "${rule.modules}"${excludeInfo}`);
      result = await runPublicApiRule(rule, options);
    } else if (isRelationshipRule(rule)) {
      onDebug?.(`  [${typeLabel}] ${rule.id}: checking relationships for "${rule.when.files}"${excludeInfo}`);
      result = await runRelationshipRule(rule, options);
    }

    if (result) {
      byRule[rule.id] = result;
      allResults.push(...result.results);
      const issues = result.results.length;
      if (issues > 0) {
        onDebug?.(`    → ${issues} issue(s) found`);
      } else {
        onDebug?.(`    → passed`);
      }
    }
  }

  return {
    results: allResults,
    byRule,
  };
}

/**
 * Validate custom rules
 */
export function validateCustomRules(rules: CustomRule[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const ruleId = rule.id;
    const ruleType = rule.type;

    if (!ruleId) {
      errors.push(`Rule at index ${i} is missing 'id'`);
    }

    if (!ruleType) {
      errors.push(`Rule '${ruleId || i}' is missing 'type'`);
      continue;
    }

    if (isFileNamingRule(rule)) {
      if (!rule.pattern) {
        errors.push(`File naming rule '${ruleId}' is missing 'pattern'`);
      }
    } else if (isFilePairingRule(rule)) {
      if (!rule.files) {
        errors.push(`File pairing rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.pair?.from) {
        errors.push(`File pairing rule '${ruleId}' is missing 'pair.from'`);
      }
      if (!rule.pair?.to) {
        errors.push(`File pairing rule '${ruleId}' is missing 'pair.to'`);
      }
      if (rule.pair?.from) {
        try {
          new RegExp(rule.pair.from);
        } catch {
          errors.push(`File pairing rule '${ruleId}' has invalid pair.from regex: ${rule.pair.from}`);
        }
      }
    } else if (isFileContractRule(rule)) {
      if (!rule.files) {
        errors.push(`File contract rule '${ruleId}' is missing 'files'`);
      }

      const hasContract =
        !!rule.requiredPatterns?.length ||
        !!rule.requiredAnyPatterns?.length ||
        !!rule.forbiddenPatterns?.length ||
        !!rule.templatedRequiredPatterns?.length ||
        !!rule.templatedRequiredAnyPatterns?.length ||
        !!rule.templatedForbiddenPatterns?.length ||
        !!rule.assertions;

      if (!hasContract) {
        errors.push(`File contract rule '${ruleId}' must define at least one contract pattern list or assertions`);
      }

      const patternBuckets = [
        ...(rule.requiredPatterns ?? []),
        ...(rule.requiredAnyPatterns ?? []),
        ...(rule.forbiddenPatterns ?? []),
        ...(rule.templatedRequiredPatterns ?? []),
        ...(rule.templatedRequiredAnyPatterns ?? []),
        ...(rule.templatedForbiddenPatterns ?? []),
      ];

      for (const pattern of patternBuckets) {
        try {
          new RegExp(pattern);
        } catch {
          errors.push(`File contract rule '${ruleId}' has invalid regex pattern: ${pattern}`);
        }
      }

      if (rule.captureFromPath?.pattern) {
        try {
          new RegExp(rule.captureFromPath.pattern);
        } catch {
          errors.push(`File contract rule '${ruleId}' has invalid captureFromPath.pattern: ${rule.captureFromPath.pattern}`);
        }
      }
    } else if (isRegexRule(rule)) {
      if (!rule.pattern) {
        errors.push(`Regex rule '${ruleId}' is missing 'pattern'`);
      }
      if (!rule.files) {
        errors.push(`Regex rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.message) {
        errors.push(`Regex rule '${ruleId}' is missing 'message'`);
      }
      // Validate regex syntax
      if (rule.pattern) {
        try {
          new RegExp(rule.pattern);
        } catch {
          errors.push(`Regex rule '${ruleId}' has invalid pattern: ${rule.pattern}`);
        }
      }
    } else if (isPackageFieldsRule(rule)) {
      if (!rule.requiredFields || rule.requiredFields.length === 0) {
        errors.push(`Package fields rule '${ruleId}' is missing 'requiredFields'`);
      }
    } else if (isComponentLocationRule(rule)) {
      if (!rule.files) {
        errors.push(`Component location rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.componentType) {
        errors.push(`Component location rule '${ruleId}' is missing 'componentType'`);
      }
      if (!rule.requiredLocation) {
        errors.push(`Component location rule '${ruleId}' is missing 'requiredLocation'`);
      }
    } else if (isCommandRule(rule)) {
      if (!rule.command) {
        errors.push(`Command rule '${ruleId}' is missing 'command'`);
      }

      if (rule.stdoutPattern) {
        try {
          new RegExp(rule.stdoutPattern);
        } catch {
          errors.push(`Command rule '${ruleId}' has invalid stdoutPattern: ${rule.stdoutPattern}`);
        }
      }

      if (rule.stderrPattern) {
        try {
          new RegExp(rule.stderrPattern);
        } catch {
          errors.push(`Command rule '${ruleId}' has invalid stderrPattern: ${rule.stderrPattern}`);
        }
      }
    } else if (isSymbolReferenceRule(rule)) {
      if (!rule.sourceFiles) {
        errors.push(`Symbol reference rule '${ruleId}' is missing 'sourceFiles'`);
      }
      if (!rule.targetFiles) {
        errors.push(`Symbol reference rule '${ruleId}' is missing 'targetFiles'`);
      }
      if (rule.symbolPattern) {
        try {
          new RegExp(rule.symbolPattern);
        } catch {
          errors.push(`Symbol reference rule '${ruleId}' has invalid symbolPattern: ${rule.symbolPattern}`);
        }
      }
    } else if (isRetiredPathRule(rule)) {
      if (!rule.paths || rule.paths.length === 0) {
        errors.push(`Retired path rule '${ruleId}' is missing 'paths'`);
      }
      if (rule.paths) {
        for (const entry of rule.paths) {
          if (!entry.pattern) {
            errors.push(`Retired path rule '${ruleId}' has a path entry missing 'pattern'`);
          }
        }
      }
    } else if (isFileSuffixContentRule(rule)) {
      if (!rule.suffix) {
        errors.push(`File suffix content rule '${ruleId}' is missing 'suffix'`);
      }
      if (!rule.files) {
        errors.push(`File suffix content rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.forbiddenPatterns?.length && !rule.requiredPatterns?.length) {
        errors.push(`File suffix content rule '${ruleId}' must define at least one pattern list`);
      }
      for (const entry of [...(rule.forbiddenPatterns ?? []), ...(rule.requiredPatterns ?? [])]) {
        try {
          new RegExp(entry.pattern);
        } catch {
          errors.push(`File suffix content rule '${ruleId}' has invalid regex for "${entry.name}": ${entry.pattern}`);
        }
      }
    } else if (isFileStructureRule(rule)) {
      if (!rule.parentDirs) {
        errors.push(`File structure rule '${ruleId}' is missing 'parentDirs'`);
      }
      if (!rule.required || rule.required.length === 0) {
        errors.push(`File structure rule '${ruleId}' is missing 'required'`);
      }
    } else if (isForbiddenImportRule(rule)) {
      if (!rule.files) {
        errors.push(`Forbidden import rule '${ruleId}' is missing 'files'`);
      }
      if (!rule.restrictions?.length && !rule.checkPatterns?.length) {
        errors.push(`Forbidden import rule '${ruleId}' must define at least one restriction or checkPattern`);
      }
      if (rule.restrictions) {
        for (const r of rule.restrictions) {
          if (!r.source) {
            errors.push(`Forbidden import rule '${ruleId}' has a restriction missing 'source'`);
          }
          if (r.source) {
            try {
              new RegExp(r.source);
            } catch {
              errors.push(`Forbidden import rule '${ruleId}' has invalid restriction source regex: ${r.source}`);
            }
          }
          if (!r.allowedIn?.length) {
            errors.push(`Forbidden import rule '${ruleId}' has a restriction missing 'allowedIn'`);
          }
        }
      }
      if (rule.checkPatterns) {
        for (const cp of rule.checkPatterns) {
          if (!cp.pattern) {
            errors.push(`Forbidden import rule '${ruleId}' has a checkPattern missing 'pattern'`);
          }
          if (cp.pattern) {
            try {
              new RegExp(cp.pattern);
            } catch {
              errors.push(`Forbidden import rule '${ruleId}' has invalid checkPattern regex: ${cp.pattern}`);
            }
          }
        }
      }
    } else if (isImportBoundaryRule(rule)) {
      if (!rule.layers || Object.keys(rule.layers).length === 0) {
        errors.push(`Import boundary rule '${ruleId}' is missing 'layers'`);
      }
      if (rule.layers) {
        const layerNames = Object.keys(rule.layers);
        for (const [name, config] of Object.entries(rule.layers)) {
          if (!config.files) {
            errors.push(`Import boundary rule '${ruleId}' layer "${name}" is missing 'files'`);
          }
          if (!Array.isArray(config.allowImportsFrom)) {
            errors.push(`Import boundary rule '${ruleId}' layer "${name}" is missing 'allowImportsFrom'`);
          }
          if (config.allowImportsFrom) {
            for (const ref of config.allowImportsFrom) {
              if (!layerNames.includes(ref)) {
                errors.push(`Import boundary rule '${ruleId}' layer "${name}" references unknown layer: ${ref}`);
              }
            }
          }
        }
      }
    } else if (isPublicApiRule(rule)) {
      if (!rule.modules) {
        errors.push(`Public API rule '${ruleId}' is missing 'modules'`);
      }
      if (!rule.files) {
        errors.push(`Public API rule '${ruleId}' is missing 'files'`);
      }
    } else if (isRelationshipRule(rule)) {
      if (!rule.when?.files) {
        errors.push(`Relationship rule '${ruleId}' is missing 'when.files'`);
      }
      if (!rule.then || rule.then.length === 0) {
        errors.push(`Relationship rule '${ruleId}' is missing 'then' actions`);
      }
    } else {
      errors.push(`Rule '${ruleId}' has unknown type: ${ruleType}`);
    }
  }

  return errors;
}
