import { basename, dirname, extname } from "node:path";
import type { CheckResult, ReservedNamesRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { ruleError } from "../rule-error";
import { getRuleContext } from "./utils/rule-context";
import { createStaticProject, nodeLocation, relativeFile, StaticReadError } from "./utils/typescript-static";
import { readPackageExportNames } from "./utils/package-exports";
import { findReactComponents } from "./utils/react-components";
import { findingMessage } from "./utils/findings";

export async function runReservedNamesRule(rule: ReservedNamesRule, options: RuleRunnerOptions): Promise<RuleResult> {
  const context = getRuleContext(options);
  const files = context.index.glob(rule.files, rule.exclude ?? []);
  const results: CheckResult[] = [];
  const compare = new Set(rule.compare ?? ["file-name", "folder-name", "exported-identifier", "component-name"]);
  const normalize = (name: string) => rule.caseSensitive === false ? name.toLowerCase() : name;
  const allowed = new Set((rule.allow ?? []).map(normalize));
  const reportError = (error: unknown, fallback: string) => {
    results.push(ruleError({
      file: error instanceof StaticReadError ? relativeFile(options.cwd, error.file) : fallback,
      line: error instanceof StaticReadError ? error.line : undefined,
      column: error instanceof StaticReadError ? error.column : undefined,
      rule: `${rule.type}/${rule.id}`,
      message: `Cannot check reserved names: ${error instanceof Error ? error.message : String(error)}`,
      severity: "error",
      source: "custom",
    }));
  };
  try {
    const ts = (await import("typescript")).default;
    const exported = readPackageExportNames(ts, options.cwd, rule.package, rule.includeTypes ?? false);
    const reserved = new Set([...exported.names].map(normalize));
    for (const warning of exported.warnings) {
      results.push({
        ...warning,
        file: relativeFile(options.cwd, warning.file),
        rule: `${rule.type}/${rule.id}`,
        severity: "warning",
        source: "custom",
      });
    }
    const scoped = context.inScope(files);
    const needsCode = compare.has("exported-identifier") || compare.has("component-name");
    const project = needsCode && scoped.length > 0 ? createStaticProject(ts, options.cwd, scoped) : null;
    for (const file of scoped) {
      try {
        const candidates = new Map<string, { name: string; kind: string; line?: number }>();
        const add = (name: string, kind: string, line?: number) => {
          // A component named Button in Button/Button.tsx is one finding, not three.
          const key = normalize(name);
          if (!candidates.has(key)) candidates.set(key, { name, kind, line });
        };
        if (compare.has("file-name")) add(basename(file, extname(file)), "file name");
        if (compare.has("folder-name")) add(basename(dirname(file)), "folder name");
        if (project) {
          const source = project.source(file);
          if (compare.has("exported-identifier")) {
            for (const symbol of project.exportsOf(source)) {
              if (!rule.includeTypes && !project.isValueExport(symbol, source)) continue;
              const declaration = symbol.declarations?.find((node) => node.getSourceFile() === source);
              if (symbol.name !== "default") {
                add(symbol.name, "exported identifier", declaration ? nodeLocation(declaration).line : undefined);
              } else if (declaration) {
                // Default exports have a public name of "default", but their
                // local identifier can still shadow a design-system component.
                if ((ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) && declaration.name) {
                  add(declaration.name.text, "exported identifier", nodeLocation(declaration.name).line);
                } else if (ts.isExportAssignment(declaration) && ts.isIdentifier(declaration.expression)) {
                  add(declaration.expression.text, "exported identifier", nodeLocation(declaration).line);
                }
              }
            }
          }
          if (compare.has("component-name")) {
            for (const component of findReactComponents(source.text, file)) add(component.name, "component name", component.line);
          }
        }
        for (const { name, kind, line } of candidates.values()) {
          if (!reserved.has(normalize(name)) || allowed.has(normalize(name))) continue;
          results.push({
            file, line,
            rule: `${rule.type}/${rule.id}`,
            message: findingMessage(rule.message, `${kind} "${name}" is reserved by ${rule.package}`),
            severity: rule.severity,
            source: "custom",
            suggestion: `Rename "${name}" or add an intentional exception to allow`,
            context: { symbol: name, matchedText: name, expectedValue: `Name not exported by ${rule.package}`, actualValue: name },
          });
        }
      } catch (error) {
        reportError(error, file);
      }
    }
  } catch (error) {
    reportError(error, ".chaperone.json");
  }
  return { ruleId: rule.id, results, filesChecked: files.length };
}

export function isReservedNamesRule(rule: unknown): rule is ReservedNamesRule {
  return typeof rule === "object" && rule !== null && (rule as ReservedNamesRule).type === "reserved-names";
}
