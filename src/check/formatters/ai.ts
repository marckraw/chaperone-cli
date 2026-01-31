import type { CheckResult, CheckSummary } from "../types";

/**
 * Group results by source
 */
function groupBySource(results: CheckResult[]): Record<string, CheckResult[]> {
  const groups: Record<string, CheckResult[]> = {};

  for (const result of results) {
    const source = result.source ?? "unknown";
    if (!groups[source]) {
      groups[source] = [];
    }
    groups[source].push(result);
  }

  return groups;
}

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

/**
 * Format a single result for AI consumption
 */
function formatResultForAI(result: CheckResult): string {
  const severity = result.severity.toUpperCase();
  const location = result.line
    ? `${result.file}:${result.line}${result.column ? `:${result.column}` : ""}`
    : result.file;

  const lines = [
    `- **${location}**`,
    `  Rule: \`${result.rule}\``,
    `  ${severity}: ${result.message}`,
  ];

  if (result.suggestion) {
    lines.push(`  Suggestion: ${result.suggestion}`);
  }

  return lines.join("\n");
}

/**
 * Format check results in AI-optimized markdown format
 * Designed for consumption by LLMs like Claude, GPT, etc.
 */
export function formatAI(summary: CheckSummary, noWarnings = false): string {
  const lines: string[] = [];

  // Header
  lines.push("## Chaperone Check Report");
  lines.push("");

  // Status summary - clear and concise for LLM parsing
  const status = summary.success ? "PASSED" : "FAILED";
  lines.push(`**Status:** ${status}`);
  lines.push(`**Files checked:** ${summary.totalFiles}`);
  lines.push(`**Errors:** ${summary.totalErrors}`);
  lines.push(`**Warnings:** ${summary.totalWarnings}`);
  lines.push(`**Duration:** ${(summary.duration / 1000).toFixed(2)}s`);
  lines.push("");

  if (summary.results.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  // Group results by source for organized output
  const grouped = groupBySource(summary.results);
  const sourceOrder = ["typescript", "eslint", "prettier", "custom", "ai-instructions"];

  for (const source of sourceOrder) {
    const results = grouped[source];
    if (!results || results.length === 0) {
      continue;
    }

    lines.push(`### ${getSourceHeading(source)}`);
    lines.push("");

    // Sort by severity (errors first) then by file
    const sorted = [...results].sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === "error" ? -1 : 1;
      }
      return a.file.localeCompare(b.file);
    });

    for (const result of sorted) {
      lines.push(formatResultForAI(result));
      lines.push("");
    }
  }

  // Suggested actions for the AI to take
  if (!summary.success) {
    lines.push("### Suggested Actions");
    lines.push("");

    const actions: string[] = [];

    if (summary.totalErrors > 0) {
      actions.push(
        `1. Fix ${summary.totalErrors} error(s) - these must be resolved before proceeding`
      );
    }

    // Check for specific fixable issues
    const fixableCount = summary.results.filter((r) => r.fixable).length;
    if (fixableCount > 0) {
      actions.push(`2. Run \`chaperone check --fix\` to auto-fix ${fixableCount} issue(s)`);
    }

    // TypeScript-specific advice
    if (grouped["typescript"]?.length > 0) {
      actions.push(`3. Review TypeScript errors - check type annotations and assignments`);
    }

    // ESLint-specific advice
    if (grouped["eslint"]?.length > 0) {
      const eslintFixable = grouped["eslint"].filter((r) => r.fixable).length;
      if (eslintFixable > 0) {
        actions.push(`4. Run \`eslint --fix\` to auto-fix ${eslintFixable} ESLint issue(s)`);
      }
    }

    // AI instruction-specific advice
    if (grouped["ai-instructions"]?.length > 0) {
      actions.push(
        `5. Review AI instruction violations - these rules come from CLAUDE.md, AGENTS.md, or similar files`
      );
    }

    lines.push(actions.join("\n"));
    lines.push("");
  }

  // File list for context
  const affectedFiles = [...new Set(summary.results.map((r) => r.file))].sort();
  if (affectedFiles.length > 0 && affectedFiles.length <= 20) {
    lines.push("### Affected Files");
    lines.push("");
    lines.push("```");
    for (const file of affectedFiles) {
      lines.push(file);
    }
    lines.push("```");
    lines.push("");
  } else if (affectedFiles.length > 20) {
    lines.push(`### Affected Files (${affectedFiles.length} total)`);
    lines.push("");
    lines.push("```");
    for (const file of affectedFiles.slice(0, 15)) {
      lines.push(file);
    }
    lines.push(`... and ${affectedFiles.length - 15} more files`);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
