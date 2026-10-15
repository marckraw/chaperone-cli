import { resolve } from "node:path";
import type { CheckResult, RegisteredInMapRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";
import { createStaticProject, nodeLocation, relativeFile, StaticReadError, staticError } from "./utils/typescript-static";
import { findingMessage } from "./utils/findings";

export async function runRegisteredInMapRule(rule: RegisteredInMapRule, options: RuleRunnerOptions): Promise<RuleResult> {
  const context = getRuleContext(options);
  const files = context.index.glob(rule.files, rule.exclude ?? []);
  const results: CheckResult[] = [];
  const reportError = (error: unknown, fallback: string) => {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({
      file: relativeFile(options.cwd, error instanceof StaticReadError ? error.file : resolve(options.cwd, fallback)),
      line: error instanceof StaticReadError ? error.line : undefined,
      column: error instanceof StaticReadError ? error.column : undefined,
      rule: `${rule.type}/${rule.id}`,
      message: `Cannot check registration: ${detail}`,
      severity: "error",
      source: "custom",
    });
  };

  // The complete schema set is intentional: a changed map (or imported spread) can
  // remove a registration for an unchanged schema. --since must still catch that.
  try {
    const ts = (await import("typescript")).default;
    const project = createStaticProject(ts, options.cwd, [...files, rule.mapFile]);
    const keys = project.objectEntries(project.exportedExpression(rule.mapFile, rule.mapExport));
    for (const file of files) {
      try {
        const schema = project.exportedExpression(file, rule.schemaExport);
        const nameExpression = project.objectEntries(schema).get("name");
        if (!nameExpression) staticError(schema, 'Schema has no static "name" property');
        const name = project.stringValue(nameExpression);
        if (!name) staticError(nameExpression, 'Schema "name" must not be empty');
        if (keys.has(name)) continue;
        const location = nodeLocation(nameExpression);
        results.push({
          file,
          line: location.file === resolve(options.cwd, file) ? location.line : undefined,
          rule: `${rule.type}/${rule.id}`,
          message: findingMessage(rule.message, `schema "${name}" is not registered in ${rule.mapFile}`),
          severity: rule.severity,
          source: "custom",
          suggestion: `Add "${name}" as a key in ${rule.mapFile}`,
          context: { symbol: name, expectedValue: `Key "${name}" in ${rule.mapFile}`, actualValue: "Missing key" },
        });
      } catch (error) {
        reportError(error, file);
      }
    }
  } catch (error) {
    reportError(error, rule.mapFile);
  }
  return { ruleId: rule.id, results, filesChecked: files.length };
}

export function isRegisteredInMapRule(rule: unknown): rule is RegisteredInMapRule {
  return typeof rule === "object" && rule !== null && (rule as RegisteredInMapRule).type === "registered-in-map";
}
