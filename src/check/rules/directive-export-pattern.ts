import { analyzeBrackets, jsxEnabledFor, tokenize, type Token } from "../../utils/js-lexer";
import { createLineIndex } from "../../utils/text";
import type { CheckResult, DirectiveExportPatternRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

interface NamedExport {
  name: string;
  line: number;
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function getLeadingDirective(content: string): string | null {
  const trimmed = content
    .replace(/^\uFEFF/, "")
    .replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");

  const match = trimmed.match(/^["']([^"']+)["'];?/);
  return match?.[1] ?? null;
}

const isName = (token: Token | undefined, value?: string): boolean =>
  token !== undefined && token.type === "name" && (value === undefined || token.value === value);

const isPunct = (token: Token | undefined, value: string): boolean =>
  token !== undefined && token.type === "punct" && token.value === value;

/**
 * Runtime (non-type) named exports of a module, found with the tokenizer so
 * comments and strings are ignored. Default exports and type-only exports are skipped.
 */
export function extractNamedExports(content: string, filePath = "module.tsx"): NamedExport[] {
  const tokens = tokenize(content, { jsx: jsxEnabledFor(filePath) });
  const { depth } = analyzeBrackets(tokens);
  const lines = createLineIndex(content);
  const exports: NamedExport[] = [];

  for (let index = 0; index < tokens.length; index++) {
    if (depth[index] !== 0 || !isName(tokens[index], "export") || isPunct(tokens[index - 1], ".")) continue;
    const line = lines.lineAt(tokens[index]!.start);
    let cursor = index + 1;

    if (isName(tokens[cursor], "default") || isName(tokens[cursor], "type") || isName(tokens[cursor], "interface")) {
      continue;
    }
    if (isName(tokens[cursor], "declare")) cursor++;
    if (isName(tokens[cursor], "async")) cursor++;

    if (isName(tokens[cursor], "function")) {
      cursor++;
      if (isPunct(tokens[cursor], "*")) cursor++;
    } else if (isName(tokens[cursor], "const") && isName(tokens[cursor + 1], "enum")) {
      cursor += 2;
    } else if (["const", "let", "var", "class", "enum"].some((keyword) => isName(tokens[cursor], keyword))) {
      cursor++;
    } else if (isPunct(tokens[cursor], "*")) {
      // export * as ns from "x"
      if (isName(tokens[cursor + 1], "as") && isName(tokens[cursor + 2])) {
        exports.push({ name: tokens[cursor + 2]!.value, line });
      }
      continue;
    } else if (isPunct(tokens[cursor], "{")) {
      let specifier: Token[] = [];
      const flush = () => {
        const [first, ...rest] = specifier;
        const isTypeOnly = isName(first, "type") && rest.length > 0 && !(isName(rest[0], "as") && rest.length === 2);
        const asIndex = specifier.findIndex((token, position) => position > 0 && isName(token, "as"));
        const nameToken = asIndex > 0 ? specifier[asIndex + 1] : specifier[specifier.length - 1];
        const name = nameToken?.type === "string" || nameToken?.type === "name" ? nameToken.value : null;
        if (!isTypeOnly && name && name !== "default") exports.push({ name, line });
        specifier = [];
      };
      for (cursor++; cursor < tokens.length && !isPunct(tokens[cursor], "}"); cursor++) {
        if (isPunct(tokens[cursor], ",")) flush();
        else specifier.push(tokens[cursor]!);
      }
      if (specifier.length > 0) flush();
      continue;
    } else {
      continue;
    }

    const nameToken = tokens[cursor];
    if (isName(nameToken)) {
      exports.push({ name: nameToken!.value, line });
    }
  }

  return exports;
}

export async function runDirectiveExportPatternRule(
  rule: DirectiveExportPatternRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { index } = getRuleContext(options);
  const results: CheckResult[] = [];
  const files = index.glob(rule.files, rule.exclude ?? []);

  const allowedPatterns = rule.allowedExportNamePatterns
    .map((pattern) => compileRegex(pattern))
    .filter((pattern): pattern is RegExp => pattern !== null);

  for (const file of files) {
    const content = index.read(file);
    if (content === null) {
      continue;
    }

    if (getLeadingDirective(content) !== rule.directive) {
      continue;
    }

    for (const exported of extractNamedExports(content, file)) {
      const isAllowed = allowedPatterns.some((pattern) => pattern.test(exported.name));

      if (isAllowed) {
        continue;
      }

      results.push({
        file,
        rule: `directive-export-pattern/${rule.id}`,
        message:
          rule.message ||
          `Files with "${rule.directive}" may not export "${exported.name}"`,
        severity: rule.severity,
        source: "custom",
        line: exported.line,
        context: {
          matchedText: exported.name,
        },
      });
    }
  }

  return {
    ruleId: rule.id,
    results,
    filesChecked: files.length,
  };
}

export function isDirectiveExportPatternRule(
  rule: unknown
): rule is DirectiveExportPatternRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as DirectiveExportPatternRule).type === "directive-export-pattern"
  );
}
