import { describe, expect, test } from "bun:test";
import type { CheckResult, CheckSummary } from "../types";
import { format, formatAI, formatJson, formatText } from "./index";

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    file: "src/a.ts",
    line: 3,
    column: 5,
    rule: "regex/no-console",
    message: "No console.log",
    severity: "error",
    source: "custom",
    context: { matchedText: "console.log(", expectedValue: "no console", actualValue: "console.log" },
    ...overrides,
  };
}

function summary(overrides: Partial<CheckSummary> = {}): CheckSummary {
  const results = overrides.results ?? [];
  return {
    totalFiles: 10,
    totalErrors: results.filter((entry) => entry.severity === "error").length,
    totalWarnings: results.filter((entry) => entry.severity === "warning").length,
    duration: 1234,
    success: results.every((entry) => entry.severity !== "error"),
    results,
    bySource: {},
    runners: [
      { name: "typescript", label: "TypeScript", status: "passed", durationMs: 2000, errors: 0, warnings: 0 },
      { name: "eslint", label: "ESLint", status: "skipped", reason: "no ESLint config in the project root", errors: 0, warnings: 0 },
      { name: "prettier", label: "Prettier", status: "error", reason: "Prettier exited with code 2", errors: 1, warnings: 0 },
    ],
    rules: [
      { id: "no-console", type: "regex", status: "passed", filesChecked: 4, errors: 0, warnings: 0, notices: [] },
      {
        id: "vue-only",
        type: "regex",
        status: "no-files",
        filesChecked: 0,
        errors: 0,
        warnings: 0,
        notices: ['"files" glob "src/**/*.vue" matched no files, so it checked nothing'],
      },
    ],
    disabledRules: [{ id: "preset/no-legacy-dirs", source: ".chaperone.json" }],
    diagnostics: [
      { level: "warning", source: ".chaperone.json", path: "rules.custom[0].mustmatch", ruleId: "no-console", message: 'unknown field "mustmatch" is ignored' },
    ],
    ...overrides,
  };
}

describe("status line", () => {
  test("PASSED is qualified when tools were skipped or rules matched no files", () => {
    const text = formatText(summary());
    expect(text).toContain(
      "PASSED, but not everything was checked: 1 tool skipped (eslint); 1 rule matched no files (vue-only)"
    );
    expect(formatAI(summary())).toContain("**Status:** PASSED, but not everything was checked");

    const json = JSON.parse(formatJson(summary()));
    expect(json.status).toBe("passed-with-gaps");
    expect(json.gaps).toEqual(["1 tool skipped (eslint)", "1 rule matched no files (vue-only)"]);
  });

  test("a complete pass is plain PASSED", () => {
    const complete = summary({
      runners: [],
      rules: [],
      disabledRules: [],
      diagnostics: [],
    });
    expect(formatText(complete)).toContain("Chaperone Check - PASSED\n");
    expect(JSON.parse(formatJson(complete)).status).toBe("passed");
  });
});

describe("every format reports skipped tools, zero-match rules, disabled rules and config warnings", () => {
  test.each(["text", "json", "ai"] as const)("%s", (outputFormat) => {
    const output = format(summary(), outputFormat);
    expect(output).toContain("no ESLint config in the project root");
    expect(output).toContain("Prettier exited with code 2");
    expect(output).toContain("matched no files");
    expect(output).toContain("preset/no-legacy-dirs");
    expect(output).toContain("mustmatch");
  });
});

describe("formatAI", () => {
  test("includes each result's context", () => {
    const output = formatAI(summary({ results: [result()] }));
    expect(output).toContain("- **src/a.ts:3:5** — ERROR: No console.log");
    expect(output).toContain("  - Found: `console.log(`");
    expect(output).toContain("  - Expected: no console; actual: console.log");
  });

  test("caps results per rule and says how many were omitted", () => {
    const many = Array.from({ length: 25 }, (_, index) => result({ file: `src/f${String(index).padStart(2, "0")}.ts` }));
    const output = formatAI(summary({ results: many }), { maxPerRule: 20 });
    expect(output.match(/— ERROR: No console\.log/g)).toHaveLength(20);
    expect(output).toContain("… and 5 more for `regex/no-console`");
    expect(output).toContain("5 result(s) were omitted above");
  });

  test("--quiet lists only errors", () => {
    const output = formatAI(
      summary({ results: [result(), result({ rule: "regex/no-todo", severity: "warning", message: "No TODO" })] }),
      { quiet: true }
    );
    expect(output).toContain("regex/no-console");
    expect(output).not.toContain("regex/no-todo");
  });
});

describe("formatJson", () => {
  test("includes runners, rules, disabled rules and diagnostics", () => {
    const json = JSON.parse(formatJson(summary({ results: [result()] })));
    expect(json.success).toBe(false);
    expect(json.runners.map((runner: { status: string }) => runner.status)).toEqual(["passed", "skipped", "error"]);
    expect(json.rules[1]).toMatchObject({ id: "vue-only", status: "no-files", filesChecked: 0 });
    expect(json.disabledRules).toEqual([{ id: "preset/no-legacy-dirs", source: ".chaperone.json" }]);
    expect(json.diagnostics[0].message).toBe('unknown field "mustmatch" is ignored');
    expect(json.results[0].context.matchedText).toBe("console.log(");
  });
});

describe("formatText", () => {
  test("no ANSI codes unless colour is requested", () => {
    expect(formatText(summary({ results: [result()] }))).not.toContain("\x1b[");
    expect(formatText(summary({ results: [result()] }), { color: true })).toContain("\x1b[");
  });
});

describe("partly checked rules", () => {
  test("rules with scope notices qualify PASSED", () => {
    const json = JSON.parse(
      formatJson(
        summary({
          runners: [],
          disabledRules: [],
          rules: [
            {
              id: "layers",
              type: "import-boundary",
              status: "passed",
              filesChecked: 10,
              errors: 0,
              warnings: 0,
              notices: ["layers with no matching files: widgets (src/widgets/**)"],
            },
          ],
        })
      )
    );
    expect(json.status).toBe("passed-with-gaps");
    expect(json.gaps).toEqual(["1 rule only partly checked (layers; see the notices)"]);
  });
});
