import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckResult, RegisteredInMapRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { ruleError } from "../rule-error";
import { getRuleContext } from "./utils/rule-context";
import { createStaticProject, nodeLocation, relativeFile, StaticReadError, staticError } from "./utils/typescript-static";
import { findingMessage } from "./utils/findings";

/**
 * The exceptions file's names and reasons: a JSON object mapping each schema name that is
 * deliberately absent from the map to the reason, `{ "settings": "Rendered by the layout" }`.
 *
 * @throws {Error} when it is not such an object
 */
export function parseExceptions(text: string, file: string): Map<string, string> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${file} must be a JSON object mapping schema names to the reason they are not in the map`);
  }
  const exceptions = new Map<string, string>();
  for (const [name, reason] of Object.entries(data)) {
    if (typeof reason !== "string") {
      throw new Error(`${file}: the reason for "${name}" must be a string, got ${JSON.stringify(reason)}`);
    }
    exceptions.set(name, reason);
  }
  return exceptions;
}

function readExceptions(cwd: string, file: string): Map<string, string> {
  const path = resolve(cwd, file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new StaticReadError("Cannot read exceptions file", path);
  }
  try {
    return parseExceptions(text, file);
  } catch (error) {
    throw new StaticReadError(error instanceof Error ? error.message : String(error), path);
  }
}

export async function runRegisteredInMapRule(rule: RegisteredInMapRule, options: RuleRunnerOptions): Promise<RuleResult> {
  const context = getRuleContext(options);
  const files = context.index.glob(rule.files, rule.exclude ?? []);
  const results: CheckResult[] = [];
  const reportError = (error: unknown, fallback: string) => {
    const detail = error instanceof Error ? error.message : String(error);
    results.push(ruleError({
      file: relativeFile(options.cwd, error instanceof StaticReadError ? error.file : resolve(options.cwd, fallback)),
      line: error instanceof StaticReadError ? error.line : undefined,
      column: error instanceof StaticReadError ? error.column : undefined,
      rule: `${rule.type}/${rule.id}`,
      message: `Cannot check registration: ${detail}`,
      severity: "error",
      source: "custom",
    }));
  };

  // The complete schema set is intentional: a changed map (or imported spread) can
  // remove a registration for an unchanged schema. --since must still catch that.
  try {
    const exceptions = rule.exceptionsFile ? readExceptions(options.cwd, rule.exceptionsFile) : new Map<string, string>();
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
        if (keys.has(name) || exceptions.has(name)) continue;
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
