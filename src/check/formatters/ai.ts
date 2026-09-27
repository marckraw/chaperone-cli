import type { CheckResult, CheckSummary } from "../types";
import {
  describeDiagnostic,
  describeRunner,
  describeSkipped,
  formatDuration,
  formatLocation,
  groupBySource,
  orderedSources,
  statusLine,
} from "./shared";

export interface AIFormatOptions {
  /** List only errors (counts still include warnings) */
  quiet?: boolean;
  /** Maximum results listed per rule before "… and N more" (default: 20) */
  maxPerRule?: number;
}

const DEFAULT_MAX_PER_RULE = 20;

/**
 * Get markdown-friendly source heading
 */
function getSourceHeading(source: string): string {
  switch (source) {
    case "typescript":
      return "TypeScript Errors";
    case "eslint":
      return "ESLint Issues";
    case "prettier":
      return "Prettier Formatting";
    case "custom":
      return "Custom Rule Violations";
    case "ai-instructions":
      return "AI Instruction Rule Violations";
    default:
      return source;
  }
}

/** Inline code that survives backticks in the content */
function code(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  return `${fence}${text}${fence}`;
}

/**
 * Format a single result for AI consumption, with the context needed to fix it.
 */
function formatResultForAI(result: CheckResult): string {
  const lines = [`- **${formatLocation(result)}** — ${result.severity.toUpperCase()}: ${result.message}`];
  const ctx = result.context;

  if (ctx?.matchedText) {
    lines.push(`  - Found: ${code(ctx.matchedText)}`);
  }
  if (ctx?.symbol) {
    lines.push(`  - Symbol: ${code(ctx.symbol)}`);
  }
  if (ctx?.field) {
    lines.push(`  - Field: ${code(ctx.field)}`);
  }
  if (ctx?.expectedValue || ctx?.actualValue) {
    lines.push(`  - Expected: ${ctx.expectedValue ?? "—"}; actual: ${ctx.actualValue ?? "—"}`);
  }
  if (ctx?.detectedPatterns?.length) {
    lines.push(`  - Detected: ${ctx.detectedPatterns.join(", ")}`);
  }
  if (result.suggestion) {
    lines.push(`  - Suggestion: ${result.suggestion}`);
  }
  if (ctx?.commandOutput) {
    lines.push("  - Output:");
    lines.push("    ```");
    for (const outputLine of ctx.commandOutput.split("\n")) {
      lines.push(`    ${outputLine}`);
    }
    lines.push("    ```");
  }

  return lines.join("\n");
}

/**
 * Format check results in AI-optimized markdown format
 * Designed for consumption by LLMs like Claude, GPT, etc.
 */
