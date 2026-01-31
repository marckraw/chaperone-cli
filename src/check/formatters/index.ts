import type { CheckSummary } from "../types";
import { formatText } from "./text";
import { formatJson } from "./json";
import { formatAI } from "./ai";

export { formatText } from "./text";
export { formatJson } from "./json";
export { formatAI } from "./ai";

/**
 * Output format types
 */
export type OutputFormat = "text" | "json" | "ai";

/**
 * Format options
 */
export interface FormatOptions {
  quiet?: boolean;
  noWarnings?: boolean;
}

/**
 * Filter summary to exclude warnings if noWarnings is set
 */
function filterSummary(summary: CheckSummary, noWarnings: boolean): CheckSummary {
  if (!noWarnings) {
    return summary;
  }

  const filteredResults = summary.results.filter((r) => r.severity === "error");
  const filteredBySource: Record<string, typeof summary.results> = {};

  for (const [source, results] of Object.entries(summary.bySource)) {
    const filtered = results.filter((r) => r.severity === "error");
    if (filtered.length > 0) {
      filteredBySource[source] = filtered;
    }
  }

  return {
    ...summary,
    results: filteredResults,
    bySource: filteredBySource,
  };
}

/**
 * Format check summary based on format type
 */
export function format(
  summary: CheckSummary,
  outputFormat: OutputFormat,
  options: FormatOptions = {}
): string {
  const { quiet = false, noWarnings = false } = options;
  const filteredSummary = filterSummary(summary, noWarnings);

  switch (outputFormat) {
    case "json":
      return formatJson(filteredSummary, noWarnings);
    case "ai":
      return formatAI(filteredSummary, noWarnings);
    case "text":
    default:
      return formatText(filteredSummary, quiet, noWarnings);
  }
}
