import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import type {
  CommandRule,
  ComponentLocationRule,
  FileContractRule,
  FilePairingRule,
  PackageFieldsRule,
  RetiredPathRule,
  SymbolReferenceRule,
} from "../types";
import { runCommandRule } from "./command";
import { matchesLocationPattern, runComponentLocationRule } from "./component-location";
import { runFileContractRule } from "./file-contract";
import { runFilePairingRule } from "./file-pairing";
import { runPackageFieldsRule } from "./package-fields";
import { runRetiredPathRule } from "./retired-path";
import { runSymbolReferenceRule } from "./symbol-reference";
import { extractNamedExports } from "./directive-export-pattern";
import { findExportedFunctions } from "./utils/exported-functions";

afterEach(cleanupProjects);

const OPTIONS = { include: [], exclude: [] };

describe("file-pairing", () => {
  const RULE: FilePairingRule = {
    type: "file-pairing",
    id: "tests",
    severity: "error",
    files: "src/**/*.pure.ts",
    pair: { from: "\\.pure\\.ts$", to: ".pure.test.ts" },
  };

  test("requires the companion file", async () => {
    const cwd = makeProject({
      "src/a.pure.ts": "",
      "src/a.pure.test.ts": "",
      "src/b.pure.ts": "",
    });
    const result = await runFilePairingRule(RULE, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => [entry.file, entry.context?.expectedValue])).toEqual([
      ["src/b.pure.ts", "src/b.pure.test.ts"],
    ]);
    expect(result.filesChecked).toBe(2);
  });

  test("mustExist: false forbids the companion", async () => {
    const cwd = makeProject({ "src/a.pure.ts": "", "src/a.pure.test.ts": "" });
    const result = await runFilePairingRule({ ...RULE, mustExist: false }, { cwd, ...OPTIONS });
    expect(result.results).toHaveLength(1);
  });

  test("reports files the pair.from regex cannot transform", async () => {
    const cwd = makeProject({ "src/a.pure.ts": "" });
    const result = await runFilePairingRule(
      { ...RULE, pair: { from: "\\.nope$", to: ".x" } },
      { cwd, ...OPTIONS }
    );
    expect(result.results[0]!.message).toContain("Could not transform");
  });
});

describe("file-contract", () => {
  const RULE: FileContractRule = {
    type: "file-contract",
    id: "contract",
    severity: "error",
    files: "src/**/*.ts",
  };

  test("maxLines counts lines, not line breaks", async () => {
    const cwd = makeProject({ "src/three.ts": "a\nb\nc\n", "src/four.ts": "a\nb\nc\nd\n" });
    const result = await runFileContractRule({ ...RULE, assertions: { maxLines: 3 } }, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => [entry.file, entry.message])).toEqual([
      ["src/four.ts", "File exceeds maximum of 3 lines (has 4)"],
    ]);
  });

  test("minLines uses the same count", async () => {
    const cwd = makeProject({ "src/two.ts": "a\nb\n" });
    const result = await runFileContractRule({ ...RULE, assertions: { minLines: 2 } }, { cwd, ...OPTIONS });
    expect(result.results).toEqual([]);
  });

  test("mustImport/mustNotImport see every kind of import and ignore comments", async () => {
    const cwd = makeProject({
      "src/a.ts": 'import "server-only";\n// import { x } from "react-dom";\nexport * from "@tauri-apps/api/core";\n',
    });
    const result = await runFileContractRule(
      {
        ...RULE,
        assertions: { mustImport: ["server-only"], mustNotImport: ["react-dom", "@tauri-apps/*"] },
      },
      { cwd, ...OPTIONS }
    );
    expect(result.results.map((entry) => entry.context?.matchedText)).toEqual(["@tauri-apps/api/core"]);
  });

  test("required, requiredAny, forbidden and templated patterns", async () => {
    const cwd = makeProject({
      "src/user.validation.ts": 'export default defineValidation({ id: "user" });\n',
      "src/order.validation.ts": 'export default defineValidation({ id: "wrong" }); // TODO\n',
    });
    const result = await runFileContractRule(
      {
        ...RULE,
        files: "src/*.validation.ts",
        requiredPatterns: ["export\\s+default"],
        requiredAnyPatterns: ["defineValidation\\(", "defineRules\\("],
        forbiddenPatterns: ["TODO"],
        captureFromPath: { pattern: "([^/]+)\\.validation\\.ts$", group: 1 },
        templatedRequiredPatterns: ['id:\\s*"{{capture}}"'],
      },
      { cwd, ...OPTIONS }
    );
    expect(result.results.map((entry) => [entry.file, entry.message])).toEqual([
      ["src/order.validation.ts", 'Missing required pattern: /id:\\s*"order"/'],
      ["src/order.validation.ts", "Forbidden pattern found: /TODO/"],
    ]);
  });
});

