import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { validateRule } from "../config-schema";
import type { RepeatedLiteralRule } from "../types";
import { runRepeatedLiteralRule } from "./repeated-literal";
import { findLiterals } from "./utils/literals";
import { createRuleContext } from "./utils/rule-context";

afterEach(cleanupProjects);

const OPTIONS = { include: [], exclude: [] };
const CLASS_CONTEXT = "\\bclassName\\s*=|(?<![\\w$.])(?:cn|cva)\\s*\\(";

function rule(overrides: Partial<RepeatedLiteralRule> = {}): RepeatedLiteralRule {
  return {
    type: "repeated-literal",
    id: "classes",
    severity: "error",
    files: "src/**/*.{ts,tsx}",
    minTokens: 4,
    ...overrides,
  };
}

const card = (classes: string) => `export const Card = () => <div className="${classes}" />;\n`;

async function run(files: Record<string, string>, overrides: Partial<RepeatedLiteralRule> = {}) {
  const cwd = makeProject(files);
  return runRepeatedLiteralRule(rule(overrides), { cwd, ...OPTIONS });
}

describe("runRepeatedLiteralRule", () => {
  test("reports a literal's third copy once, at its first place, with every location", async () => {
    const result = await run({
      "src/a.tsx": card("flex items-center gap-2 px-4"),
      "src/b.tsx": card("flex items-center gap-2 px-4"),
      "src/c.tsx": `export const C = () => (\n  <p className="flex items-center gap-2 px-4" />\n);\n`,
    });

    expect(result.results).toHaveLength(1);
    const [found] = result.results;
    expect(found).toMatchObject({ file: "src/a.tsx", line: 1, rule: "repeated-literal/classes", severity: "error" });
    expect(found!.message).toBe('"flex items-center gap-2 px-4" appears 3 times; at most 2 allowed');
    expect(found!.context?.locations).toEqual(["src/a.tsx:1:42", "src/b.tsx:1:42", "src/c.tsx:2:16"]);
    expect(result.filesChecked).toBe(3);
  });

  test("two copies pass, and maxOccurrences moves the limit", async () => {
    const files = { "src/a.tsx": card("a b c d"), "src/b.tsx": card("a b c d") };
    expect((await run(files)).results).toEqual([]);
    expect((await run(files, { maxOccurrences: 1 })).results).toHaveLength(1);
  });

  test("short literals and literals that do not match literalPattern never count", async () => {
    const files = {
      "src/a.ts": 'export const a = ["one two", "one two", "one two", "x-1 y z w", "x-1 y z w", "x-1 y z w"];\n',
    };
    expect((await run(files, { minTokens: 3 })).results.map((entry) => entry.context?.matchedText)).toEqual([
      "x-1 y z w",
    ]);
    expect((await run(files, { minTokens: 1, literalPattern: "one \\w+" })).results).toHaveLength(1);
    expect((await run(files, { minTokens: 1, literalPattern: "one" })).results).toEqual([]);
  });

  test("whitespace is normalized; with ignoreOrder, so is the order of the tokens", async () => {
    const files = {
      "src/a.ts": 'export const a = "a b  c d";\n',
      "src/b.ts": 'export const b = " a b\\tc d ";\n',
      "src/c.ts": 'export const c = "d c b a";\n',
    };
    expect((await run(files)).results).toEqual([]);
    const ordered = await run(files, { ignoreOrder: true });
    expect(ordered.results).toHaveLength(1);
    expect(ordered.results[0]!.context?.matchedText).toBe("a b c d");
  });

  test("results are ordered by count, then by literal", async () => {
    const result = await run(
      { "src/a.ts": `export const a = [${['"b b b b"', '"a a a a"', '"c c c c"'].map((x) => `${x}, ${x}, ${x}`).join(", ")}, "c c c c"];\n` },
      { ignoreOrder: false }
    );
    expect(result.results.map((entry) => entry.context?.matchedText)).toEqual(["c c c c", "a a a a", "b b b b"]);
  });

  test("comments, templates with ${...}, module specifiers and directives never count", async () => {
    const result = await run(
      {
        "src/a.ts": [
          '"use client client client";',
          'import x from "a b c d";',
          'import "a b c d";',
          'export * from "a b c d";',
          'const lazy = import("a b c d");',
          'const required = require("a b c d");',
          "// const commented = \"a b c d\";",
          "/* \"a b c d\" */",
          "const dynamic = `a b c ${x}`;",
          "const once = \"a b c d\";",
        ].join("\n"),
        "src/b.ts": '"use client client client";\nconst t = `a b c d`;\n',
      },
      { maxOccurrences: 1 }
    );
    expect(result.results.map((entry) => entry.context?.locations)).toEqual([["src/a.ts:10:14", "src/b.ts:2:11"]]);
  });

  test("literals between chaperone-ignore-start and chaperone-ignore-end do not count", async () => {
    const result = await run({
      "src/a.ts": 'export const a = "a b c d";\nexport const b = "a b c d";\n',
      "src/b.ts": [
        "// chaperone-ignore-start: generated table",
        'export const c = "a b c d";',
        "// chaperone-ignore-end",
        "",
      ].join("\n"),
    });
    expect(result.results).toEqual([]);
  });
});

