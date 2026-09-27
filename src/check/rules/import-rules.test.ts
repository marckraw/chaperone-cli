import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import type { ForbiddenImportRule, ImportBoundaryRule, PublicApiRule } from "../types";
import { runForbiddenImportRule } from "./forbidden-import";
import { runImportBoundaryRule } from "./import-boundary";
import { runPublicApiRule } from "./public-api";

afterEach(cleanupProjects);

const OPTIONS = { include: [], exclude: [] };

const TSCONFIG = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } });

const LAYERS: ImportBoundaryRule = {
  type: "import-boundary",
  id: "layers",
  severity: "error",
  layers: {
    shared: { files: "src/shared/**/*.{ts,tsx}", allowImportsFrom: [] },
    features: { files: "src/features/**/*.{ts,tsx}", allowImportsFrom: ["shared"] },
  },
};

describe("import-boundary", () => {
  test("flags relative, aliased, directory and .js imports across layers", async () => {
    const cwd = makeProject({
      "tsconfig.json": TSCONFIG,
      "src/features/auth/index.ts": "export const login = 1;\n",
      "src/features/auth/model.ts": "export const model = 1;\n",
      "src/shared/a.ts": 'import { login } from "../features/auth";\n',
      "src/shared/b.ts": 'import { login } from "@/features/auth";\n',
      "src/shared/c.ts": 'import { model } from "../features/auth/model.js";\n',
      "src/shared/d.ts": 'export { model } from "@/features/auth/model";\n',
      "src/features/auth/ok.ts": 'import { a } from "@/shared/a";\nimport { b } from "../../shared/b";\n',
    });

    const result = await runImportBoundaryRule(LAYERS, { cwd, ...OPTIONS });

    expect(result.results.map((entry) => [entry.file, entry.context?.matchedText])).toEqual([
      ["src/shared/a.ts", "../features/auth"],
      ["src/shared/b.ts", "@/features/auth"],
      ["src/shared/c.ts", "../features/auth/model.js"],
      ["src/shared/d.ts", "@/features/auth/model"],
    ]);
    expect(result.results[1]!.context?.actualValue).toBe('Imports src/features/auth/index.ts (layer "features")');
  });

  test("ignores commented-out imports and imports inside strings", async () => {
    const cwd = makeProject({
      "src/features/x.ts": "export const x = 1;\n",
      "src/shared/a.ts": '// import { x } from "../features/x";\nconst s = "import { x } from \'../features/x\'";\n',
    });
    expect((await runImportBoundaryRule(LAYERS, { cwd, ...OPTIONS })).results).toEqual([]);
  });

  test("honours includeTypeImports and includeDynamicImports", async () => {
    const cwd = makeProject({
      "src/features/x.ts": "export type X = 1;\n",
      "src/shared/a.ts": 'import type { X } from "../features/x";\nimport { type X as Y } from "../features/x";\n',
      "src/shared/b.ts": 'const lazy = () => import("../features/x");\n',
    });

    const withAll = await runImportBoundaryRule(LAYERS, { cwd, ...OPTIONS });
    expect(withAll.results).toHaveLength(3);

    const withoutTypesOrDynamic = await runImportBoundaryRule(
      { ...LAYERS, includeTypeImports: false, includeDynamicImports: false },
      { cwd, ...OPTIONS }
    );
    expect(withoutTypesOrDynamic.results).toEqual([]);
  });

  test("notes layers whose globs match no files", async () => {
    const cwd = makeProject({ "src/shared/a.ts": "" });
    const result = await runImportBoundaryRule(LAYERS, { cwd, ...OPTIONS });
    expect(result.notices).toEqual(["layers with no matching files: features (src/features/**/*.{ts,tsx})"]);
  });
});

const PUBLIC_API: PublicApiRule = {
  type: "public-api",
  id: "barrels",
  severity: "error",
  modules: "src/features/*",
  files: "src/**/*.{ts,tsx}",
};

