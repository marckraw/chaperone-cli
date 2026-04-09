import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, SymbolReferenceRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

interface ExportedSymbol {
  name: string;
  line: number;
}

interface TargetReferenceScope {
  files: string[];
  content: string;
  expectedLabel: string;
}

const FUNCTION_DECLARATION_REGEX = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
const FUNCTION_VARIABLE_ARROW_REGEX =
  /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+?)?\s*=>/gm;
const FUNCTION_VARIABLE_EXPRESSION_REGEX = /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/gm;

function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function collectMatches(content: string, regex: RegExp): ExportedSymbol[] {
  const results: ExportedSymbol[] = [];
  let match: RegExpExecArray | null = null;
  regex.lastIndex = 0;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (!name) {
      continue;
    }
    results.push({
      name,
      line: getLineNumber(content, match.index),
    });
  }

  return results;
}

function extractExportedSymbols(
  content: string,
  kinds: Array<"function-declaration" | "function-variable">
): ExportedSymbol[] {
  const all: ExportedSymbol[] = [];

  if (kinds.includes("function-declaration")) {
    all.push(...collectMatches(content, FUNCTION_DECLARATION_REGEX));
  }

  if (kinds.includes("function-variable")) {
    all.push(...collectMatches(content, FUNCTION_VARIABLE_ARROW_REGEX));
    all.push(...collectMatches(content, FUNCTION_VARIABLE_EXPRESSION_REGEX));
  }

  const uniqueByName = new Map<string, ExportedSymbol>();
  for (const symbol of all) {
    if (!uniqueByName.has(symbol.name)) {
      uniqueByName.set(symbol.name, symbol);
    }
  }

  return Array.from(uniqueByName.values());
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveTargetScope(params: {
  sourceFile: string;
  targetFiles: string[];
  targetContentByFile: Map<string, string>;
  rule: SymbolReferenceRule;
}): TargetReferenceScope {
  if (!params.rule.targetPair) {
    return {
      files: params.targetFiles,
      content: params.targetFiles.map((filePath) => params.targetContentByFile.get(filePath) ?? "").join("\n"),
      expectedLabel: params.rule.targetFiles,
    };
  }

  const pairRegex = new RegExp(params.rule.targetPair.from);
  const pairedTargetFile = params.sourceFile.replace(pairRegex, params.rule.targetPair.to);

  return {
    files: [pairedTargetFile],
    content: params.targetContentByFile.get(pairedTargetFile) ?? "",
    expectedLabel: pairedTargetFile,
  };
}

/**
 * Run symbol-reference rule to ensure exported symbols are referenced in target files.
 */
export async function runSymbolReferenceRule(
  rule: SymbolReferenceRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const results: CheckResult[] = [];

  const sourceFiles = globSync(rule.sourceFiles, { cwd, ignore: allExcludes });
  const targetFiles = globSync(rule.targetFiles, { cwd, ignore: allExcludes });

  const targetContentByFile = new Map<string, string>();
  for (const filePath of targetFiles) {
    try {
      targetContentByFile.set(filePath, readFileSync(join(cwd, filePath), "utf-8"));
    } catch {
      targetContentByFile.set(filePath, "");
    }
  }

  const kinds = rule.symbolKinds ?? ["function-declaration", "function-variable"];
  const ignoreSet = new Set(rule.ignoreSymbols ?? []);

  if (rule.symbolPattern && !isValidRegex(rule.symbolPattern)) {
    results.push({
      file: ".chaperone.json",
      rule: `symbol-reference/${rule.id}`,
      message: `Invalid symbolPattern regex: ${rule.symbolPattern}`,
      severity: "error",
      source: "custom",
    });
    return { ruleId: rule.id, results };
  }

  const symbolFilter = rule.symbolPattern ? new RegExp(rule.symbolPattern) : null;

  for (const sourceFile of sourceFiles) {
    const fullPath = join(cwd, sourceFile);
    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const exportedSymbols = extractExportedSymbols(content, kinds);
    const targetScope = resolveTargetScope({
      sourceFile,
      targetFiles,
      targetContentByFile,
      rule,
    });

    for (const symbol of exportedSymbols) {
      if (ignoreSet.has(symbol.name)) {
        continue;
      }
      if (symbolFilter && !symbolFilter.test(symbol.name)) {
        continue;
      }

      const symbolRegex = new RegExp(`\\b${escapeRegex(symbol.name)}\\b`);
      if (symbolRegex.test(targetScope.content)) {
        continue;
      }

      const targetExists = targetScope.files.every((filePath) => targetContentByFile.has(filePath));

      results.push({
        file: sourceFile,
        line: symbol.line,
        rule: `symbol-reference/${rule.id}`,
        message: rule.message || `Exported symbol "${symbol.name}" is not referenced in target files`,
        severity: rule.severity,
        source: "custom",
        suggestion: `Add unit tests that reference "${symbol.name}"`,
        context: {
          symbol: symbol.name,
          expectedValue: `Referenced in ${targetScope.expectedLabel}`,
          actualValue: targetExists ? "No reference found" : "Target file not found",
        },
      });
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

/**
 * Check if a rule is a SymbolReferenceRule.
 */
export function isSymbolReferenceRule(rule: unknown): rule is SymbolReferenceRule {
  return (
    typeof rule === "object"
    && rule !== null
    && (rule as SymbolReferenceRule).type === "symbol-reference"
  );
}
