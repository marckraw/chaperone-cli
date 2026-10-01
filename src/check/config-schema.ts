/**
 * Schema and validation for .chaperone.json files and presets.
 *
 * Every config source (the user's file, local preset files and built-in presets) is
 * validated when it is loaded. Validation produces diagnostics:
 * - errors (unknown or removed rule types, invalid severities, missing or mistyped
 *   fields, invalid regexes or globs) stop the run with exit code 2;
 * - warnings (unknown fields, deprecated options, suspicious patterns) are reported
 *   alongside the results and never change the exit code.
 */

import { z } from "zod";
import { checkGlobSyntax } from "../utils/glob";
import { closestMatch, didYouMean } from "../utils/suggest";
import type { ConfigDiagnostic, CustomRule } from "./types";

export const RULE_TYPES = [
  "regex",
  "file-pairing",
  "file-contract",
  "package-fields",
  "component-location",
  "react-component-count",
  "command",
  "symbol-reference",
  "retired-path",
  "forbidden-import",
  "import-boundary",
  "public-api",
  "directive-export-pattern",
  "repeated-literal",
  "duplicate-code",
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

/**
 * Rule types removed in chaperone 0.5.0 (commit 41a7eef), with migration advice.
 */
export const REMOVED_RULE_TYPES: Readonly<Record<string, string>> = {
  relationship:
    'was removed in chaperone 0.5.0. Use "file-pairing" for companion-file requirements ' +
    '(mustHaveCompanion → files + pair: { from, to } + mustExist: true) and "file-contract" for ' +
    "content assertions (fileMustContain/fileMustNot → requiredPatterns/forbiddenPatterns, " +
    "maxLines → assertions.maxLines, mustImport/mustNotImport → assertions.mustImport/mustNotImport).",
  "file-naming":
    'was removed in chaperone 0.5.0 and merged into "file-pairing": rename "pattern" to "files" ' +
    'and replace requireCompanion.transform with pair: { from: "<regex on the path>", to: "<replacement>" }.',
  "file-structure":
    "was removed in chaperone 0.5.0 without a direct replacement. Require companion files with " +
    '"file-pairing" (mustExist: true), block unwanted locations with "retired-path", or script ' +
    'custom structure checks with a "command" rule.',
  "file-suffix-content":
    'was removed in chaperone 0.5.0 and merged into "file-contract": put the suffix in "files" ' +
    '(e.g. "src/**/*.presentational.tsx") and use requiredPatterns/forbiddenPatterns with plain ' +
    "regex strings instead of { pattern, name } objects.",
};

// ─── Shapes ──────────────────────────────────────────────────────────────────

const severity = z.enum(["error", "warning"]);
const nonEmpty = z.string().min(1, "must not be empty");
const stringList = z.array(z.string());

const baseRuleShape = {
  type: z.string(),
  id: nonEmpty.describe("Unique identifier for the rule"),
  severity: severity.describe("error fails the check; warning is reported only"),
  exclude: stringList.optional().describe("Glob patterns excluded from this rule"),
  disabled: z.boolean().optional().describe("Set to true to switch off a rule inherited from a preset"),
  source: z.string().optional().describe("File the rule was extracted from (chaperone analyze)"),
  originalText: z.string().optional().describe("Instruction the rule was extracted from"),
  message: z.string().optional().describe("Custom violation message"),
};

const pairShape = z.object({
  from: nonEmpty.describe("Regex applied to the file path"),
  to: z.string().describe("Replacement producing the companion path"),
});

export const RULE_SCHEMAS = {
  regex: z.object({
    ...baseRuleShape,
    type: z.literal("regex"),
    pattern: nonEmpty.describe("Regular expression to search for"),
    files: nonEmpty.describe("Glob for files to scan"),
    message: z.string().describe("Violation message"),
    mustMatch: z.boolean().optional().describe("true: pattern must be present; false (default): must be absent"),
    reportOnce: z.boolean().optional().describe("Report only the first match per file"),
    flags: z
      .string()
      .optional()
      .describe('RegExp flags (default "m": ^ and $ match at line boundaries). "g" is added automatically'),
    forbidden: z.boolean().optional().describe("Deprecated alias: forbidden: true means mustMatch: false"),
  }),
  "file-pairing": z.object({
    ...baseRuleShape,
    type: z.literal("file-pairing"),
    files: nonEmpty,
    pair: pairShape,
    mustExist: z.boolean().optional(),
    requireTransformMatch: z.boolean().optional(),
  }),
  "file-contract": z.object({
    ...baseRuleShape,
    type: z.literal("file-contract"),
    files: nonEmpty,
    requiredPatterns: stringList.optional(),
    requiredAnyPatterns: stringList.optional(),
    forbiddenPatterns: stringList.optional(),
    captureFromPath: z
      .object({
        pattern: nonEmpty,
        group: z.union([z.number().int().nonnegative(), z.string()]).optional(),
        source: z.enum(["path", "basename"]).optional(),
      })
      .optional(),
    templatedRequiredPatterns: stringList.optional(),
    templatedRequiredAnyPatterns: stringList.optional(),
    templatedForbiddenPatterns: stringList.optional(),
    assertions: z
      .object({
        firstLine: z.string().optional(),
        mustExportDefault: z.boolean().optional(),
        mustExportNamed: z.boolean().optional(),
        mustNotImport: stringList.optional(),
        mustImport: stringList.optional(),
        maxLines: z.number().int().nonnegative().optional(),
        minLines: z.number().int().nonnegative().optional(),
        mustHaveJSDoc: z.boolean().optional(),
        maxExports: z.number().int().nonnegative().optional(),
        mustBeModule: z.boolean().optional(),
      })
      .optional(),
  }),
  "package-fields": z.object({
    ...baseRuleShape,
    type: z.literal("package-fields"),
    requiredFields: stringList.optional(),
    forbiddenFields: stringList.optional(),
    fieldPatterns: z.record(z.string(), z.string()).optional(),
  }),
  "component-location": z.object({
    ...baseRuleShape,
    type: z.literal("component-location"),
    files: nonEmpty,
    componentType: z.enum(["presentational", "stateful"]),
    requiredLocation: nonEmpty,
    mustBeIn: z.boolean(),
  }),
  "react-component-count": z.object({
    ...baseRuleShape,
    type: z.literal("react-component-count"),
    files: nonEmpty,
    maxComponents: z.number().int().min(1, "must be at least 1").optional(),
    ignoreNames: stringList.optional(),
  }),
  command: z.object({
    ...baseRuleShape,
    type: z.literal("command"),
    command: nonEmpty,
    args: stringList.optional(),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    expectedExitCode: z.number().int().optional(),
    stdoutPattern: z.string().optional(),
    stderrPattern: z.string().optional(),
  }),
  "symbol-reference": z.object({
    ...baseRuleShape,
    type: z.literal("symbol-reference"),
    sourceFiles: nonEmpty,
    targetFiles: nonEmpty,
    targetPair: pairShape.optional(),
    symbolKinds: z.array(z.enum(["function-declaration", "function-variable"])).optional(),
    symbolPattern: z.string().optional(),
    ignoreSymbols: stringList.optional(),
  }),
  "retired-path": z.object({
    ...baseRuleShape,
    type: z.literal("retired-path"),
    paths: z
      .array(
        z.object({
          pattern: nonEmpty,
          reason: z.string().optional(),
          migratedTo: z.string().optional(),
        })
      )
      .min(1, "must contain at least one entry"),
  }),
  "forbidden-import": z.object({
    ...baseRuleShape,
    type: z.literal("forbidden-import"),
    files: nonEmpty,
    restrictions: z
      .array(
        z.object({
          source: nonEmpty,
          allowedIn: stringList.optional(),
          message: z.string().optional(),
        })
      )
      .optional(),
    checkPatterns: z
      .array(
        z.object({
          pattern: nonEmpty,
          allowedIn: stringList.optional(),
          message: z.string().optional(),
        })
      )
      .optional(),
    includeTypeImports: z.boolean().optional(),
  }),
  "import-boundary": z.object({
    ...baseRuleShape,
    type: z.literal("import-boundary"),
    layers: z.record(
      z.string(),
      z.object({
        files: nonEmpty,
        allowImportsFrom: stringList,
      })
    ),
    includeTypeImports: z.boolean().optional(),
    includeDynamicImports: z.boolean().optional(),
  }),
  "public-api": z.object({
    ...baseRuleShape,
    type: z.literal("public-api"),
    modules: nonEmpty,
    files: nonEmpty,
    barrelFile: nonEmpty.optional(),
    allowSameModule: z.boolean().optional(),
  }),
  "directive-export-pattern": z.object({
    ...baseRuleShape,
    type: z.literal("directive-export-pattern"),
    files: nonEmpty,
    directive: nonEmpty,
    allowedExportNamePatterns: stringList.min(1, "must contain at least one pattern"),
  }),
  "repeated-literal": z.object({
    ...baseRuleShape,
    type: z.literal("repeated-literal"),
    files: nonEmpty.describe("Glob for files to scan"),
    literalPattern: nonEmpty.optional().describe("Regex the whole literal must match to count"),
    minTokens: z.number().int().min(1, "must be at least 1").optional().describe("Fewest whitespace-separated tokens"),
    contextPattern: nonEmpty.optional().describe("Regex on the code: only literals in its contexts count"),
    contextFiles: stringList.optional().describe("Globs for files where every literal counts"),
    ignoreOrder: z.boolean().optional().describe("The same tokens in any order are the same literal"),
    maxOccurrences: z.number().int().min(1, "must be at least 1").optional().describe("Most occurrences allowed"),
    allow: z
      .array(z.object({ literal: nonEmpty, reason: nonEmpty.describe("Why this literal may repeat") }))
      .optional(),
  }),
  "duplicate-code": z.object({
    ...baseRuleShape,
    type: z.literal("duplicate-code"),
    files: nonEmpty.describe("Glob for files to compare"),
    minTokens: z.number().int().min(1, "must be at least 1").optional().describe("Fewest tokens a copy has"),
    minLines: z.number().int().min(1, "must be at least 1").optional().describe("Fewest lines a copy spans"),
    allow: z
      .array(
        z.object({
          files: z.array(nonEmpty).length(2, "must name exactly two files"),
          reason: nonEmpty.describe("Why the copy is kept"),
        })
      )
      .optional(),
  }),
} satisfies Record<RuleType, z.AnyZodObject>;

const toolConfigSchema = z.object({
  enabled: z.boolean().optional(),
  extensions: stringList.optional(),
  args: stringList.optional(),
});

/**
 * Top-level shape of a config file or local preset file.
 * `rules.custom` entries are validated individually by {@link validateRule}.
 */
export const configFileSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  extends: z.union([z.string(), stringList]).optional(),
  project: z.object({}).passthrough().optional(),
  rules: z
    .object({
      typescript: toolConfigSchema.optional(),
      eslint: toolConfigSchema.optional(),
      prettier: toolConfigSchema.optional(),
      custom: z.array(z.unknown()).optional(),
    })
    .optional(),
  include: stringList.optional(),
  exclude: stringList.optional(),
  integrations: z
    .object({
      respectEslintIgnore: z.boolean().optional(),
      respectPrettierIgnore: z.boolean().optional(),
      useTypescriptPaths: z.boolean().optional(),
    })
    .optional(),
  aiInstructions: z
    .object({
      autoDetect: z.boolean().optional(),
      files: stringList.optional(),
      extractRules: z.boolean().optional(),
    })
    .optional(),
});