describe("public-api", () => {
  test("allows imports through the barrel (directory import) and flags deep imports", async () => {
    const cwd = makeProject({
      "tsconfig.json": TSCONFIG,
      "src/features/auth/index.ts": 'export { login } from "./model/login";\n',
      "src/features/auth/model/login.ts": "export const login = 1;\n",
      "src/app/good.ts": 'import { login } from "../features/auth";\nimport { login as l } from "@/features/auth";\n',
      "src/app/explicit.ts": 'import { login } from "../features/auth/index";\n',
      "src/app/deep.ts": 'import { login } from "../features/auth/model/login";\n',
      "src/app/deep-alias.ts": 'import { login } from "@/features/auth/model/login";\n',
    });

    const result = await runPublicApiRule(PUBLIC_API, { cwd, ...OPTIONS });

    expect(result.results.map((entry) => [entry.file, entry.context?.matchedText])).toEqual([
      ["src/app/deep-alias.ts", "@/features/auth/model/login"],
      ["src/app/deep.ts", "../features/auth/model/login"],
    ]);
  });

  test("allows deep imports inside the same module unless disabled", async () => {
    const cwd = makeProject({
      "src/features/auth/index.ts": 'export * from "./model/login";\n',
      "src/features/auth/model/login.ts": 'import { helper } from "../lib/helper";\n',
      "src/features/auth/lib/helper.ts": "export const helper = 1;\n",
    });

    expect((await runPublicApiRule(PUBLIC_API, { cwd, ...OPTIONS })).results).toEqual([]);
    expect(
      (await runPublicApiRule({ ...PUBLIC_API, allowSameModule: false }, { cwd, ...OPTIONS })).results
    ).toHaveLength(2);
  });

  test("accepts a barrel with another extension and honours a custom barrelFile", async () => {
    const cwd = makeProject({
      "src/features/ui/index.tsx": "export const Button = 1;\n",
      "src/features/api/public.ts": "export const api = 1;\n",
      "src/features/api/index.ts": "export const internal = 1;\n",
      "src/app/a.ts": 'import { Button } from "../features/ui";\nimport { api } from "../features/api/public";\n',
    });

    expect((await runPublicApiRule(PUBLIC_API, { cwd, ...OPTIONS })).results).toHaveLength(1);
    expect(
      (await runPublicApiRule({ ...PUBLIC_API, barrelFile: "public.ts" }, { cwd, ...OPTIONS })).results.map(
        (entry) => entry.context?.matchedText
      )
    ).toEqual(["../features/ui"]);
  });
});

const FORBIDDEN: ForbiddenImportRule = {
  type: "forbidden-import",
  id: "tauri",
  severity: "error",
  files: "src/**/*.{ts,tsx}",
  restrictions: [{ source: "^@tauri-apps/", allowedIn: ["src/**/*.{api,bridge}.ts"] }],
};

describe("forbidden-import", () => {
  test("flags restricted imports outside allowedIn (braces supported)", async () => {
    const cwd = makeProject({
      "src/a.api.ts": 'import { invoke } from "@tauri-apps/api";\n',
      "src/b.bridge.ts": 'import { invoke } from "@tauri-apps/api";\n',
      "src/c.ts": 'import "server-only";\nimport { invoke } from "@tauri-apps/api";\n',
      "src/d.ts": 'export * from "@tauri-apps/api/core";\n',
      "src/e.ts": 'const x = require("@tauri-apps/api");\n',
    });

    const result = await runForbiddenImportRule(FORBIDDEN, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => [entry.file, entry.line])).toEqual([
      ["src/c.ts", 2],
      ["src/d.ts", 1],
      ["src/e.ts", 1],
    ]);
  });

  test("ignores type-only imports unless includeTypeImports is set", async () => {
    const cwd = makeProject({
      "src/a.ts": 'import type { Event } from "@tauri-apps/api";\nimport { type Window } from "@tauri-apps/api/window";\n',
    });

    expect((await runForbiddenImportRule(FORBIDDEN, { cwd, ...OPTIONS })).results).toEqual([]);
    expect(
      (await runForbiddenImportRule({ ...FORBIDDEN, includeTypeImports: true }, { cwd, ...OPTIONS })).results
    ).toHaveLength(2);
  });

  test("checkPatterns flag code usage outside allowedIn", async () => {
    const cwd = makeProject({
      "src/a.api.ts": "invoke('x');\n",
      "src/b.ts": "const r = invoke('x');\n",
    });
    const result = await runForbiddenImportRule(
      {
        ...FORBIDDEN,
        restrictions: [],
        checkPatterns: [{ pattern: "\\binvoke\\(", allowedIn: ["src/**/*.api.ts"] }],
      },
      { cwd, ...OPTIONS }
    );
    expect(result.results.map((entry) => [entry.file, entry.line])).toEqual([["src/b.ts", 1]]);
  });
});

describe("import-boundary layer overlap", () => {
  test("notes a layer whose files all belong to a later layer", async () => {
    const cwd = makeProject({ "src/check/rules/types.ts": "", "src/check/rules/regex.ts": "" });
    const result = await runImportBoundaryRule(
      {
        type: "import-boundary",
        id: "overlap",
        severity: "error",
        layers: {
          "rule-types": { files: "src/check/rules/types.ts", allowImportsFrom: [] },
          rules: { files: "src/check/rules/*.ts", allowImportsFrom: [] },
        },
      },
      { cwd, include: [], exclude: [] }
    );
    expect(result.notices).toEqual([
      "layers whose files all match a later layer (the layer listed last wins): rule-types",
    ]);
  });
});
