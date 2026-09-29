import type { CheckResult, SymbolReferenceRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { type Comment, jsxEnabledFor, tokenize } from "../../utils/js-lexer";
import { findExportedFunctions } from "./utils/exported-functions";
import { getRuleContext } from "./utils/rule-context";

/**
 * A file's text with its comments blanked out (offsets kept): a name that appears only in a
 * comment ("this test forgets to call countWords") is not a reference to it.
 */
export function withoutComments(content: string, filePath: string): string {
  const comments: Comment[] = [];
  tokenize(content, { jsx: jsxEnabledFor(filePath), comments });
  if (comments.length === 0) return content;
  let output = "";
  let cursor = 0;
  for (const comment of comments) {
    output += content.slice(cursor, comment.start) + content.slice(comment.start, comment.end).replace(/[^\n]/g, " ");
    cursor = comment.end;
  }
  return output + content.slice(cursor);
}

interface TargetReferenceScope {
  files: string[];
  content: string;
  expectedLabel: string;
}

function extractExportedSymbols(
  content: string,
  kinds: Array<"function-declaration" | "function-variable">,
  filePath: string
): Array<{ name: string; line: number }> {
  const uniqueByName = new Map<string, { name: string; line: number }>();
  for (const symbol of findExportedFunctions(content, filePath)) {
    if (kinds.includes(symbol.kind) && !uniqueByName.has(symbol.name)) {
      uniqueByName.set(symbol.name, { name: symbol.name, line: symbol.line });
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
  const context = getRuleContext(options);
  const { index } = context;
  const ruleExcludes = rule.exclude ?? [];
  const results: CheckResult[] = [];

  const sourceFiles = index.glob(rule.sourceFiles, ruleExcludes);
  const targetFiles = index.glob(rule.targetFiles, ruleExcludes);

  const targetContentByFile = new Map<string, string>();
  for (const filePath of targetFiles) {
    targetContentByFile.set(filePath, withoutComments(index.read(filePath) ?? "", filePath));
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

  for (const sourceFile of context.inScope(sourceFiles)) {
    const content = index.read(sourceFile);
    if (content === null) {
      continue;
    }

    const exportedSymbols = extractExportedSymbols(content, kinds, sourceFile);
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
    filesChecked: sourceFiles.length,
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
