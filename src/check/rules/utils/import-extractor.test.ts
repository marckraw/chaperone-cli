import { describe, expect, test } from "bun:test";
import { extractImports } from "./import-extractor";

const sources = (code: string, filePath = "file.tsx") =>
  extractImports(code, { filePath }).map((entry) => entry.source);

describe("extractImports", () => {
  test("finds default, named, namespace and combined imports", () => {
    const code = `
      import React from "react";
      import { a, b as c } from "./ab";
      import * as ns from "./ns";
      import Def, { named } from './mixed';
      import Other, * as all from "./both";
    `;
    expect(sources(code)).toEqual(["react", "./ab", "./ns", "./mixed", "./both"]);
  });

  test("handles multi-line import clauses", () => {
    const code = `import {\n  one,\n  two,\n} from "./multi";\nimport "./after";\n`;
    const entries = extractImports(code);
    expect(entries.map((entry) => [entry.source, entry.line])).toEqual([
      ["./multi", 1],
      ["./after", 5],
    ]);
  });

  test("a side-effect import does not swallow the next import", () => {
    const code = `import "server-only";\nimport { db } from "./db";\n`;
    const entries = extractImports(code);
    expect(entries.map((entry) => [entry.source, entry.kind])).toEqual([
      ["server-only", "side-effect"],
      ["./db", "import"],
    ]);
  });

  test("detects type-only imports, including inline type specifiers", () => {
    const code = `
      import type { A } from "./a";
      import { type B, type C } from "./bc";
      import { type D, E } from "./de";
      import type * as T from "./t";
      import type from "./default-named-type";
      import { type } from "./binding-named-type";
    `;
    const entries = extractImports(code);
    expect(entries.map((entry) => [entry.source, entry.isTypeImport])).toEqual([
      ["./a", true],
      ["./bc", true],
      ["./de", false],
      ["./t", true],
      ["./default-named-type", false],
      ["./binding-named-type", false],
    ]);
  });

  test("finds every kind of re-export", () => {
    const code = `
      export * from "./all";
      export * as ns from "./namespace";
      export { a, b as c } from "./named";
      export type { T } from "./types";
      export { type U } from "./inline-types";
      export type * from "./type-star";
      export const local = 1;
      export { local as renamed };
    `;
    const entries = extractImports(code);
    expect(entries.map((entry) => [entry.source, entry.kind, entry.isTypeImport])).toEqual([
      ["./all", "re-export", false],
      ["./namespace", "re-export", false],
      ["./named", "re-export", false],
      ["./types", "re-export", true],
      ["./inline-types", "re-export", true],
      ["./type-star", "re-export", true],
    ]);
  });

  test("finds dynamic imports and require calls", () => {
    const code = `
      const lazy = () => import("./lazy");
      const tpl = import(\`./template\`);
      const fs = require("node:fs");
      const nope = import(variable);
      const dyn = require(name);
      import legacy = require("./legacy");
    `;
    const entries = extractImports(code, { filePath: "file.ts" });
    expect(entries.map((entry) => [entry.source, entry.kind])).toEqual([
      ["./lazy", "dynamic"],
      ["./template", "dynamic"],
      ["node:fs", "require"],
      ["./legacy", "require"],
    ]);
  });

  test("ignores imports in comments, strings, template literals and regexes", () => {
    const code = `
      // import commented from "./line-comment";
      /* import blocked from "./block-comment"; */
      /**
       * import doc from "./doc-comment";
       */
      const s = "import str from './in-string'";
      const t = \`import tpl from "./in-template" \${"import('./in-substitution-string')"}\`;
      const r = /import x from "\\.\\/in-regex"/;
      const real = import("./real");
    `;
    expect(sources(code)).toEqual(["./real"]);
  });

  test("keeps working after JSX text with apostrophes and quotes", () => {
    const code = `
      import { Button } from "./button";
      export function Card() {
        return <p className="x">Don't "quote" me {count > 1 ? "items" : 'item'}</p>;
      }
      const Lazy = lazy(() => import("./lazy-after-jsx"));
    `;
    expect(sources(code)).toEqual(["./button", "./lazy-after-jsx"]);
  });

  test("finds dynamic imports inside JSX expressions", () => {
    const code = `const el = <Suspense fallback={<Spinner />}>{load(() => import("./in-jsx"))}</Suspense>;`;
    expect(sources(code)).toEqual(["./in-jsx"]);
  });

  test("does not treat TypeScript generics as JSX in .tsx files", () => {
    const code = `
      const identity = <T,>(value: T) => value;
      type Fn = <U>(value: U) => U;
      const ref = useRef<HTMLDivElement>(null);
      import("./after-generics");
    `;
    expect(sources(code)).toEqual(["./after-generics"]);
  });

  test("does not treat type assertions as JSX in .ts files", () => {
    const code = `const a = <string>value;\nconst b = import("./after-assertion");\n`;
    expect(sources(code, "file.ts")).toEqual(["./after-assertion"]);
  });

  test("ignores property access and object keys named import/require", () => {
    const code = `
      obj.import("./not-a-module");
      obj.require("./not-a-module-either");
      const config = { import: "./nope", require: true };
      function require(name) { return name; }
    `;
    expect(sources(code, "file.js")).toEqual([]);
  });

  test("can filter by kind", () => {
    const code = `import type { A } from "./a";\nimport("./b");\nrequire("./c");\nimport "./d";\n`;
    expect(
      extractImports(code, {
        includeTypeImports: false,
        includeDynamicImports: false,
        includeRequire: false,
      }).map((entry) => entry.source)
    ).toEqual(["./d"]);
  });

  test("reads <script> blocks of Vue and Svelte files", () => {
    const svelte = `<script lang="ts">\n  import Button from "./Button.svelte";\n</script>\n\n<p>It's "fine"</p>\n`;
    const entries = extractImports(svelte, { filePath: "src/routes/+page.svelte" });
    expect(entries.map((entry) => [entry.source, entry.line])).toEqual([["./Button.svelte", 2]]);
  });
});