export function formatAI(summary: CheckSummary, options: AIFormatOptions = {}): string {
  const maxPerRule = options.maxPerRule ?? DEFAULT_MAX_PER_RULE;
  const lines: string[] = [];
  const listed = options.quiet
    ? summary.results.filter((result) => result.severity === "error")
    : summary.results;

  // Header
  lines.push("## Chaperone Check Report");
  lines.push("");

  // Status summary - clear and concise for LLM parsing
  lines.push(`**Status:** ${statusLine(summary)}`);
  lines.push(`**Files checked:** ${summary.totalFiles}`);
  lines.push(`**Errors:** ${summary.totalErrors}`);
  lines.push(`**Warnings:** ${summary.totalWarnings}`);
  lines.push(`**Duration:** ${formatDuration(summary.duration)}`);
  lines.push("");

  const runners = summary.runners ?? [];
  if (runners.length > 0) {
    lines.push("### Tools");
    lines.push("");
    for (const runner of runners) {
      lines.push(`- ${runner.label}: ${describeRunner(runner)}`);
    }
    lines.push("");
  }

  // Everything that was not (fully) checked, so a pass is never over-trusted
  const skipped = describeSkipped(summary).filter((line) => !line.startsWith("Tool "));
  if (skipped.length > 0) {
    lines.push("### Not Fully Checked");
    lines.push("");
    for (const line of skipped) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }

  const configWarnings = (summary.diagnostics ?? []).filter((diagnostic) => diagnostic.level === "warning");
  if (configWarnings.length > 0) {
    lines.push("### Configuration Warnings");
    lines.push("");
    for (const diagnostic of configWarnings) {
      lines.push(`- ${describeDiagnostic(diagnostic)}`);
    }
    lines.push("");
  }

  if (listed.length === 0) {
    lines.push(summary.results.length === 0 ? "No issues found." : "No errors found (warnings hidden by --quiet).");
    return lines.join("\n");
  }

  // Group by source, then by rule; errors first, capped per rule
  const grouped = groupBySource(listed);
  let omitted = 0;

  for (const source of orderedSources(grouped)) {
    const results = grouped[source] ?? [];
    lines.push(`### ${getSourceHeading(source)}`);
    lines.push("");

    const byRule = new Map<string, CheckResult[]>();
    for (const result of results) {
      const list = byRule.get(result.rule) ?? [];
      list.push(result);
      byRule.set(result.rule, list);
    }

    const ruleOrder = [...byRule.entries()].sort(([, a], [, b]) => {
      const aErrors = a.some((result) => result.severity === "error") ? 0 : 1;
      const bErrors = b.some((result) => result.severity === "error") ? 0 : 1;
      return aErrors - bErrors;
    });

    for (const [rule, ruleResults] of ruleOrder) {
      const errors = ruleResults.filter((result) => result.severity === "error").length;
      const warnings = ruleResults.length - errors;
      const counts = [errors > 0 ? `${errors} error(s)` : "", warnings > 0 ? `${warnings} warning(s)` : ""]
        .filter(Boolean)
        .join(", ");
      lines.push(`#### ${code(rule)} — ${counts}`);
      lines.push("");

      const sorted = [...ruleResults].sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
        return a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0);
      });
      for (const result of sorted.slice(0, maxPerRule)) {
        lines.push(formatResultForAI(result));
      }
      if (sorted.length > maxPerRule) {
        omitted += sorted.length - maxPerRule;
        lines.push(
          `- … and ${sorted.length - maxPerRule} more for ${code(rule)} (run \`chaperone check --format json\` for the full list)`
        );
      }
      lines.push("");
    }
  }

  // Suggested actions for the AI to take
  if (!summary.success) {
    lines.push("### Suggested Actions");
    lines.push("");

    const actions: string[] = [];
    if (summary.totalErrors > 0) {
      actions.push(`Fix ${summary.totalErrors} error(s) - these must be resolved before proceeding`);
    }

    const fixableCount = summary.results.filter((result) => result.fixable).length;
    if (fixableCount > 0) {
      actions.push(`Run \`chaperone check --fix\` to auto-fix ${fixableCount} issue(s)`);
    }

    if ((grouped["typescript"]?.length ?? 0) > 0) {
      actions.push("Review TypeScript errors - check type annotations and assignments");
    }

    const eslintFixable = (grouped["eslint"] ?? []).filter((result) => result.fixable).length;
    if (eslintFixable > 0) {
      actions.push(`Run \`eslint --fix\` to auto-fix ${eslintFixable} ESLint issue(s)`);
    }

    if (omitted > 0) {
      actions.push(`${omitted} result(s) were omitted above; fix the listed ones, then re-run the check`);
    }

    lines.push(actions.map((action, index) => `${index + 1}. ${action}`).join("\n"));
    lines.push("");
  }

  // File list for context
  const affectedFiles = [...new Set(listed.map((result) => result.file).filter(Boolean))].sort();
  if (affectedFiles.length > 0) {
    lines.push(`### Affected Files (${affectedFiles.length})`);
    lines.push("");
    lines.push("```");
    for (const file of affectedFiles.slice(0, 20)) {
      lines.push(file);
    }
    if (affectedFiles.length > 20) {
      lines.push(`... and ${affectedFiles.length - 20} more files`);
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
