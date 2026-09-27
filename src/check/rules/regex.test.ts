import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { validateRule } from "../config-schema";
import type { RegexRule } from "../types";
import { resolveRegexFlags, runRegexRule } from "./regex";

afterEach(cleanupProjects);

const OPTIONS = { include: [], exclude: [] };

function rule(overrides: Partial<RegexRule>): RegexRule {
  return {
    type: "regex",
    id: "test",
    severity: "error",
    files: "src/**/*.ts",
    pattern: "TODO",
    message: "No TODOs",
    ...overrides,
  };
}

describe("runRegexRule", () => {
  test("mustMatch does not produce false positives across multi-file globs", async () => {
    const cwd = makeProject();
    const files = [
      ["apps/api/src/modules/a/a.route.ts", "operationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/b/b.route.ts", "operationId\noperationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/c/c.route.ts", "operationId\noperationId\noperationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/d/d.route.ts", "operationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/e/e.route.ts", "operationId\noperationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/me/me.route.ts", "operationId\n"],
      ["apps/api/src/modules/task-activity/task-activity.route.ts", "operationId\n"],
    ] as const;

    for (const [file, content] of files) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
    }

    const result = await runRegexRule(
      rule({ files: "apps/api/src/modules/*/*.route.ts", pattern: "operationId", mustMatch: true }),
      { cwd, ...OPTIONS }
    );

    expect(result.results).toHaveLength(0);
  });

  test("^ and $ match per line by default", async () => {
    const cwd = makeProject({
      "src/a.ts": 'import { x } from "./x";\n\nexport default function A() {}\n',
    });

    const result = await runRegexRule(rule({ pattern: "^\\s*export\\s+default\\b" }), { cwd, ...OPTIONS });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ line: 3, column: 1 });
    expect(result.results[0]!.context?.matchedText).toBe("export default");
  });

  test("flags replace the default, so an empty string anchors ^ to the start of the file", async () => {
    const cwd = makeProject({ "src/a.ts": "const a = 1;\nexport default a;\n" });

    const result = await runRegexRule(rule({ pattern: "^export default", flags: "" }), { cwd, ...OPTIONS });
    expect(result.results).toHaveLength(0);
  });

  test("custom flags such as i are honoured", async () => {
    const cwd = makeProject({ "src/a.ts": "// todo: later\n" });
    const result = await runRegexRule(rule({ flags: "im" }), { cwd, ...OPTIONS });
    expect(result.results).toHaveLength(1);
  });

  test("a pattern that matches the empty string terminates and reports only real matches", async () => {
    const cwd = makeProject({ "src/a.ts": "const a = 1; // TODO fix\nconst b = 2;\n" });

    const result = await runRegexRule(rule({ pattern: "TODO|" }), { cwd, ...OPTIONS });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.context?.matchedText).toBe("TODO");
  });

  test("zero-length matches do not satisfy mustMatch", async () => {
    const cwd = makeProject({ "src/a.ts": "const a = 1;\n" });
    const result = await runRegexRule(rule({ pattern: "TODO|", mustMatch: true }), { cwd, ...OPTIONS });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.context).toMatchObject({ actualValue: "no match" });
  });

  test("reports every match with line, column and surrounding lines", async () => {
    const cwd = makeProject({ "src/a.ts": "one\r\n// TODO a\r\nthree TODO\r\n" });
    const result = await runRegexRule(rule({}), { cwd, ...OPTIONS });

    expect(result.results.map((entry) => [entry.line, entry.column])).toEqual([
      [2, 4],
      [3, 7],
    ]);
    expect(result.results[0]!.context?.surroundingLines).toEqual(["  1 | one", "> 2 | // TODO a", "  3 | three TODO"]);
  });

  test("reportOnce reports the first match per file", async () => {
    const cwd = makeProject({ "src/a.ts": "TODO\nTODO\n" });
    const result = await runRegexRule(rule({ reportOnce: true }), { cwd, ...OPTIONS });
    expect(result.results).toHaveLength(1);
  });

  test("forbidden: true behaves like mustMatch: false", async () => {
    const cwd = makeProject({ "src/a.ts": "TODO\n" });
    const result = await runRegexRule(rule({ forbidden: true }), { cwd, ...OPTIONS });
    expect(result.results).toHaveLength(1);
  });

  test("reports how many files the glob selected", async () => {
    const cwd = makeProject({ "src/a.ts": "", "src/b.ts": "", "lib/c.ts": "" });
    expect((await runRegexRule(rule({}), { cwd, ...OPTIONS })).filesChecked).toBe(2);
  });
});

describe("regex rule validation", () => {
  const base = { type: "regex", id: "r", severity: "error", files: "src/**", pattern: "x", message: "m" };

  test("resolveRegexFlags adds g, strips y and defaults to m", () => {
    expect(resolveRegexFlags(undefined)).toBe("mg");
    expect(resolveRegexFlags("")).toBe("g");
    expect(resolveRegexFlags("iy")).toBe("ig");
  });

  test("rejects unsupported flags", () => {
    const [error] = validateRule({ ...base, flags: "mx" }, "c", []).diagnostics;
    expect(error!.level).toBe("error");
    expect(error!.message).toContain("unsupported flag");
  });

  test("warns when a pattern can match the empty string", () => {
    const [warning] = validateRule({ ...base, pattern: "TODO|" }, "c", []).diagnostics;
    expect(warning!.level).toBe("warning");
    expect(warning!.message).toContain("can match an empty string");
  });

  test("validates the pattern with the rule's flags", () => {
    const [error] = validateRule({ ...base, pattern: "\\p{L", flags: "u" }, "c", []).diagnostics;
    expect(error!.message).toContain("not a valid regular expression");
  });
});

describe("runRegexRule: zero-length matches", () => {
  test("lookahead-only patterns report their matches", async () => {
    const cwd = makeProject({ "src/a.ts": "const a = 1;\nconsole.log(a);\n" });
    const result = await runRegexRule(rule({ pattern: "(?=console\\.log)" }), { cwd, ...OPTIONS });
    expect(result.results.map((entry) => [entry.line, entry.context?.matchedText])).toEqual([[2, "console.log(a);"]]);

    const required = await runRegexRule(rule({ pattern: "(?=console\\.log)", mustMatch: true }), { cwd, ...OPTIONS });
    expect(required.results).toEqual([]);
  });
});
