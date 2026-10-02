import { describe, expect, test } from "bun:test";
import { VALID_RULES } from "../testing/rule-fixtures";
import { REMOVED_RULE_TYPES, RULE_TYPES, validateConfigShape, validateRule } from "./config-schema";

const PATH = ["rules", "custom", 0];

function errorsOf(raw: unknown) {
  return validateRule(raw, ".chaperone.json", PATH).diagnostics.filter((d) => d.level === "error");
}

function warningsOf(raw: unknown) {
  return validateRule(raw, ".chaperone.json", PATH).diagnostics.filter((d) => d.level === "warning");
}

describe("validateRule", () => {
  test.each(RULE_TYPES.map((type) => [type]))("accepts a valid %s rule", (type) => {
    const result = validateRule(VALID_RULES[type], ".chaperone.json", PATH);
    expect(result.diagnostics).toEqual([]);
    expect(result.rule).not.toBeNull();
  });

  test("rejects an unknown rule type with a suggestion", () => {
    const errors = errorsOf({ ...VALID_RULES.regex, type: "regexp" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('unknown rule type "regexp"');
    expect(errors[0]!.message).toContain('did you mean "regex"');
    expect(errors[0]!.ruleId).toBe("no-console");
  });

  test.each(Object.keys(REMOVED_RULE_TYPES).map((type) => [type]))(
    "explains how to migrate the removed %s type",
    (type) => {
      const errors = errorsOf({ type, id: "old", severity: "error" });
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("removed in chaperone 0.5.0");
    }
  );

  test("points relationship rules at file-pairing and file-contract", () => {
    const [error] = errorsOf({
      type: "relationship",
      id: "pure-files-need-sibling-tests",
      severity: "error",
      when: { files: "src/**/*.pure.ts" },
      then: [],
    });
    expect(error!.message).toContain("file-pairing");
    expect(error!.message).toContain("file-contract");
  });

  test("rejects an invalid severity and suggests the right one", () => {
    const errors = errorsOf({ ...VALID_RULES.regex, severity: "eror" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('"severity" must be one of "error", "warning"');
    expect(errors[0]!.message).toContain('did you mean "error"');
  });

  test("names a missing required field and the rule it belongs to", () => {
    const { files: _files, ...withoutFiles } = VALID_RULES.regex;
    const errors = errorsOf(withoutFiles);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('missing required field "files"');
    expect(errors[0]!.ruleId).toBe("no-console");
    expect(errors[0]!.path).toBe("rules.custom[0].files");
  });

  test("requires severity, id and type", () => {
    expect(errorsOf({ ...VALID_RULES.regex, severity: undefined })[0]!.message).toBe(
      'missing required field "severity"'
    );
    expect(errorsOf({ ...VALID_RULES.regex, id: undefined })[0]!.message).toBe('missing required field "id"');
    expect(errorsOf({ id: "x", severity: "error" })[0]!.message).toBe('missing required field "type"');
  });

  test("reports nested missing fields", () => {
    const errors = errorsOf({ ...VALID_RULES["file-pairing"], pair: { to: ".test.ts" } });
    expect(errors.map((error) => error.message)).toContain('missing required field "pair.from"');
  });

  test("warns about unknown fields with a suggestion but does not fail", () => {
    const result = validateRule({ ...VALID_RULES.regex, mustmatch: true }, ".chaperone.json", PATH);
    expect(result.rule).not.toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.level).toBe("warning");
    expect(result.diagnostics[0]!.message).toContain('unknown field "mustmatch"');
    expect(result.diagnostics[0]!.message).toContain('did you mean "mustMatch"');
  });

  test("warns about unknown nested fields", () => {
    const warnings = warningsOf({
      ...VALID_RULES["import-boundary"],
      layers: { shared: { files: "src/**", allowImportsFrom: [], allowImports: [] } },
    });
    expect(warnings[0]!.message).toContain('unknown field "layers.shared.allowImports"');
  });

  test("accepts forbidden as a deprecated alias of mustMatch: false", () => {
    const result = validateRule({ ...VALID_RULES.regex, forbidden: true }, ".chaperone.json", PATH);
    expect(result.rule).toMatchObject({ mustMatch: false });
    expect(result.rule).not.toHaveProperty("forbidden");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.level).toBe("warning");
    expect(result.diagnostics[0]!.message).toContain('"forbidden" is deprecated');
  });

  test("forbidden: false means the pattern is required", () => {
    const result = validateRule({ ...VALID_RULES.regex, forbidden: false }, ".chaperone.json", PATH);
    expect(result.rule).toMatchObject({ mustMatch: true });
  });

  test("rejects forbidden contradicting mustMatch", () => {
    const errors = errorsOf({ ...VALID_RULES.regex, forbidden: true, mustMatch: true });
    expect(errors[0]!.message).toContain("contradicts");
  });

  test("rejects invalid regular expressions", () => {
    const errors = errorsOf({ ...VALID_RULES.regex, pattern: "(unclosed" });
    expect(errors[0]!.message).toContain('"pattern" is not a valid regular expression');
  });

  test("rejects invalid globs", () => {
    const errors = errorsOf({ ...VALID_RULES.regex, files: "src/**/*.{ts,tsx" });
    expect(errors[0]!.message).toContain('"files" is not a valid glob');
  });

  test("rejects layers that allow imports from unknown layers", () => {
    const errors = errorsOf({
      ...VALID_RULES["import-boundary"],
      layers: { shared: { files: "src/shared/**", allowImportsFrom: ["shraed"] } },
    });
    expect(errors[0]!.message).toContain('unknown layer "shraed"');
  });

  test("rejects rules that define nothing to check", () => {
    expect(errorsOf({ type: "file-contract", id: "x", severity: "error", files: "a" })[0]!.message).toContain(
      "defines nothing to check"
    );
    expect(
      errorsOf({ type: "forbidden-import", id: "x", severity: "error", files: "a", restrictions: [] })[0]!.message
    ).toContain("defines nothing to check");
  });

  test("rejects maxComponents below 1", () => {
    expect(errorsOf({ ...VALID_RULES["react-component-count"], maxComponents: 0 })[0]!.message).toContain(
      "at least 1"
    );
  });

  test("a disabled entry only needs an id", () => {
    const result = validateRule({ id: "preset/no-legacy-dirs", disabled: true }, ".chaperone.json", PATH);
    expect(result.diagnostics).toEqual([]);
    expect(result.rule).toMatchObject({ id: "preset/no-legacy-dirs", disabled: true });
  });

  test("rejects non-object entries", () => {
    expect(errorsOf("regex")[0]!.message).toContain("rule must be an object");
  });
});

describe("validateConfigShape", () => {
  test("accepts a typical config", () => {
    expect(
      validateConfigShape(
        {
          version: "1.0.0",
          extends: ["chaperone/pure-functions"],
          rules: { typescript: { enabled: true }, custom: [] },
          include: ["src/**/*"],
          exclude: ["dist"],
          integrations: { useTypescriptPaths: true },
        },
        ".chaperone.json"
      )
    ).toEqual([]);
  });

  test("warns about unknown top-level fields with suggestions", () => {
    const [warning] = validateConfigShape({ excludes: ["dist"] }, ".chaperone.json");
    expect(warning!.level).toBe("warning");
    expect(warning!.message).toContain('did you mean "exclude"');
  });

  test("rejects mistyped fields", () => {
    const [error] = validateConfigShape({ exclude: "dist" }, ".chaperone.json");
    expect(error!.level).toBe("error");
    expect(error!.message).toContain('"exclude" must be an array');
  });

  test("rejects non-object configs", () => {
    expect(validateConfigShape([], ".chaperone.json")[0]!.message).toContain("must be a JSON object");
  });
});

describe("validateConfigShape: chaperoneVersion", () => {
  test("accepts an exact version, with or without a v", () => {
    expect(validateConfigShape({ chaperoneVersion: "0.10.0", version: "1.0.0" }, ".chaperone.json")).toEqual([]);
    expect(validateConfigShape({ chaperoneVersion: "v0.10.0" }, ".chaperone.json")).toEqual([]);
  });

  test("anything else is an error at the field, with a suggestion", () => {
    expect(validateConfigShape({ chaperoneVersion: "0.10" }, ".chaperone.json")).toEqual([
      {
        level: "error",
        source: ".chaperone.json",
        path: "chaperoneVersion",
        message: '"chaperoneVersion" must be an exact version, such as "0.10.0" (got "0.10") (did you mean "0.10.0"?)',
      },
    ]);
    expect(validateConfigShape({ chaperoneVersion: 10 }, ".chaperone.json")[0]!.level).toBe("error");
  });

  test("a misspelled field is an error, not a warning: it would pin nothing", () => {
    expect(validateConfigShape({ chaperone_version: "0.10.0" }, ".chaperone.json")).toEqual([
      {
        level: "error",
        source: ".chaperone.json",
        path: "chaperone_version",
        message: 'unknown field "chaperone_version" (did you mean "chaperoneVersion"?): a misspelled version pin pins nothing',
      },
    ]);
  });
});
