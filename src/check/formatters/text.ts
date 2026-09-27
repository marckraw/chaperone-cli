import { createPalette, type Palette } from "../../utils/ansi";
import type { CheckResult, CheckSummary } from "../types";
import {
  describeDiagnostic,
  describeRunner,
  formatDuration,
  formatLocation,
  groupBySource,
  orderedSources,
  statusLine,
} from "./shared";

export interface TextFormatOptions {
  /** List only errors (counts still include warnings) */
  quiet?: boolean;
  /** Hide warnings entirely */
  noWarnings?: boolean;
  /** Emit ANSI colours (default: false) */
  color?: boolean;
}

/**
 * Format a single check result as text
 */
function formatResult(result: CheckResult, colors: Palette): string {
  const severity =
    result.severity === "error"
      ? `${colors.red}ERROR${colors.reset}`
      : `${colors.yellow}WARNING${colors.reset}`;

  const lines = [
    `  ${colors.dim}${formatLocation(result)}${colors.reset}`,
    `    ${severity}: ${result.message}`,
    `    ${colors.dim}Rule: ${result.rule}${colors.reset}`,
  ];

  // Add context information if available
  if (result.context) {
    const ctx = result.context;

    // Show matched text for regex rules
    if (ctx.matchedText) {
      lines.push(`    ${colors.dim}Matched: ${colors.reset}${colors.red}"${ctx.matchedText}"${colors.reset}`);
    }

    // Show field info for package-fields rules
    if (ctx.field) {
      lines.push(`    ${colors.dim}Field: ${colors.reset}${ctx.field}`);
    }

    // Show expected vs actual
    if (ctx.expectedValue) {
      lines.push(`    ${colors.dim}Expected: ${colors.reset}${ctx.expectedValue}`);
    }
    if (ctx.actualValue) {
      lines.push(`    ${colors.dim}Actual: ${colors.reset}${ctx.actualValue}`);
    }
    if (ctx.commandOutput) {
      lines.push(`    ${colors.dim}Command output:${colors.reset}`);
      for (const outputLine of ctx.commandOutput.split("\n")) {
        lines.push(`      ${colors.dim}${outputLine}${colors.reset}`);
      }
    }

    // Show component type and detected patterns
    if (ctx.componentType) {
      lines.push(`    ${colors.dim}Component type: ${colors.reset}${ctx.componentType}`);
    }
    if (ctx.detectedPatterns && ctx.detectedPatterns.length > 0) {
      lines.push(`    ${colors.dim}Detected: ${colors.reset}${ctx.detectedPatterns.join(", ")}`);
    }

    // Show surrounding code lines
    if (ctx.surroundingLines && ctx.surroundingLines.length > 0) {
      lines.push(`    ${colors.dim}Code:${colors.reset}`);
      for (const line of ctx.surroundingLines) {
        lines.push(`      ${colors.dim}${line}${colors.reset}`);
      }
    }
  }

  if (result.suggestion) {
    lines.push(`    ${colors.cyan}Suggestion: ${result.suggestion}${colors.reset}`);
  }

  return lines.join("\n");
}

/**
 * Format check results as human-readable text
 */
export function formatText(summary: CheckSummary, options: TextFormatOptions = {}): string {
  const { quiet = false, noWarnings = false } = options;
  const colors = createPalette(options.color ?? false);
  const lines: string[] = [];

  // Header
  const status = statusLine(summary);
  const statusColor = !summary.success ? colors.red : status === "PASSED" ? colors.green : colors.yellow;
  lines.push("");
  lines.push(`${colors.bold}Chaperone Check${colors.reset} - ${statusColor}${status}${colors.reset}`);
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
  lines.push(`${colors.dim}Duration:${colors.reset} ${formatDuration(summary.duration)}`);
  lines.push("");

  // What each tool did, including why it did not run
  const runners = summary.runners ?? [];
  if (runners.length > 0) {
    lines.push(`${colors.bold}Tools:${colors.reset}`);
    for (const runner of runners) {
      const icon =
        runner.status === "passed"
          ? `${colors.green}✓${colors.reset}`
          : runner.status === "skipped"
            ? `${colors.yellow}○${colors.reset}`
            : `${colors.red}✗${colors.reset}`;
      lines.push(`  ${icon} ${runner.label.padEnd(10)} ${describeRunner(runner)}`);
    }
    lines.push("");
  }

  // Rules that checked nothing, scope notices and disabled rules
  const rules = summary.rules ?? [];
  const disabled = summary.disabledRules ?? [];
  const noticed = rules.filter((rule) => rule.notices.length > 0);
  if (rules.length > 0 || disabled.length > 0) {
    const noFiles = rules.filter((rule) => rule.status === "no-files").length;
    const counts = [
      `${rules.length} run`,
      ...(noFiles > 0 ? [`${colors.yellow}${noFiles} matched no files${colors.reset}`] : []),
      ...(disabled.length > 0 ? [`${disabled.length} disabled`] : []),
    ];
    lines.push(`${colors.bold}Custom rules:${colors.reset} ${counts.join(", ")}`);
    for (const rule of noticed) {
      for (const notice of rule.notices) {
        lines.push(`  ${colors.yellow}○${colors.reset} ${rule.id} (${rule.type}): ${notice}`);
      }
    }
    for (const entry of disabled) {
      lines.push(`  ${colors.dim}–${colors.reset} ${entry.id}: disabled in ${entry.source}`);
    }
    lines.push("");
  }

  const unreadable = summary.unreadable ?? [];
  if (unreadable.length > 0) {
    lines.push(`${colors.bold}Could not read (not checked):${colors.reset}`);
    for (const path of unreadable) {
      lines.push(`  ${colors.yellow}!${colors.reset} ${path}`);
    }
    lines.push("");
  }

  // Configuration warnings
  const configWarnings = (summary.diagnostics ?? []).filter((diagnostic) => diagnostic.level === "warning");
  if (configWarnings.length > 0) {
    lines.push(`${colors.bold}Configuration warnings:${colors.reset}`);
    for (const diagnostic of configWarnings) {
      lines.push(`  ${colors.yellow}!${colors.reset} ${describeDiagnostic(diagnostic)}`);
    }
    lines.push("");
  }

  // Per-source breakdown
  const grouped = groupBySource(summary.results);
  const sources = orderedSources(grouped);
  const toolStats: string[] = [];

  for (const source of sources) {
    const results = grouped[source] ?? [];
    const errors = results.filter((r) => r.severity === "error").length;
    const warnings = results.filter((r) => r.severity === "warning").length;
    const label = getSourceLabel(source).replace(/ (Errors|Issues|Formatting|Violations|Rule Violations)$/, "");

    const parts: string[] = [];
    if (errors > 0) parts.push(`${colors.red}${errors} errors${colors.reset}`);
    if (warnings > 0 && !noWarnings) parts.push(`${colors.yellow}${warnings} warnings${colors.reset}`);
    if (parts.length > 0) {
      toolStats.push(`${label}: ${parts.join(", ")}`);
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

  for (const source of sources) {
    const results = grouped[source]?.filter(resultFilter);
    if (!results || results.length === 0) {
      continue;
    }

    const errorCount = results.filter((r) => r.severity === "error").length;
    const warningCount = results.filter((r) => r.severity === "warning").length;

    const countInfo = noWarnings ? `${errorCount} errors` : `${errorCount} errors, ${warningCount} warnings`;
    lines.push(`${colors.bold}${getSourceLabel(source)}${colors.reset} (${countInfo})`);
    lines.push("");

    for (const result of results) {
      lines.push(formatResult(result, colors));
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