describe("repeated-literal contexts", () => {
  const scan = (content: string, path = "src/a.tsx") =>
    findLiterals(content, { path, context: new RegExp(CLASS_CONTEXT, "mg") }).literals.map((entry) => entry.value);

  test("an attribute counts the literal right after it", () => {
    expect(scan('const a = <div className="a b" title="c d" />;')).toEqual(["a b"]);
  });

  test("a match that ends at a bracket counts every literal inside it", () => {
    expect(
      scan('const a = <div className={cn("a b", on && "c d", { "e f": x })} title="no" />; const b = "no";')
    ).toEqual(["a b", "c d", "e f"]);
    expect(scan('const v = cva("base", { variants: { size: { sm: "h-8 px-2" } } }); const z = "no";', "src/a.ts")).toEqual([
      "base",
      "h-8 px-2",
    ]);
  });

  test("only code is matched: not comments, strings or JSX text", () => {
    expect(scan('// className="no"\nconst a = "className=" + "no";\nconst b = <p>className="no"</p>;')).toEqual([]);
  });

  test("a method called cn (x.cn(...)) is not the cn function", () => {
    expect(scan('const a = tools.cn("no"); const b = cn("yes");', "src/a.ts")).toEqual(["yes"]);
  });

  test("contextFiles count every literal in the files they match", async () => {
    const result = await run(
      {
        "src/a.tsx": card("a b c d"),
        "src/b.tsx": 'export const B = () => <div title="a b c d" className={cn("a b c d")} />;\n',
        "src/c.styles.ts": 'export const c = "a b c d";\n',
      },
      { contextPattern: CLASS_CONTEXT, contextFiles: ["**/*.styles.ts"] }
    );
    expect(result.results[0]!.context?.locations).toEqual(["src/a.tsx:1:42", "src/b.tsx:1:59", "src/c.styles.ts:1:18"]);
  });

  test("a contextPattern that matches nowhere is a notice, not a silent pass", async () => {
    const result = await run({ "src/a.ts": 'export const a = "a b c d";\n' }, { contextPattern: "\\bclasName=" });
    expect(result.results).toEqual([]);
    expect(result.notices?.[0]).toContain('"contextPattern" /\\bclasName=/ matched nowhere in 1 file(s)');
  });
});

describe("repeated-literal allow list", () => {
  const files = {
    "src/a.tsx": card("flex min-w-0 flex-1 flex-col"),
    "src/b.tsx": card("flex min-w-0 flex-1 flex-col"),
    "src/c.tsx": card("flex-col flex min-w-0  flex-1"),
  };

  test("an allowed literal is not reported, compared like the literals", async () => {
    const result = await run(files, {
      ignoreOrder: true,
      allow: [{ literal: "flex-1 flex flex-col min-w-0", reason: "A text column in unrelated parts" }],
    });
    expect(result.results).toEqual([]);
  });

  test("an allow entry that excuses nothing is reported", async () => {
    const result = await run(files, {
      ignoreOrder: true,
      allow: [
        { literal: "flex min-w-0 flex-1 flex-col", reason: "used" },
        { literal: "grid gap-4 p-2 m-1", reason: "gone" },
      ],
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ file: ".chaperone.json", severity: "error" });
    expect(result.results[0]!.message).toContain('allow entry "grid gap-4 p-2 m-1" no longer excuses anything');
  });
});