// ─── Validation ──────────────────────────────────────────────────────────────

type PathSegment = string | number;

export function formatPath(segments: readonly PathSegment[]): string {
  let out = "";
  for (const segment of segments) {
    out += typeof segment === "number" ? `[${segment}]` : out === "" ? segment : `.${segment}`;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
    } else if (current instanceof z.ZodDefault) {
      current = current._def.innerType;
    } else if (current instanceof z.ZodEffects) {
      current = current.innerType();
    } else {
      return current;
    }
  }
}

interface UnknownKey {
  path: PathSegment[];
  key: string;
  known: string[];
}

/**
 * Walk a value alongside its schema and collect keys the schema does not declare.
 */
function collectUnknownKeys(
  schema: z.ZodTypeAny,
  value: unknown,
  path: PathSegment[],
  out: UnknownKey[]
): void {
  const inner = unwrap(schema);

  if (inner instanceof z.ZodObject) {
    if (!isPlainObject(value) || inner._def.unknownKeys === "passthrough") {
      return;
    }
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const known = Object.keys(shape);
    for (const [key, child] of Object.entries(value)) {
      const childSchema = shape[key];
      if (!childSchema) {
        out.push({ path: [...path, key], key, known });
      } else {
        collectUnknownKeys(childSchema, child, [...path, key], out);
      }
    }
  } else if (inner instanceof z.ZodArray) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectUnknownKeys(inner.element, item, [...path, index], out));
    }
  } else if (inner instanceof z.ZodRecord) {
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        collectUnknownKeys(inner.valueSchema, child, [...path, key], out);
      }
    }
  }
}

