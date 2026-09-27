import type { ChaperoneConfig, CheckResult, CustomRule } from "../types";
import { formatDiagnostic, validateRule } from "../config-schema";
import type { RuleRunnerOptions, RuleResult } from "./types";
import { runFilePairingRule, isFilePairingRule } from "./file-pairing";
import { runFileContractRule, isFileContractRule } from "./file-contract";
import { runRegexRule, isRegexRule } from "./regex";
import { runPackageFieldsRule, isPackageFieldsRule } from "./package-fields";
import { runComponentLocationRule, isComponentLocationRule } from "./component-location";
import {
  runReactComponentCountRule,
  isReactComponentCountRule,
} from "./react-component-count";
import { runCommandRule, isCommandRule } from "./command";
import { runSymbolReferenceRule, isSymbolReferenceRule } from "./symbol-reference";
import { runRetiredPathRule, isRetiredPathRule } from "./retired-path";
import { runForbiddenImportRule, isForbiddenImportRule } from "./forbidden-import";
import { runImportBoundaryRule, isImportBoundaryRule } from "./import-boundary";
import { runPublicApiRule, isPublicApiRule } from "./public-api";
import {
  runDirectiveExportPatternRule,
  isDirectiveExportPatternRule,
} from "./directive-export-pattern";

export * from "./types";
export { runFilePairingRule, isFilePairingRule } from "./file-pairing";
export { runFileContractRule, isFileContractRule } from "./file-contract";
export { runRegexRule, isRegexRule } from "./regex";
export { runPackageFieldsRule, isPackageFieldsRule } from "./package-fields";
export { runComponentLocationRule, isComponentLocationRule } from "./component-location";
export {
  runReactComponentCountRule,
  isReactComponentCountRule,
} from "./react-component-count";
export { runCommandRule, isCommandRule } from "./command";
export { runSymbolReferenceRule, isSymbolReferenceRule } from "./symbol-reference";
export { runRetiredPathRule, isRetiredPathRule } from "./retired-path";
export { runForbiddenImportRule, isForbiddenImportRule } from "./forbidden-import";
export { runImportBoundaryRule, isImportBoundaryRule } from "./import-boundary";
export { runPublicApiRule, isPublicApiRule } from "./public-api";
export {
  runDirectiveExportPatternRule,
  isDirectiveExportPatternRule,
} from "./directive-export-pattern";
export { detectAIInstructionFiles } from "./ai-instructions";

/**
 * Result from running all custom rules
 */
export interface AllRulesResult {
  results: CheckResult[];
  byRule: Record<string, RuleResult>;
}

type Debug = RuleRunnerOptions["onDebug"];

/**
 * Run one rule with the runner for its type.
 */
async function dispatchRule(rule: CustomRule, options: RuleRunnerOptions, onDebug: Debug): Promise<RuleResult> {
  const typeLabel = rule.source ? `${rule.type}*` : rule.type;
  const excludeInfo = rule.exclude?.length ? ` (excluding: ${rule.exclude.join(", ")})` : "";
  const debug = (message: string) => onDebug?.(`  [${typeLabel}] ${rule.id}: ${message}${excludeInfo}`);

  if (isFilePairingRule(rule)) {
    debug(`checking pairing for "${rule.files}"`);
    return runFilePairingRule(rule, options);
  }
  if (isFileContractRule(rule)) {
    debug(`checking file contract in "${rule.files}"`);
    return runFileContractRule(rule, options);
  }
  if (isRegexRule(rule)) {
    debug(`${rule.mustMatch ? "must match" : "must NOT match"} /${rule.pattern}/ in "${rule.files}"`);
    return runRegexRule(rule, options);
  }
  if (isPackageFieldsRule(rule)) {
    debug(`checking package.json fields [${(rule.requiredFields ?? []).join(", ")}]`);
    return runPackageFieldsRule(rule, options);
  }
  if (isComponentLocationRule(rule)) {
    debug(`${rule.componentType} components ${rule.mustBeIn ? "must be in" : "must NOT be in"} "${rule.requiredLocation}"`);
    return runComponentLocationRule(rule, options);
  }
  if (isReactComponentCountRule(rule)) {
    debug(`limiting React components to ${rule.maxComponents ?? 1} per file in "${rule.files}"`);
    return runReactComponentCountRule(rule, options);
  }
  if (isCommandRule(rule)) {
    debug(`running command "${[rule.command, ...(rule.args ?? [])].join(" ").trim()}"`);
    return runCommandRule(rule, options);
  }
  if (isSymbolReferenceRule(rule)) {
    debug(`checking exported symbols from "${rule.sourceFiles}" against "${rule.targetFiles}"`);
    return runSymbolReferenceRule(rule, options);
  }
  if (isRetiredPathRule(rule)) {
    debug(`checking retired paths (${rule.paths.length} pattern(s))`);
    return runRetiredPathRule(rule, options);
  }
  if (isForbiddenImportRule(rule)) {
    debug(`checking forbidden imports in "${rule.files}"`);
    return runForbiddenImportRule(rule, options);
  }
  if (isImportBoundaryRule(rule)) {
    debug(`checking import boundaries across layers [${Object.keys(rule.layers).join(", ")}]`);
    return runImportBoundaryRule(rule, options);
  }
  if (isPublicApiRule(rule)) {
    debug(`checking public API imports for modules "${rule.modules}"`);
    return runPublicApiRule(rule, options);
  }
  if (isDirectiveExportPatternRule(rule)) {
    debug(`checking exports in files with "${rule.directive}"`);
    return runDirectiveExportPatternRule(rule, options);
  }

  // Unreachable for validated configs; never skip a rule silently.
  const unknownRule = rule as unknown as { id: string; type?: unknown };
  return errorResult(unknownRule.id, `config/${unknownRule.id}`, `Unknown rule type "${String(unknownRule.type)}"`);
}

function errorResult(ruleId: string, ruleName: string, message: string): RuleResult {
  return {
    ruleId,
    results: [{ file: ".chaperone.json", rule: ruleName, message, severity: "error", source: "custom" }],
  };
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
  const customRules = config.rules?.custom ?? [];

  onDebug?.(`Found ${customRules.length} custom rule(s) in config`);

  for (const [position, rule] of customRules.entries()) {
    const rawId = (rule as { id?: unknown } | undefined)?.id;
    const ruleId = typeof rawId === "string" ? rawId : `#${position}`;

    // Configs loaded from disk are validated already; this guards programmatic callers.
    const problems = validateRule(rule, "config", ["rules", "custom", position]).diagnostics.filter(
      (diagnostic) => diagnostic.level === "error"
    );

    let result: RuleResult;
    if (problems.length > 0) {
      result = {
        ruleId,
        results: problems.map((diagnostic) => ({
          file: ".chaperone.json",
          rule: `config/${ruleId}`,
          message: `Invalid rule: ${formatDiagnostic(diagnostic)}`,
          severity: "error",
          source: "custom",
        })),
      };
    } else {
      try {
        result = await dispatchRule(rule, options, onDebug);
      } catch (error) {
        // A crashing rule fails the check loudly instead of vanishing or aborting the run.
        const detail = error instanceof Error ? error.message : String(error);
        result = errorResult(ruleId, `${rule.type}/${ruleId}`, `Rule crashed: ${detail}`);
      }
    }

    byRule[ruleId] = result;
    allResults.push(...result.results);
    onDebug?.(result.results.length > 0 ? `    → ${result.results.length} issue(s) found` : "    → passed");
  }

  return {
    results: allResults,
    byRule,
  };
}