describe("repeated-literal with --since", () => {
  test("reports a repeat only when one of its copies changed, but still counts every file", async () => {
    const cwd = makeProject({
      "src/a.ts": 'export const a = "a b c d";\n',
      "src/b.ts": 'export const b = "a b c d";\n',
      "src/c.ts": 'export const c = "a b c d";\nexport const d = "w x y z";\n',
      "src/d.ts": 'export const e = "w x y z";\nexport const f = "w x y z";\n',
    });
    const context = createRuleContext(cwd, [], { changedFiles: new Set(["src/a.ts"]) });
    const result = await runRepeatedLiteralRule(rule(), { cwd, ...OPTIONS, context });
    expect(result.results.map((entry) => entry.context?.matchedText)).toEqual(["a b c d"]);
  });
});

describe("repeated-literal performance", () => {
  test("reading the literals of 2,000 files takes well under a few seconds", () => {
    const context = new RegExp(CLASS_CONTEXT, "mg");
    let literals = 0;
    const started = performance.now();
    for (let index = 0; index < 2000; index++) {
      const content = [
        'import { cn } from "./cn";',
        `export function Part${index}({ on }: { on: boolean }) {`,
        "  return (",
        `    <div className={cn("flex items-center gap-${index % 7} px-${index % 5}", on && "ring-2 ring-accent")}>`,
        `      <span className="truncate text-sm text-ink font-medium">{"${index}"}</span>`,
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n");
      literals += findLiterals(content, { path: `src/f${index}.tsx`, context }).literals.length;
    }
    const elapsed = performance.now() - started;

    // Three class strings per file; the {"…"} child is not in a class context
    expect(literals).toBe(6000);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("repeated-literal validation", () => {
  const base = { type: "repeated-literal", id: "r", severity: "error", files: "src/**" };
  const diagnostics = (extra: Record<string, unknown>) => validateRule({ ...base, ...extra }, "c", []).diagnostics;

  test("a valid rule has no diagnostics", () => {
    expect(
      diagnostics({
        minTokens: 4,
        contextPattern: CLASS_CONTEXT,
        contextFiles: ["**/*.styles.ts"],
        ignoreOrder: true,
        allow: [{ literal: "a b c d", reason: "why" }],
      })
    ).toEqual([]);
  });

  test("an allow entry needs a reason", () => {
    const [missing] = diagnostics({ allow: [{ literal: "a b" }] });
    expect(missing).toMatchObject({ level: "error", message: 'missing required field "allow[0].reason"' });
    const [empty] = diagnostics({ allow: [{ literal: "a b", reason: "" }] });
    expect(empty).toMatchObject({ level: "error", message: '"allow[0].reason" must not be empty' });
  });

  test("unknown fields are warnings with a suggestion", () => {
    const [warning] = diagnostics({ maxOccurences: 3 });
    expect(warning).toMatchObject({ level: "warning" });
    expect(warning!.message).toContain('did you mean "maxOccurrences"?');
  });

  test("invalid patterns and limits are errors", () => {
    expect(diagnostics({ contextPattern: "cn(" })[0]!.message).toContain('"contextPattern" is not a valid regular expression');
    expect(diagnostics({ literalPattern: "[" })[0]!.message).toContain('"literalPattern" is not a valid regular expression');
    expect(diagnostics({ maxOccurrences: 0 })[0]!.message).toBe('"maxOccurrences" must be at least 1');
    expect(diagnostics({ contextFiles: ["src/{a"] })[0]!.message).toContain('"contextFiles[0]" is not a valid glob');
  });

  test("warns about contextFiles without contextPattern, empty-matching contexts and repeated allow entries", () => {
    expect(diagnostics({ contextFiles: ["**/*.styles.ts"] })[0]!.message).toContain("has no effect");
    expect(diagnostics({ contextPattern: "className=|" })[0]!.message).toContain("can match an empty string");
    const repeated = diagnostics({ allow: [{ literal: "a b", reason: "x" }, { literal: " a b ", reason: "y" }] });
    expect(repeated[0]).toMatchObject({ level: "warning", message: '"allow[1]" repeats "allow[0]" ("a b")' });
  });
});