function valueAt(root: unknown, path: readonly PathSegment[]): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * Turn a zod issue into a human-readable sentence.
 */
function describeIssue(issue: z.ZodIssue, root: unknown): string {
  const field = issue.path.length > 0 ? `"${formatPath(issue.path)}"` : "value";
  const received = valueAt(root, issue.path);

  switch (issue.code) {
    case "invalid_type":
      if (received === undefined) {
        return `missing required field ${field}`;
      }
      return `${field} must be ${issue.expected === "array" ? "an array" : `a ${issue.expected}`} (got ${describeType(received)})`;
    case "invalid_enum_value": {
      const options = issue.options.map((option) => `"${String(option)}"`).join(", ");
      const suggestion =
        typeof received === "string" ? didYouMean(received, issue.options.map(String)) : "";
      return `${field} must be one of ${options} (got ${JSON.stringify(received)})${suggestion}`;
    }
    case "invalid_literal":
      return `${field} must be ${JSON.stringify(issue.expected)}`;
    case "too_small":
      if (issue.type === "array") {
        return `${field} ${issue.message.startsWith("must") ? issue.message : `must contain at least ${String(issue.minimum)} item(s)`}`;
      }
      if (issue.type === "string") {
        return `${field} must not be empty`;
      }
      return `${field} ${issue.message.startsWith("must") ? issue.message : `must be at least ${String(issue.minimum)}`}`;
    case "invalid_union":
      return `${field} has an invalid value (got ${describeType(received)})`;
    default:
      return `${field}: ${issue.message}`;
  }
}

