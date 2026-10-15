import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { check } from "../index";
import type { CheckResult, RunnerSummary } from "../types";
import {
  BaselineError,
  entriesFor,
  fingerprintResult,
  fingerprintResults,
  matchBaseline,
  parseBaseline,
  serializeBaseline,
  updateBaseline,
  verifiableIn,
  type Baseline,
  type BaselineEntry,
} from "./baseline";
import { readBaselineFile, writeBaselineFile } from "./file";

afterEach(cleanupProjects);

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    file: "src/a.ts",
    line: 1,
    rule: "eslint/no-console",
    message: "Unexpected console statement.",
    severity: "error",
    source: "eslint",
    ...overrides,
  };
}

function fingerprinted(results: CheckResult[], files: Record<string, string> = {}) {
  return fingerprintResults(results, (file) => files[file] ?? null);
}

const SOURCE = "export const a = 1;\nconsole.log(a);\n";

describe("fingerprints", () => {
  test("survive the violation moving down ten lines", () => {
    const moved = `${"\n".repeat(10)}${SOURCE}`;
    const before = fingerprinted([result({ line: 2 })], { "src/a.ts": SOURCE });
    const after = fingerprinted([result({ line: 12 })], { "src/a.ts": moved });
    expect(after[0]!.fingerprint).toBe(before[0]!.fingerprint);
    expect(matchBaseline(after, entriesFor(before)).fresh).toEqual([]);
  });

  test("survive re-indenting, and line numbers in the message", () => {
    const a = fingerprintResult(result({ message: "Exported function at line 12 must have JSDoc" }), "  foo( a,  b )");
    const b = fingerprintResult(result({ message: "Exported function at line 40 must have JSDoc" }), "\tfoo( a, b )");
    expect(a).toBe(b);
  });

  test("change when the offending line changes", () => {
    expect(fingerprintResult(result(), "console.log(a);")).not.toBe(fingerprintResult(result(), "console.log(b);"));
  });

  test("a regex match is the offending text, wherever its line is", () => {
    const withMatch = (line: string) => fingerprintResult(result({ context: { matchedText: "TODO" } }), line);
    expect(withMatch("// TODO one")).toBe(withMatch("const x = 1; // TODO two"));
  });
});

