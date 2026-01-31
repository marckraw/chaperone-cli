import type { CheckResult, CheckSummary } from "../types";

/**
 * ANSI color codes
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

/**
 * Format a single check result as text
 */
function formatResult(result: CheckResult): string {
  const severity =
    result.severity === "error"
      ? `${colors.red}ERROR${colors.reset}`
      : `${colors.yellow}WARNING${colors.reset}`;

  const location = result.line
    ? `${result.file}:${result.line}${result.column ? `:${result.column}` : ""}`
    : result.file;

  const lines = [
    `  ${colors.dim}${location}${colors.reset}`,
    `    ${severity}: ${result.message}`,
    `    ${colors.dim}Rule: ${result.rule}${colors.reset}`,
  ];

  if (result.suggestion) {
    lines.push(`    ${colors.cyan}Suggestion: ${result.suggestion}${colors.reset}`);
  }

  return lines.join("\n");
}

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
 * Format check results as human-readable text
 */
export function formatText(summary: CheckSummary, quiet = false, noWarnings = false): string {
  const lines: string[] = [];

  // Header
  const statusColor = summary.success ? colors.green : colors.red;
  const statusText = summary.success ? "PASSED" : "FAILED";

  lines.push("");
  lines.push(`${colors.bold}Chaperone Check${colors.reset} - ${statusColor}${statusText}${colors.reset}`);
  lines.push("");

  // Summary stats
  lines.push(`${colors.dim}Files checked:${colors.reset} ${summary.totalFiles}`);
  lines.push(
    `${colors.dim}Errors:${colors.reset} ${summary.totalErrors > 0 ? colors.red : colors.green}${summary.totalErrors}${colors.reset}`
  );
  if (!noWarnings) {
    lines.push(
      `${colors.dim}Warnings:${colors.reset} ${summary.totalWarnings > 0 ? colors.yellow : colors.green}${summary.totalWarnings}${colors.reset}`
    );
  }
  lines.push(`${colors.dim}Duration:${colors.reset} ${(summary.duration / 1000).toFixed(2)}s`);
  lines.push("");

  // Per-tool breakdown
  const grouped = groupBySource(summary.results);
  const toolStats: string[] = [];
  const sourceOrder = ["typescript", "eslint", "prettier", "custom", "ai-instructions"];

  for (const source of sourceOrder) {
    const results = grouped[source];
    if (!results || results.length === 0) {
      continue;
    }

    const errors = results.filter((r) => r.severity === "error").length;
    const warnings = results.filter((r) => r.severity === "warning").length;
    const label = getSourceLabel(source).replace(/ (Errors|Issues|Formatting|Violations|Rule Violations)$/, "");

    if (noWarnings) {
      if (errors > 0) {
        toolStats.push(`${label}: ${colors.red}${errors} errors${colors.reset}`);
      }
    } else {
      const parts: string[] = [];
      if (errors > 0) parts.push(`${colors.red}${errors} errors${colors.reset}`);
      if (warnings > 0) parts.push(`${colors.yellow}${warnings} warnings${colors.reset}`);
      if (parts.length > 0) {
        toolStats.push(`${label}: ${parts.join(", ")}`);
      }
    }
  }

  if (toolStats.length > 0) {
    lines.push(`${colors.bold}By Tool:${colors.reset}`);
    for (const stat of toolStats) {
      lines.push(`  ${stat}`);
    }
    lines.push("");

  }

  // If quiet mode and no errors, stop here
  if (quiet && summary.totalErrors === 0) {
    return lines.join("\n");
  }

  // Filter to only errors in quiet mode or noWarnings mode
  const resultFilter = quiet || noWarnings ? (r: CheckResult) => r.severity === "error" : () => true;

  // Output by source (reuse sourceOrder from above)
  for (const source of sourceOrder) {
    const results = grouped[source]?.filter(resultFilter);
    if (!results || results.length === 0) {
      continue;
    }

    const sourceLabel = getSourceLabel(source);
    const errorCount = results.filter((r) => r.severity === "error").length;
    const warningCount = results.filter((r) => r.severity === "warning").length;

    const countInfo = noWarnings
      ? `${errorCount} errors`
      : `${errorCount} errors, ${warningCount} warnings`;
    lines.push(`${colors.bold}${sourceLabel}${colors.reset} (${countInfo})`);
    lines.push("");

    for (const result of results) {
      lines.push(formatResult(result));
      lines.push("");
    }
  }

  // Suggestions
  if (!summary.success) {
    lines.push(`${colors.bold}Suggested Actions:${colors.reset}`);

    if (summary.totalErrors > 0) {
      lines.push(`  1. Fix ${summary.totalErrors} error(s) - these must be resolved`);
    }

    const hasFixable = summary.results.some((r) => r.fixable);
    if (hasFixable) {
      lines.push(`  2. Run ${colors.cyan}chaperone check --fix${colors.reset} to auto-fix some issues`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get human-readable label for source
 */
function getSourceLabel(source: string): string {
  switch (source) {
    case "typescript":
      return "TypeScript Errors";
    case "eslint":
      return "ESLint Issues";
    case "prettier":
      return "Prettier Formatting";
    case "custom":
      return "Custom Rules";
    case "ai-instructions":
      return "AI Instruction Violations";
    default:
      return source;
  }
}