function compileCheck(pattern: string, flags?: string): string | null {
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

interface RuleIssueSink {
  error(message: string, path?: PathSegment[]): void;
  warning(message: string, path?: PathSegment[]): void;
}

/**
 * Checks the zod shapes cannot express: regex and glob syntax, cross-field requirements.
 */
function checkRuleSemantics(rule: Record<string, unknown>, type: RuleType, sink: RuleIssueSink): void {
  const regex = (path: PathSegment[], flags?: string) => {
    const value = valueAt(rule, path);
    if (typeof value !== "string") return;
    const problem = compileCheck(value, flags);
    if (problem) {
      sink.error(`"${formatPath(path)}" is not a valid regular expression: ${problem}`, path);
    }
  };
  const regexList = (field: string) => {
    const value = rule[field];
    if (Array.isArray(value)) value.forEach((_, index) => regex([field, index]));
  };
  const glob = (path: PathSegment[]) => {
    const value = valueAt(rule, path);
    if (typeof value !== "string") return;
    const problem = checkGlobSyntax(value);
    if (problem) {
      sink.error(`"${formatPath(path)}" is not a valid glob: ${problem}`, path);
    }
  };
  const globList = (path: PathSegment[]) => {
    const value = valueAt(rule, path);
    if (Array.isArray(value)) value.forEach((_, index) => glob([...path, index]));
  };

  globList(["exclude"]);

  switch (type) {
    case "regex": {
      glob(["files"]);
      const flags = rule["flags"];
      if (flags !== undefined && typeof flags === "string") {
        const invalid = [...flags].filter((flag) => !"dimsuvgy".includes(flag));
        if (invalid.length > 0) {
          sink.error(`"flags" contains unsupported flag(s) "${invalid.join("")}"; allowed: d, i, m, s, u, v`, ["flags"]);
          break;
        }
      }
      const effectiveFlags = typeof flags === "string" ? flags.replace(/[gy]/g, "") : "m";
      regex(["pattern"], effectiveFlags);
      const pattern = rule["pattern"];
      if (typeof pattern === "string" && compileCheck(pattern, effectiveFlags) === null) {
        if (new RegExp(pattern, effectiveFlags).test("")) {
          sink.warning(
            `"pattern" /${pattern}/ can match an empty string (e.g. a trailing "|"), so it would match everywhere; its zero-length matches are ignored and only non-empty matches count`,
            ["pattern"]
          );
        }
      }
      if (typeof rule["forbidden"] === "boolean") {
        const forbidden = rule["forbidden"];
        if (typeof rule["mustMatch"] === "boolean" && rule["mustMatch"] === forbidden) {
          sink.error(
            `"forbidden": ${String(forbidden)} contradicts "mustMatch": ${String(rule["mustMatch"])}; remove "forbidden"`,
            ["forbidden"]
          );
        } else {
          sink.warning(
            `"forbidden" is deprecated; use "mustMatch": ${String(!forbidden)} instead`,
            ["forbidden"]
          );
        }
      }
      break;
    }
    case "file-pairing":
      glob(["files"]);
      regex(["pair", "from"]);
      break;
    case "file-contract": {
      glob(["files"]);
      for (const field of [
        "requiredPatterns",
        "requiredAnyPatterns",
        "forbiddenPatterns",
        "templatedRequiredPatterns",
        "templatedRequiredAnyPatterns",
        "templatedForbiddenPatterns",
      ]) {
        regexList(field);
      }
      regex(["captureFromPath", "pattern"]);
      regex(["assertions", "firstLine"]);
      const hasContract =
        [
          "requiredPatterns",
          "requiredAnyPatterns",
          "forbiddenPatterns",
          "templatedRequiredPatterns",
          "templatedRequiredAnyPatterns",
          "templatedForbiddenPatterns",
        ].some((field) => Array.isArray(rule[field]) && (rule[field] as unknown[]).length > 0) ||
        isPlainObject(rule["assertions"]);
      if (!hasContract) {
        sink.error(
          "defines nothing to check: add requiredPatterns, requiredAnyPatterns, forbiddenPatterns, templated*Patterns or assertions"
        );
      }
      break;
    }
    case "package-fields": {
      const fieldPatterns = rule["fieldPatterns"];
      if (isPlainObject(fieldPatterns)) {
        for (const key of Object.keys(fieldPatterns)) regex(["fieldPatterns", key]);
      }
      const hasCheck =
        (Array.isArray(rule["requiredFields"]) && rule["requiredFields"].length > 0) ||
        (Array.isArray(rule["forbiddenFields"]) && rule["forbiddenFields"].length > 0) ||
        (isPlainObject(fieldPatterns) && Object.keys(fieldPatterns).length > 0);
      if (!hasCheck) {
        sink.error("defines nothing to check: add requiredFields, forbiddenFields or fieldPatterns");
      }
      break;
    }
    case "component-location":
      glob(["files"]);
      break;
    case "react-component-count":
      glob(["files"]);
      break;
    case "command":
      regex(["stdoutPattern"]);
      regex(["stderrPattern"]);
      break;
    case "symbol-reference":
      glob(["sourceFiles"]);
      glob(["targetFiles"]);
      regex(["symbolPattern"]);
      regex(["targetPair", "from"]);
      break;
    case "retired-path": {
      const paths = rule["paths"];
      if (Array.isArray(paths)) paths.forEach((_, index) => glob(["paths", index, "pattern"]));
      break;
    }
    case "forbidden-import": {
      glob(["files"]);
      const restrictions = Array.isArray(rule["restrictions"]) ? rule["restrictions"] : [];
      const checkPatterns = Array.isArray(rule["checkPatterns"]) ? rule["checkPatterns"] : [];
      restrictions.forEach((_, index) => {
        regex(["restrictions", index, "source"]);
        globList(["restrictions", index, "allowedIn"]);
      });
      checkPatterns.forEach((_, index) => {
        regex(["checkPatterns", index, "pattern"]);
        globList(["checkPatterns", index, "allowedIn"]);
      });
      if (restrictions.length === 0 && checkPatterns.length === 0) {
        sink.error("defines nothing to check: add at least one entry to restrictions or checkPatterns");
      }
      break;
    }
    case "import-boundary": {
      const layers = rule["layers"];
      if (!isPlainObject(layers)) break;
      const names = Object.keys(layers);
      if (names.length === 0) {
        sink.error('"layers" must define at least one layer', ["layers"]);
      }
      for (const [name, layer] of Object.entries(layers)) {
        glob(["layers", name, "files"]);
        const allowed = isPlainObject(layer) ? layer["allowImportsFrom"] : undefined;
        if (!Array.isArray(allowed)) continue;
        allowed.forEach((reference, index) => {
          if (typeof reference === "string" && !names.includes(reference)) {
            sink.error(
              `layer "${name}" allows imports from unknown layer "${reference}"${didYouMean(reference, names)}`,
              ["layers", name, "allowImportsFrom", index]
            );
          }
        });
      }
      break;
    }
    case "public-api":
      glob(["modules"]);
      glob(["files"]);
      break;
    case "directive-export-pattern":
      glob(["files"]);
      regexList("allowedExportNamePatterns");
      break;
    case "repeated-literal": {
      glob(["files"]);
      globList(["contextFiles"]);
      regex(["literalPattern"]);
      regex(["contextPattern"], "m");
      const context = rule["contextPattern"];
      if (typeof context === "string" && compileCheck(context, "m") === null && new RegExp(context, "m").test("")) {
        sink.warning(
          `"contextPattern" /${context}/ can match an empty string, so it would match everywhere; its zero-length matches are ignored`,
          ["contextPattern"]
        );
      }
      if (Array.isArray(rule["contextFiles"]) && rule["contextFiles"].length > 0 && context === undefined) {
        sink.warning('"contextFiles" has no effect without "contextPattern": every literal counts already', [
          "contextFiles",
        ]);
      }
      const seen = new Map<string, number>();
      const allow = Array.isArray(rule["allow"]) ? rule["allow"] : [];
      allow.forEach((entry, index) => {
        const literal = isPlainObject(entry) && typeof entry["literal"] === "string" ? entry["literal"].trim() : null;
        if (literal === null) return;
        const first = seen.get(literal);
        if (first !== undefined) {
          sink.warning(`"allow[${index}]" repeats "allow[${first}]" ("${literal}")`, ["allow", index]);
        } else {
          seen.set(literal, index);
        }
      });
      break;
    }
    case "duplicate-code": {
      glob(["files"]);
      const allow = Array.isArray(rule["allow"]) ? rule["allow"] : [];
      allow.forEach((_, index) => globList(["allow", index, "files"]));
      break;
    }
  }
}

export interface RuleValidation {
  diagnostics: ConfigDiagnostic[];
  /** The normalized rule, or null when it has errors */
  rule: CustomRule | null;
}

/**
 * Validate one entry of `rules.custom`.
 *
 * @param raw the entry as written in the source
 * @param source where it came from (file path or preset name)
 * @param path JSON path of the entry, e.g. ["rules", "custom", 3]
 */
export function validateRule(raw: unknown, source: string, path: PathSegment[]): RuleValidation {
  const diagnostics: ConfigDiagnostic[] = [];
  const ruleId = isPlainObject(raw) && typeof raw["id"] === "string" ? raw["id"] : undefined;
  const add = (level: "error" | "warning", message: string, subPath: PathSegment[] = []) => {
    diagnostics.push({ level, source, path: formatPath([...path, ...subPath]), ruleId, message });
  };

  if (!isPlainObject(raw)) {
    add("error", `rule must be an object (got ${describeType(raw)})`);
    return { diagnostics, rule: null };
  }

  if (typeof raw["id"] !== "string" || raw["id"].trim() === "") {
    add("error", 'missing required field "id"');
  }

  const type = raw["type"];

  // A disabled entry only needs an id: it switches off a rule with the same id.
  if (raw["disabled"] === true) {
    if (typeof type === "string" && !(RULE_TYPES as readonly string[]).includes(type)) {
      add("warning", `disabled rule has unknown type "${type}"`, ["type"]);
    }
    return {
      diagnostics,
      rule: diagnostics.some((d) => d.level === "error") ? null : (raw as unknown as CustomRule),
    };
  }

  if (type === undefined) {
    add("error", 'missing required field "type"');
    return { diagnostics, rule: null };
  }
  if (typeof type !== "string") {
    add("error", `"type" must be a string (got ${describeType(type)})`, ["type"]);
    return { diagnostics, rule: null };
  }

  const removed = REMOVED_RULE_TYPES[type];
  if (removed) {
    add("error", `rule type "${type}" ${removed}`, ["type"]);
    return { diagnostics, rule: null };
  }

  if (!(RULE_TYPES as readonly string[]).includes(type)) {
    add(
      "error",
      `unknown rule type "${type}"${didYouMean(type, RULE_TYPES)}. Valid types: ${RULE_TYPES.join(", ")}`,
      ["type"]
    );
    return { diagnostics, rule: null };
  }

  const ruleType = type as RuleType;
  const schema: z.AnyZodObject = RULE_SCHEMAS[ruleType];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add("error", describeIssue(issue, raw), issue.path);
    }
  }

  const unknownKeys: UnknownKey[] = [];
  collectUnknownKeys(schema, raw, [], unknownKeys);
  for (const unknown of unknownKeys) {
    const suggestion = closestMatch(unknown.key, unknown.known);
    add(
      "warning",
      `unknown field "${formatPath(unknown.path)}" is ignored${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`,
      unknown.path
    );
  }

  checkRuleSemantics(raw, ruleType, {
    error: (message, subPath) => add("error", message, subPath),
    warning: (message, subPath) => add("warning", message, subPath),
  });

  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    return { diagnostics, rule: null };
  }

  return { diagnostics, rule: normalizeRule(raw as unknown as CustomRule) };
}