describe("package-fields", () => {
  const RULE: PackageFieldsRule = {
    type: "package-fields",
    id: "pkg",
    severity: "error",
    requiredFields: ["name", "scripts.build"],
    forbiddenFields: ["private"],
    fieldPatterns: { "scripts.build": "^bun " },
  };

  test("checks required, forbidden and patterned fields", async () => {
    const cwd = makeProject({
      "package.json": JSON.stringify({ name: "x", private: true, scripts: { build: "npm run x" } }),
    });
    const result = await runPackageFieldsRule(RULE, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => entry.message)).toEqual([
      'Forbidden field found: "private"',
      'Field "scripts.build" does not match required pattern: ^bun ',
    ]);
  });

  test("reports a missing package.json", async () => {
    const result = await runPackageFieldsRule(RULE, { cwd: makeProject(), ...OPTIONS });
    expect(result.results[0]!.message).toBe("package.json not found");
  });
});

describe("component-location", () => {
  test("a location ending in ** matches files at any depth below it", () => {
    expect(matchesLocationPattern("src/components/ui/Button.tsx", "src/components/ui/**")).toBe(true);
    expect(matchesLocationPattern("src/components/ui/forms/Input.tsx", "src/components/ui/**")).toBe(true);
    expect(matchesLocationPattern("src/components/uikit/Input.tsx", "src/components/ui/**")).toBe(false);
  });

  test("a plain directory matches files inside it, not sibling prefixes", () => {
    expect(matchesLocationPattern("src/components/ui/Button.tsx", "src/components/ui")).toBe(true);
    expect(matchesLocationPattern("src/components/ui/Button.tsx", "src/components/ui/")).toBe(true);
    expect(matchesLocationPattern("src/components/ui-kit/Button.tsx", "src/components/ui")).toBe(false);
  });

  test("globs match a parent directory", () => {
    expect(matchesLocationPattern("src/features/auth/ui/Form.tsx", "src/features/*/ui")).toBe(true);
    expect(matchesLocationPattern("src/features/auth/model/x.tsx", "src/features/*/ui")).toBe(false);
  });

  test("flags presentational components outside the required location", async () => {
    const RULE: ComponentLocationRule = {
      type: "component-location",
      id: "ui",
      severity: "error",
      files: "src/**/*.tsx",
      componentType: "presentational",
      requiredLocation: "src/components/ui/**",
      mustBeIn: true,
    };
    const cwd = makeProject({
      "src/components/ui/deep/Button.tsx": "export const Button = () => <button />;\n",
      "src/features/Badge.tsx": "export const Badge = () => <span />;\n",
      "src/features/Stateful.tsx": "export const S = () => { const [a] = useState(0); return <i>{a}</i>; };\n",
    });
    const result = await runComponentLocationRule(RULE, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => entry.file)).toEqual(["src/features/Badge.tsx"]);
  });
});

