/**
 * Helpers shared by the text, json and ai formatters.
 */

import type { CheckResult, CheckSummary, ConfigDiagnostic, RunnerSummary } from "../types";

export const SOURCE_ORDER = ["typescript", "eslint", "prettier", "custom", "ai-instructions"];

/**
 * Group results by source
 */
export function groupBySource(results: CheckResult[]): Record<string, CheckResult[]> {
  const groups: Record<string, CheckResult[]> = {};

  for (const result of results) {
    const source = result.source ?? "unknown";
    (groups[source] ??= []).push(result);
  }

  return groups;
}

/**
 * Sources in display order: known sources first, then anything else alphabetically.
 */
export function orderedSources(grouped: Record<string, CheckResult[]>): string[] {
  const known = SOURCE_ORDER.filter((source) => grouped[source]?.length);
  const other = Object.keys(grouped)
    .filter((source) => !SOURCE_ORDER.includes(source) && grouped[source]?.length)
    .sort();
  return [...known, ...other];
}

/**
 * "file:line:col" or "file"
 */
export function formatLocation(result: CheckResult): string {
  if (!result.file) return "(project)";
  return result.line ? `${result.file}:${result.line}${result.column ? `:${result.column}` : ""}` : result.file;
}

export function formatDuration(ms: number | undefined): string {
  return ms === undefined ? "" : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * One line describing a configuration diagnostic.
 */
export function describeDiagnostic(diagnostic: ConfigDiagnostic): string {
  const location = [diagnostic.source, diagnostic.path].filter(Boolean).join(" › ");
  const rule = diagnostic.ruleId ? ` (rule "${diagnostic.ruleId}")` : "";
  return `${location}${rule}: ${diagnostic.message}`;
}

/**
 * One line describing what a tool runner did.
 */
export function describeRunner(runner: RunnerSummary): string {
  switch (runner.status) {
    case "passed":
      return `passed${runner.warnings > 0 ? ` with ${runner.warnings} warning(s)` : ""}${
        runner.durationMs !== undefined ? ` (${formatDuration(runner.durationMs)})` : ""
      }`;
    case "failed":
      return `${runner.errors} error(s)${runner.warnings > 0 ? `, ${runner.warnings} warning(s)` : ""}${
        runner.durationMs !== undefined ? ` (${formatDuration(runner.durationMs)})` : ""
      }`;
    case "error":
      return `could not run: ${runner.reason ?? "unknown error"}`;
    case "skipped":
      return `skipped: ${runner.reason ?? "not available"}`;
  }
}

/**
 * Things that did not run. A PASSED status is always qualified by these,
 * so a partial check is never mistaken for a complete one.
 */
export function describeGaps(summary: CheckSummary): string[] {
  const gaps: string[] = [];
  const skippedTools = (summary.runners ?? []).filter((runner) => runner.status === "skipped");
  if (skippedTools.length > 0) {
    gaps.push(`${skippedTools.length} tool${skippedTools.length === 1 ? "" : "s"} skipped (${skippedTools.map((runner) => runner.name).join(", ")})`);
  }
  return gaps;
}

/**
 * "PASSED", "PASSED (with gaps)" or "FAILED".
 */
export function statusLine(summary: CheckSummary): string {
  if (!summary.success) return "FAILED";
  const gaps = describeGaps(summary);
  return gaps.length > 0 ? `PASSED, but not everything was checked: ${gaps.join("; ")}` : "PASSED";
}
