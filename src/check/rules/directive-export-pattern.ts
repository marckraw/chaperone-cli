import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, DirectiveExportPatternRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

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

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function extractNamedExports(content: string): NamedExport[] {
  const exports: NamedExport[] = [];
  let match: RegExpExecArray | null;

  const declarationRegex =
    /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_]+)/g;

  while ((match = declarationRegex.exec(content)) !== null) {
    exports.push({
      name: match[1],
      line: getLineNumber(content, match.index),
    });
  }

  const reExportRegex =
    /export\s+(?!type\b)\{([\s\S]*?)\}(?:\s*from\s*["'][^"']+["'])?/g;

  while ((match = reExportRegex.exec(content)) !== null) {
    const line = getLineNumber(content, match.index);
    const specifiers = match[1]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    for (const specifier of specifiers) {
      if (specifier.startsWith("type ")) {
        continue;
      }

      const aliasMatch = specifier.match(/\bas\s+([A-Za-z0-9_]+)$/);
      const name = aliasMatch ? aliasMatch[1] : specifier.replace(/\s+/g, "");

      if (name === "default") {
        continue;
      }

      exports.push({ name, line });
    }
  }

  return exports;
}

export async function runDirectiveExportPatternRule(
  rule: DirectiveExportPatternRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];
  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  const allowedPatterns = rule.allowedExportNamePatterns
    .map((pattern) => compileRegex(pattern))
    .filter((pattern): pattern is RegExp => pattern !== null);

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    if (getLeadingDirective(content) !== rule.directive) {
      continue;
    }

    for (const exported of extractNamedExports(content)) {
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
