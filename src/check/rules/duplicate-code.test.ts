import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { validateRule } from "../config-schema";
import type { DuplicateCodeRule } from "../types";
import { runDuplicateCodeRule } from "./duplicate-code";
import { findClones } from "./utils/clones";
import { CHAPERONE_IGNORE, JSCPD_IGNORE } from "./utils/ignore-regions";
import { createRuleContext } from "./utils/rule-context";

afterEach(cleanupProjects);

const OPTIONS = { include: [], exclude: [] };

function rule(overrides: Partial<DuplicateCodeRule> = {}): DuplicateCodeRule {
  return { type: "duplicate-code", id: "copies", severity: "error", files: "src/**/*.{ts,tsx}", minTokens: 50, ...overrides };
}

/** A component of 145 tokens over 21 lines (after its name): a tab header */
const header = (name: string, extra = "") => `import { Button } from "./button";
${extra}
export function ${name}({ title, subtitle, href, onBack }: Props) {
  return (
    <header className="shrink-0 border-b bg-surface">
      <div className="flex h-14 items-center gap-1 px-1">
        {onBack ? (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="truncate text-xs">{subtitle}</p>
        </div>
        <a href={href} className="inline-flex items-center gap-1 px-2 text-sm">
          <ExternalLink aria-hidden className="size-4" />
          Open
        </a>
      </div>
    </header>
  );
}
`;

/** A function of 80 tokens over 7 lines (77 after its name) */
const stats = (name: string) => `export function ${name}(items: number[]) {
  const total = items.reduce((sum, item) => sum + item, 0);
  const average = total / items.length;
  const max = Math.max(...items);
  const min = Math.min(...items);
  return { total, average, max, min, spread: max - min };
}
`;

async function run(files: Record<string, string>, overrides: Partial<DuplicateCodeRule> = {}) {
  const cwd = makeProject(files);
  return runDuplicateCodeRule(rule(overrides), { cwd, ...OPTIONS });
}