describe("matchBaseline", () => {
  const files = { "src/a.ts": SOURCE, "src/b.ts": SOURCE };
  const legacy = fingerprinted([result({ line: 2 }), result({ file: "src/b.ts", line: 2 })], files);
  const entries = entriesFor(legacy);

  test("baselined results do not count; new ones do", () => {
    const now = fingerprinted(
      [result({ line: 2 }), result({ file: "src/b.ts", line: 2 }), result({ file: "src/c.ts", line: 2 })],
      { ...files, "src/c.ts": SOURCE }
    );
    const match = matchBaseline(now, entries);
    expect(match.fresh.map((r) => r.file)).toEqual(["src/c.ts"]);
    expect(match.baselined.map((r) => r.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(match.stale).toEqual([]);
  });

  test("entries that no longer occur are stale", () => {
    const match = matchBaseline(fingerprinted([result({ line: 2 })], files), entries);
    expect(match.fresh).toEqual([]);
    expect(match.stale.map((entry) => entry.file)).toEqual(["src/b.ts"]);
  });

  test("identical violations are counted: one more than recorded is new", () => {
    const twice = "console.log(a);\nconsole.log(a);\nconsole.log(a);\n";
    const recorded = entriesFor(fingerprinted([result({ line: 1 }), result({ line: 2 })], { "src/a.ts": twice }));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.count).toBe(2);

    const now = fingerprinted([result({ line: 1 }), result({ line: 2 }), result({ line: 3 })], { "src/a.ts": twice });
    const match = matchBaseline(now, recorded);
    expect(match.baselined).toHaveLength(2);
    expect(match.fresh.map((r) => r.line)).toEqual([3]);

    const one = matchBaseline(fingerprinted([result({ line: 1 })], { "src/a.ts": twice }), recorded);
    expect(one.stale[0]!.count).toBeUndefined(); // one of the two is gone
  });

  test("entries whose tool did not run are unverified, not stale", () => {
    const runners: RunnerSummary[] = [
      { name: "eslint", label: "ESLint", status: "skipped", reason: "no config", errors: 0, warnings: 0 },
    ];
    const match = matchBaseline([], entries, verifiableIn({ runners }));
    expect(match.stale).toEqual([]);
    expect(match.unverified).toHaveLength(2);
  });

  test("with --since, a custom rule's entry outside the changed files is unverified", () => {
    const custom: BaselineEntry = { rule: "regex/no-todo", file: "src/old.ts", fingerprint: "x", message: "" };
    const tool: BaselineEntry = { rule: "eslint/no-console", file: "src/old.ts", fingerprint: "y", message: "" };
    const runners: RunnerSummary[] = [
      { name: "eslint", label: "ESLint", status: "passed", errors: 0, warnings: 0 },
    ];
    const isVerifiable = verifiableIn({ runners, changedFiles: new Set(["src/new.ts"]) });
    expect(isVerifiable(custom)).toBe(false);
    expect(isVerifiable(tool)).toBe(true);
  });
});

describe("updateBaseline", () => {
  const files = { "src/a.ts": SOURCE, "src/b.ts": SOURCE, "src/c.ts": SOURCE };
  const legacy = fingerprinted([result({ line: 2 }), result({ file: "src/b.ts", line: 2 })], files);
  const previous: Baseline = { version: 1, entries: entriesFor(legacy) };

  test("with no baseline, records every violation", () => {
    const update = updateBaseline(null, legacy);
    expect(update.created).toBe(true);
    expect(update.baseline.entries).toHaveLength(2);
  });

  test("only shrinks: removes what is gone and refuses what is new", () => {
    const now = fingerprinted([result({ line: 2 }), result({ file: "src/c.ts", line: 2 })], files);
    const update = updateBaseline(previous, now);
    expect(update.baseline.entries.map((entry) => entry.file)).toEqual(["src/a.ts"]);
    expect(update.removed.map((entry) => entry.file)).toEqual(["src/b.ts"]);
    expect(update.added).toEqual([]);
    expect(update.refused.map((entry) => entry.file)).toEqual(["src/c.ts"]);
    expect(update.fresh.map((r) => r.file)).toEqual(["src/c.ts"]);
    expect(update.changed).toBe(true);
  });

  test("--allow-growth adds the new violations and says which", () => {
    const now = fingerprinted([...legacy.map(({ result: r }) => r), result({ file: "src/c.ts", line: 2 })], files);
    const update = updateBaseline(previous, now, { allowGrowth: true });
    expect(update.added.map((entry) => entry.file)).toEqual(["src/c.ts"]);
    expect(update.refused).toEqual([]);
    expect(update.baseline.entries).toHaveLength(3);
  });

  test("keeps unverified entries", () => {
    const update = updateBaseline(previous, [], { isVerifiable: () => false });
    expect(update.baseline.entries).toEqual(previous.entries);
    expect(update.unverified).toHaveLength(2);
    expect(update.changed).toBe(false);
  });

  test("nothing changed: the file is up to date", () => {
    expect(updateBaseline(previous, legacy).changed).toBe(false);
  });
});

describe("the file", () => {
  test("round-trips, sorted, with count only above 1", () => {
    const baseline: Baseline = {
      version: 1,
      entries: [
        { rule: "r/b", file: "src/b.ts", fingerprint: "2", message: "b", count: 1 },
        { rule: "r/a", file: "src/a.ts", fingerprint: "1", message: "a", count: 3 },
      ],
    };
    const text = serializeBaseline(baseline);
    expect(text.endsWith("}\n")).toBe(true);
    const parsed = parseBaseline(text);
    expect(parsed.entries.map((entry) => entry.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parsed.entries[0]!.count).toBe(3);
    expect("count" in parsed.entries[1]!).toBe(false);
  });

  test("an invalid file is a BaselineError", () => {
    expect(() => parseBaseline("{")).toThrow(BaselineError);
    expect(() => parseBaseline('{"version":2,"entries":[]}')).toThrow("this Chaperone reads version 1");
    expect(() => parseBaseline('{"version":1,"entries":[{"rule":"r"}]}')).toThrow('needs a string "file"');
    expect(() =>
      parseBaseline('{"version":1,"entries":[{"rule":"r","file":"f","fingerprint":"x","count":0}]}')
    ).toThrow("at least 1");
  });

  test("reads and writes in the project root", () => {
    const cwd = makeProject();
    expect(readBaselineFile(cwd)).toBeNull();
    writeBaselineFile(cwd, { version: 1, entries: [] });
    expect(readFileSync(join(cwd, ".chaperone-baseline.json"), "utf-8")).toBe('{\n  "version": 1,\n  "entries": []\n}\n');
    expect(readBaselineFile(cwd)).toEqual({ version: 1, entries: [] });
  });
});

describe("check() with a baseline", () => {
  const NO_TODO = {
    type: "regex",
    id: "no-todo",
    severity: "error",
    files: "src/**/*.ts",
    pattern: "TODO.*",
    message: "No TODOs",
  };

  function project(files: Record<string, string>): string {
    return makeProject({
      ".chaperone.json": JSON.stringify({ version: "1.0.0", rules: { custom: [NO_TODO] } }),
      ...files,
    });
  }

  async function writeBaselineFor(cwd: string): Promise<void> {
    const summary = await check({ cwd, format: "text", useBaseline: false });
    const entries = entriesFor(fingerprintResults(summary.results, (file) => readFileSync(join(cwd, file), "utf-8")));
    writeBaselineFile(cwd, { version: 1, entries });
  }

  test("a violation moved down ten lines is still baselined", async () => {
    const cwd = project({ "src/a.ts": "export const a = 1;\n// TODO legacy\n" });
    await writeBaselineFor(cwd);
    writeFileSync(join(cwd, "src/a.ts"), `export const a = 1;\n${"\n".repeat(10)}// TODO legacy\n`);

    const summary = await check({ cwd, format: "text" });
    expect(summary.success).toBe(true);
    expect(summary.results).toEqual([]);
    expect(summary.baseline?.baselined.map((r) => r.line)).toEqual([12]);
    expect(summary.baseline?.stale).toEqual([]);
  });

  test("useBaseline: false reports everything", async () => {
    const cwd = project({ "src/a.ts": "// TODO legacy\n" });
    await writeBaselineFor(cwd);
    const summary = await check({ cwd, format: "text", useBaseline: false });
    expect(summary.totalErrors).toBe(1);
    expect(summary.baseline).toBeUndefined();
  });

  test("an invalid baseline file stops the check", async () => {
    const cwd = project({ "src/a.ts": "", ".chaperone-baseline.json": "[]" });
    await expect(check({ cwd, format: "text" })).rejects.toThrow(BaselineError);
  });
});
