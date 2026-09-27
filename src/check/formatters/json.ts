import type { CheckSummary, ConfigDiagnostic, RuleSummary, RunnerSummary } from "../types";
import { describeGaps } from "./shared";

export interface JsonFormatOptions {
  /** Include only errors in results/bySource (summary counts are unchanged) */
  quiet?: boolean;
}

/**
 * JSON output format
 */
export interface JsonOutput {
  success: boolean;
  /** "passed", "passed-with-gaps" (something was skipped) or "failed" */
  status: "passed" | "passed-with-gaps" | "failed";
  /** What was not checked (skipped tools, ...), so a pass is never mistaken for a full pass */
  gaps: string[];
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
    context?: Record<string, unknown>;
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
      context?: Record<string, unknown>;
    }>
  >;
  /** Configuration warnings */
  diagnostics: ConfigDiagnostic[];
  /** What each tool runner did, including why it was skipped */
  runners: RunnerSummary[];
  /** What each custom rule did; status "no-files" means its globs matched nothing */
  rules: RuleSummary[];
  /** Rules switched off with `disabled: true` */
  disabledRules: Array<{ id: string; source: string }>;
}

/**
 * Format check results as JSON
 */
export function formatJson(summary: CheckSummary, options: JsonFormatOptions = {}): string {
  const listed = options.quiet
    ? summary.results.filter((result) => result.severity === "error")
    : summary.results;
  const gaps = describeGaps(summary);
  const output: JsonOutput = {
    success: summary.success,
    status: !summary.success ? "failed" : gaps.length > 0 ? "passed-with-gaps" : "passed",
    gaps,
    summary: {
      totalFiles: summary.totalFiles,
      totalErrors: summary.totalErrors,
      totalWarnings: summary.totalWarnings,
      duration: summary.duration,
    },
    results: listed.map((r) => ({
      file: r.file,
      rule: r.rule,
      message: r.message,
      line: r.line,
      column: r.column,
      severity: r.severity,
      source: r.source,
      fixable: r.fixable,
      suggestion: r.suggestion,
      context: r.context,
    })),
    bySource: {},
    diagnostics: summary.diagnostics ?? [],
    runners: summary.runners ?? [],
    rules: summary.rules ?? [],
    disabledRules: summary.disabledRules ?? [],
  };

  // Group by source
  for (const result of listed) {
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
      context: result.context,
    });
  }

  return JSON.stringify(output, null, 2);
}