describe("runDuplicateCodeRule", () => {
  test("reports a pasted component, renamed, with both places and their line ranges", async () => {
    const result = await run(
      { "src/issues.tsx": header("IssuesHeader"), "src/errors.tsx": header("ErrorsHeader") },
      { minTokens: 100 }
    );

    expect(result.results).toHaveLength(1);
    const [copy] = result.results;
    // Files are read in path order: errors.tsx comes first, so issues.tsx holds the copy
    expect(copy).toMatchObject({ file: "src/issues.tsx", line: 3, rule: "duplicate-code/copies", severity: "error" });
    expect(copy!.message).toBe("Lines 3-23 repeat src/errors.tsx:3-23, 145 tokens");
    expect(copy!.context?.locations).toEqual(["src/errors.tsx:3-23", "src/issues.tsx:3-23"]);
    expect(result.filesChecked).toBe(2);
  });

  test("a custom message comes first, with the copy in parentheses", async () => {
    const result = await run({ "src/a.ts": stats("a"), "src/b.ts": stats("b") }, { message: "Copied code: share it" });
    expect(result.results[0]!.message).toBe("Copied code: share it (lines 1-7 repeat src/a.ts:1-7, 77 tokens)");
  });

  test("blocks under minTokens or minLines are not copies", async () => {
    const files = { "src/a.ts": stats("a"), "src/b.ts": stats("b") };
    expect((await run(files, { minTokens: 100 })).results).toEqual([]);
    expect((await run(files, { minTokens: 50 })).results).toHaveLength(1);
    expect((await run(files, { minTokens: 50, minLines: 8 })).results).toEqual([]);
  });

  test("renamed identifiers and changed literals break a copy where they change", async () => {
    const renamed = stats("b").replace(/items/g, "values");
    const relabeled = stats("c").replace("spread", "range");
    expect((await run({ "src/a.ts": stats("a"), "src/b.ts": renamed })).results).toEqual([]);
    expect((await run({ "src/a.ts": stats("a"), "src/c.ts": relabeled }, { minTokens: 40 })).results[0]!.context?.locations).toEqual(
      ["src/a.ts:1-6", "src/c.ts:1-6"]
    );
  });

  test("whitespace, line breaks, comments and JSX indentation do not hide a copy", async () => {
    const reformatted = header("ErrorsHeader")
      .replace(/^ {6}/gm, "          ")
      .replace("{onBack ? (", "{/* back on phones */ onBack ? (")
      .replace('variant="ghost" size="icon"', 'variant="ghost"\n            size="icon"');
    const result = await run({ "src/issues.tsx": header("IssuesHeader"), "src/errors.tsx": reformatted }, { minTokens: 100 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.context?.actualValue).toBe("145 tokens over 21 lines");
  });

  test("a block in three files is reported twice, each copy against the first", async () => {
    const result = await run({ "src/a.ts": stats("a"), "src/b.ts": stats("b"), "src/c.ts": stats("c") });
    expect(result.results.map((entry) => entry.context?.locations)).toEqual([
      ["src/a.ts:1-7", "src/b.ts:1-7"],
      ["src/a.ts:1-7", "src/c.ts:1-7"],
    ]);
  });

  test("copies inside one file count, and never overlap themselves", async () => {
    const result = await run({ "src/a.ts": `${stats("a")}\n${stats("a2")}` });
    expect(result.results.map((entry) => entry.context?.locations)).toEqual([["src/a.ts:1-7", "src/a.ts:9-15"]]);
    const repetitive = `export const zeros = [${Array.from({ length: 400 }, () => "0").join(",\n")}];\n`;
    // A long repeating run is a few reports that never overlap, not one per offset
    expect((await run({ "src/z.ts": repetitive })).results.map((entry) => entry.context?.locations)).toEqual([
      ["src/z.ts:1-200", "src/z.ts:201-400"],
      ["src/z.ts:1-100", "src/z.ts:101-200"],
      ["src/z.ts:1-50", "src/z.ts:51-100"],
      ["src/z.ts:1-25", "src/z.ts:26-50"],
    ]);
  });

  test("code between ignore-start and ignore-end comments is left out, jscpd's markers included", async () => {
    const wrap = (start: string, end: string, body: string) => `// ${start}: kept on purpose\n${body}// ${end}\n`;
    const chaperone = wrap("chaperone-ignore-start", "chaperone-ignore-end", stats("b"));
    const jscpd = wrap("jscpd:ignore-start", "jscpd:ignore-end", stats("c"));
    expect((await run({ "src/a.ts": stats("a"), "src/b.ts": chaperone, "src/c.ts": jscpd })).results).toEqual([]);
    // A marker in a string is not a comment
    const fake = `const marker = "chaperone-ignore-start";\n${stats("d")}`;
    expect((await run({ "src/a.ts": stats("a"), "src/d.ts": fake })).results).toHaveLength(1);
  });

  test("an ignored region splits the code around it, so no copy runs across it", () => {
    const half = stats("a").split("\n");
    const split = [...half.slice(0, 3), "// chaperone-ignore-start", "const unrelated = 1;", "// chaperone-ignore-end", ...half.slice(3)].join("\n");
    const clones = findClones(
      [
        { path: "a.ts", content: stats("a") },
        { path: "b.ts", content: split },
      ],
      { minTokens: 20, minLines: 1, ignoreMarkers: [CHAPERONE_IGNORE, JSCPD_IGNORE] }
    );
    expect(clones.map((clone) => [clone.first.startLine, clone.first.endLine, clone.second.startLine, clone.second.endLine])).toEqual([
      [1, 3, 1, 3],
      [4, 7, 7, 10],
    ]);
  });

  test("the result is the same whatever order the files are given in", () => {
    const sources = [
      { path: "a.ts", content: stats("a") },
      { path: "b.ts", content: stats("b") },
      { path: "c.ts", content: `${stats("c")}\n${stats("d")}` },
    ];
    const options = { minTokens: 30, minLines: 1, ignoreMarkers: [] };
    const first = findClones(sources, options);
    expect(findClones([...sources], options)).toEqual(first);
    expect(first).toHaveLength(3);
  });
});

describe("duplicate-code allow list", () => {
  const files = { "src/a.ts": stats("a"), "src/b.ts": stats("b"), "src/c.ts": stats("c") };

  test("an allowed pair is not reported, in either order and by glob", async () => {
    const result = await run(files, {
      allow: [
        { files: ["src/b.ts", "src/a.ts"], reason: "Two readers that merge next" },
        { files: ["src/a.ts", "src/{c,d}.ts"], reason: "Generated" },
      ],
    });
    expect(result.results).toEqual([]);
  });

  test("an allow entry that matches no copy is reported", async () => {
    const result = await run(files, {
      allow: [
        { files: ["src/a.ts", "src/b.ts"], reason: "used" },
        { files: ["src/b.ts", "src/c.ts"], reason: "b and c are never paired: c is reported against a" },
      ],
    });
    expect(result.results.map((entry) => [entry.file, entry.message])).toEqual([
      ["src/c.ts", "Lines 1-7 repeat src/a.ts:1-7, 77 tokens"],
      [".chaperone.json", "allow entry for src/b.ts and src/c.ts no longer matches a copy. Remove it from the allow list."],
    ]);
  });
});

describe("duplicate-code with --since", () => {
  test("reports a copy only when one of its files changed, but compares every file", async () => {
    const cwd = makeProject({ "src/a.ts": stats("a"), "src/b.ts": stats("b"), "src/c.tsx": header("C"), "src/d.tsx": header("D") });
    const context = createRuleContext(cwd, [], { changedFiles: new Set(["src/b.ts"]) });
    const result = await runDuplicateCodeRule(rule(), { cwd, ...OPTIONS, context });
    expect(result.results.map((entry) => entry.context?.locations)).toEqual([["src/a.ts:1-7", "src/b.ts:1-7"]]);
  });
});

describe("duplicate-code performance", () => {
  test("2,000 files of 30 lines are compared in well under a few seconds", () => {
    const sources: Array<{ path: string; content: string }> = [];
    for (let index = 0; index < 2000; index++) {
      const lines = [`import { helper${index % 13} } from "./helpers";`, ""];
      for (let part = 0; part < 6; part++) {
        lines.push(
          `export function part${index}_${part}(input: number): number {`,
          `  const scaled = input * ${index * 7 + part} + helper${(index + part) % 13}(${part});`,
          `  return scaled > ${index} ? scaled - ${part} : scaled + ${index % 17};`,
          "}",
          ""
        );
      }
      sources.push({ path: `src/f${String(index).padStart(4, "0")}.ts`, content: lines.join("\n") });
    }
    // Two real copies hidden in the crowd
    sources.push({ path: "src/x-copy-a.ts", content: stats("copyA") }, { path: "src/x-copy-b.ts", content: stats("copyB") });
    sources.push({ path: "src/y-copy-c.tsx", content: header("CopyC") }, { path: "src/y-copy-d.tsx", content: header("CopyD") });

    const started = performance.now();
    const clones = findClones(sources, { minTokens: 50, minLines: 5, ignoreMarkers: [CHAPERONE_IGNORE, JSCPD_IGNORE] });
    const elapsed = performance.now() - started;

    expect(clones.map((clone) => clone.second.file)).toEqual(["src/x-copy-b.ts", "src/y-copy-d.tsx"]);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("duplicate-code validation", () => {
  const base = { type: "duplicate-code", id: "d", severity: "error", files: "src/**" };
  const diagnostics = (extra: Record<string, unknown>) => validateRule({ ...base, ...extra }, "c", []).diagnostics;

  test("a valid rule has no diagnostics", () => {
    expect(diagnostics({ minTokens: 100, minLines: 5, allow: [{ files: ["a.ts", "b.ts"], reason: "why" }] })).toEqual([]);
  });

  test("an allow entry names exactly two files and a reason", () => {
    expect(diagnostics({ allow: [{ files: ["a.ts"], reason: "x" }] })[0]!.message).toBe(
      '"allow[0].files" must name exactly two files'
    );
    expect(diagnostics({ allow: [{ files: ["a.ts", "b.ts"] }] })[0]!.message).toBe('missing required field "allow[0].reason"');
    expect(diagnostics({ allow: [{ files: ["a.ts", "src/{b"], reason: "x" }] })[0]!.message).toContain(
      '"allow[0].files[1]" is not a valid glob'
    );
  });

  test("unknown fields are warnings with a suggestion, bad limits are errors", () => {
    const [warning] = diagnostics({ minToken: 50 });
    expect(warning).toMatchObject({ level: "warning" });
    expect(warning!.message).toContain('did you mean "minTokens"?');
    expect(diagnostics({ minLines: 0 })[0]!.message).toBe('"minLines" must be at least 1');
  });
});
