import type { CheckSummary } from "../types";

/**
 * JSON output format
 */
export interface JsonOutput {
  success: boolean;
  summary: {
    totalFiles: number;
    totalErrors: number;
    totalWarnings: number;
    duration: number;
  };
  results: Array<{
    file: string;
    rule: string;
    message: string;
    line?: number;
    column?: number;
    severity: "error" | "warning";
    source?: string;
    fixable?: boolean;
    suggestion?: string;
  }>;
  bySource: Record<
    string,
    Array<{
      file: string;
      rule: string;
      message: string;
      line?: number;
      column?: number;
      severity: "error" | "warning";
    }>
  >;
}

/**
 * Format check results as JSON
 */
export function formatJson(summary: CheckSummary, noWarnings = false): string {
  const output: JsonOutput = {
    success: summary.success,
    summary: {
      totalFiles: summary.totalFiles,
      totalErrors: summary.totalErrors,
      totalWarnings: summary.totalWarnings,
      duration: summary.duration,
    },
    results: summary.results.map((r) => ({
      file: r.file,
      rule: r.rule,
      message: r.message,
      line: r.line,
      column: r.column,
      severity: r.severity,
      source: r.source,
      fixable: r.fixable,
      suggestion: r.suggestion,
    })),
    bySource: {},
  };

  // Group by source
  for (const result of summary.results) {
    const source = result.source ?? "unknown";
    if (!output.bySource[source]) {
      output.bySource[source] = [];
    }
    output.bySource[source].push({
      file: result.file,
      rule: result.rule,
      message: result.message,
      line: result.line,
      column: result.column,
      severity: result.severity,
    });
  }

  return JSON.stringify(output, null, 2);
}
