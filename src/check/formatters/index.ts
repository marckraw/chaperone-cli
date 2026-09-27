import type { CheckSummary } from "../types";
import { formatText } from "./text";
import { formatJson } from "./json";
import { formatAI } from "./ai";

export { formatText, type TextFormatOptions } from "./text";
export { formatJson, type JsonFormatOptions } from "./json";
export { formatAI, type AIFormatOptions } from "./ai";

export const OUTPUT_FORMATS = ["text", "json", "ai"] as const;

/**
 * Output format types
 */
export type OutputFormat = "text" | "json" | "ai";

/**
 * Format options
 */
export interface FormatOptions {
  /** List only errors; counts still include warnings (all formats) */
  quiet?: boolean;
  /** Drop warnings entirely (all formats) */
  noWarnings?: boolean;
  /** ANSI colours for the text format (default: false) */
  color?: boolean;
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
  const { quiet = false, noWarnings = false, color = false } = options;
  const filteredSummary = filterSummary(summary, noWarnings);

  switch (outputFormat) {
    case "json":
      return formatJson(filteredSummary, { quiet });
    case "ai":
      return formatAI(filteredSummary, { quiet });
    case "text":
    default:
      return formatText(filteredSummary, { quiet, noWarnings, color });
  }
}
