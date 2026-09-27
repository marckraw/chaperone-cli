import { describe, expect, test } from "bun:test";
import { analyzeBrackets, jsxEnabledFor, tokenize, type Token } from "./js-lexer";

const summary = (tokens: Token[]) => tokens.map((token) => `${token.type}:${token.value}`);

describe("tokenize", () => {
  test("tells regex literals from division", () => {
    expect(summary(tokenize("a / b / c"))).toEqual(["name:a", "punct:/", "name:b", "punct:/", "name:c"]);
    expect(summary(tokenize("x = /ab+c/g.test(s)")).slice(0, 3)).toEqual(["name:x", "punct:=", "regex:/ab+c/g"]);
    expect(summary(tokenize("return /[/]/")).slice(1)).toEqual(["regex:/[/]/"]);
    expect(summary(tokenize("(a) / 2"))).toEqual(["punct:(", "name:a", "punct:)", "punct:/", "number:2"]);
  });

  test("skips comments and decodes string values", () => {
    expect(summary(tokenize('// a\n/* b */ "x\\"y" \'z\''))).toEqual(['string:x"y', "string:z"]);
  });

  test("tokenizes expressions inside nested template literals", () => {
    const tokens = tokenize("`a${`b${inner}`}c` + `plain`");
    expect(summary(tokens)).toEqual(["name:inner", "template:", "template:", "punct:+", "template:plain"]);
    expect(tokens[2]!.hasSubstitutions).toBe(true);
  });

  test("treats JSX text as text, but tokenizes JSX expressions", () => {
    const tokens = tokenize(`const el = <div className="a'b">Don't {value} <>{"x"}</></div>; next`);
    expect(summary(tokens)).toEqual([
      "name:const",
      "name:el",
      "punct:=",
      "name:value",
      "string:x",
      "jsx:",
      "punct:;",
      "name:next",
    ]);
  });

  test("does not treat generics as JSX", () => {
    const tokens = tokenize("const f = <T,>(x: T) => x; useState<string>(''); type F = <U>(u: U) => U;");
    expect(tokens.some((token) => token.type === "jsx")).toBe(false);
  });

  test("never enables JSX for .ts files", () => {
    expect(jsxEnabledFor("a.ts")).toBe(false);
    expect(jsxEnabledFor("a.d.ts")).toBe(false);
    expect(jsxEnabledFor("a.mts")).toBe(false);
    expect(jsxEnabledFor("a.tsx")).toBe(true);
    expect(jsxEnabledFor("a.js")).toBe(true);
    expect(tokenize("const a = <string>b;", { jsx: false }).some((token) => token.type === "jsx")).toBe(false);
  });

  test("never throws on malformed input", () => {
    for (const source of ["`unterminated ${", '"open', "/unclosed", "<div><p>", "{{{", "a ? <b : c", "#!/bin/sh\nx"]) {
      expect(() => tokenize(source)).not.toThrow();
    }
  });
});

describe("analyzeBrackets", () => {
  test("pairs brackets and records depth", () => {
    const tokens = tokenize("f(a, [b], { c })");
    const { partner, depth } = analyzeBrackets(tokens);
    const open = tokens.findIndex((token) => token.value === "(");
    const close = tokens.findIndex((token) => token.value === ")");
    expect(partner[open]).toBe(close);
    expect(depth[tokens.findIndex((token) => token.value === "c")]).toBe(2);
  });
});

describe("tokenize: TypeScript operators", () => {
  test("a non-null assertion before / is division, not a regex", () => {
    const tokens = tokenize("const pct = Math.round((done! / total) * 100); // %\nexport const after = 1;", { jsx: false });
    expect(tokens.some((token) => token.type === "regex")).toBe(false);
    expect(tokens.map((token) => token.value)).toContain("after");
    expect(tokenize("if (!/x/.test(s)) {}").some((token) => token.type === "regex")).toBe(true);
  });

  test("||, && and ?? are single tokens", () => {
    expect(summary(tokenize("a || b && c ?? d")).filter((entry) => entry.startsWith("punct"))).toEqual([
      "punct:||",
      "punct:&&",
      "punct:??",
    ]);
  });

  test("multi-letter generic signatures in .tsx are not JSX", () => {
    const tokens = tokenize(
      "type P = { render: <TItem>(item: TItem) => void; map: <TKey = string>(k: TKey) => TKey };\nconst later = 1;"
    );
    expect(tokens.some((token) => token.type === "jsx")).toBe(false);
    expect(tokens.map((token) => token.value)).toContain("later");
    // A real element followed by parenthesised text is still JSX
    expect(tokenize("const el = <Label>(optional)</Label>;").some((token) => token.type === "jsx")).toBe(true);
  });
});