describe("command", () => {
  const RULE: CommandRule = {
    type: "command",
    id: "cmd",
    severity: "error",
    command: process.execPath,
    args: ["-e", "process.exit(3)"],
  };

  test("reports an unexpected exit code with the output", async () => {
    const result = await runCommandRule(RULE, { cwd: makeProject(), ...OPTIONS });
    expect(result.results[0]!.context?.exitCode).toBe(3);
  });

  test("passes on the expected exit code and checks stdout", async () => {
    const result = await runCommandRule(
      { ...RULE, args: ["-e", "console.log('ok')"], stdoutPattern: "^ok" },
      { cwd: makeProject(), ...OPTIONS }
    );
    expect(result.results).toEqual([]);
  });

  test("explains why a command could not run", async () => {
    const result = await runCommandRule(
      { ...RULE, command: "definitely-not-a-real-command-xyz", message: "custom" },
      { cwd: makeProject(), ...OPTIONS }
    );
    expect(result.results[0]!.message).toContain("Failed to execute command");
  });
});

describe("symbol-reference", () => {
  test("finds exported functions in every common form", () => {
    const names = findExportedFunctions(
      [
        "export function plain(a: number) { return a; }",
        "export async function* stream<T>(items: T[]) {}",
        "export const typed: Fn = (x) => x;",
        "export const generic = <T,>(x: T) => x;",
        "export const nested = (x = g(1)) => x;",
        "export const single = async x => x;",
        "export const expression = function () {};",
        "export const withReturn = (a: Map<string, number>): Promise<{ a: 1 }> => fetchIt(a);",
        "export const value = compute(1);",
        "export default function ignored() {}",
        "// export function commented() {}",
      ].join("\n"),
      "module.ts"
    ).map((symbol) => [symbol.name, symbol.kind]);

    expect(names).toEqual([
      ["plain", "function-declaration"],
      ["stream", "function-declaration"],
      ["typed", "function-variable"],
      ["generic", "function-variable"],
      ["nested", "function-variable"],
      ["single", "function-variable"],
      ["expression", "function-variable"],
      ["withReturn", "function-variable"],
    ]);
  });

  test("requires exported functions to be referenced in the paired test", async () => {
    const RULE: SymbolReferenceRule = {
      type: "symbol-reference",
      id: "tested",
      severity: "error",
      sourceFiles: "src/**/*.pure.ts",
      targetFiles: "src/**/*.pure.test.ts",
      targetPair: { from: "\\.pure\\.ts$", to: ".pure.test.ts" },
    };
    const cwd = makeProject({
      "src/math.pure.ts": "export const add: Adder = (a, b) => a + b;\nexport const sub = <T,>(a: T) => a;\n",
      "src/math.pure.test.ts": 'import { add } from "./math.pure";\ntest("add", () => add(1, 2));\n',
    });
    const result = await runSymbolReferenceRule(RULE, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["sub"]);
  });
});

describe("retired-path", () => {
  test("flags files in retired locations", async () => {
    const RULE: RetiredPathRule = {
      type: "retired-path",
      id: "retired",
      severity: "error",
      paths: [{ pattern: "src/{components,hooks}/**", reason: "old", migratedTo: "src/shared/" }],
    };
    const cwd = makeProject({ "src/components/a.tsx": "", "src/hooks/b.ts": "", "src/shared/c.ts": "" });
    const result = await runRetiredPathRule(RULE, { cwd, ...OPTIONS });
    expect(result.results.map((entry) => entry.file)).toEqual(["src/components/a.tsx", "src/hooks/b.ts"]);
    expect(result.results[0]!.message).toContain("Migrate to: src/shared/");
  });
});

describe("directive-export-pattern exports", () => {
  test("lists runtime named exports and skips types, defaults and comments", () => {
    const names = extractNamedExports(
      [
        '"use client";',
        "export function Button() {}",
        "export const buttonVariants = {};",
        "export enum Size { S }",
        "export type Props = {};",
        "export interface Other {}",
        "export default function Page() {}",
        "// export const commented = 1;",
        "const a = 1; const b = 2;",
        "export { a as useA, b, type Props as P };",
        'export * as helpers from "./helpers";',
      ].join("\n"),
      "button.tsx"
    ).map((entry) => entry.name);

    expect(names).toEqual(["Button", "buttonVariants", "Size", "useA", "b", "helpers"]);
  });
});