/**
 * Apply deprecated aliases so runtime code only sees canonical fields.
 */
export function normalizeRule(rule: CustomRule): CustomRule {
  if (rule.type === "regex" && typeof rule.forbidden === "boolean") {
    const { forbidden, ...rest } = rule;
    return { ...rest, mustMatch: rule.mustMatch ?? !forbidden };
  }
  return rule;
}

/**
 * Validate the top-level shape of a config or preset file.
 * Does not validate `rules.custom` entries (see {@link validateRule}).
 */
export function validateConfigShape(raw: unknown, source: string): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];

  if (!isPlainObject(raw)) {
    diagnostics.push({
      level: "error",
      source,
      message: `config must be a JSON object (got ${describeType(raw)})`,
    });
    return diagnostics;
  }

  const parsed = configFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push({
        level: "error",
        source,
        path: formatPath(issue.path),
        message: describeIssue(issue, raw),
      });
    }
  }

  const unknownKeys: UnknownKey[] = [];
  collectUnknownKeys(configFileSchema, raw, [], unknownKeys);
  for (const unknown of unknownKeys) {
    const suggestion = closestMatch(unknown.key, unknown.known);
    diagnostics.push({
      level: "warning",
      source,
      path: formatPath(unknown.path),
      message: `unknown field "${formatPath(unknown.path)}" is ignored${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`,
    });
  }

  for (const field of ["include", "exclude"] as const) {
    const value = raw[field];
    if (!Array.isArray(value)) continue;
    value.forEach((pattern, index) => {
      if (typeof pattern !== "string") return;
      const problem = checkGlobSyntax(pattern);
      if (problem) {
        diagnostics.push({
          level: "error",
          source,
          path: formatPath([field, index]),
          message: `"${field}[${index}]" is not a valid glob: ${problem}`,
        });
      }
    });
  }

  return diagnostics;
}

/**
 * Render a diagnostic as one line: `source › path (rule "id"): message`.
 */
export function formatDiagnostic(diagnostic: ConfigDiagnostic): string {
  const location = [diagnostic.source, diagnostic.path].filter(Boolean).join(" › ");
  const rule = diagnostic.ruleId ? ` (rule "${diagnostic.ruleId}")` : "";
  return `${location}${rule}: ${diagnostic.message}`;
}
