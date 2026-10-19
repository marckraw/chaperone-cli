import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { FAKE_BACKPACK, RESERVED_NAMES } from "../../testing/backbase-fixtures";
import { createRuleContext } from "./utils/rule-context";
import { runReservedNamesRule } from "./reserved-names";
import type { ReservedNamesRule } from "../types";

afterEach(cleanupProjects);

function run(files: Record<string, string>, options: Partial<ReservedNamesRule> = {}) {
  const cwd = makeProject({ ...FAKE_BACKPACK, ...files });
  return runReservedNamesRule({ ...RESERVED_NAMES, ...options }, { cwd, include: [], exclude: ["node_modules"] });
}

describe("reserved-names", () => {
  test("one violation in a fixture project, deduplicated across file/folder/export", async () => {
    const result = await run({
      "src/components/Button/Button.tsx": "export const Button = () => <button />;",
      "src/components/CustomHero.tsx": "export const CustomHero = () => <section />;",
    });
    expect(result.filesChecked).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ file: "src/components/Button/Button.tsx", severity: "error", context: { symbol: "Button" } });
  });

  test("a clean fixture project passes", async () => {
    expect((await run({ "src/components/CustomButton.tsx": "export const CustomButton = () => <button />;" })).results).toEqual([]);
  });

  test("reads root declarations and barrel aliases when exports has no named subpaths", async () => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": '{"exports":{".":{"types":"./index.d.ts"}}}',
      "node_modules/@ef-global/backpack/index.d.ts": 'export { Card as Panel } from "./Card";',
      "src/components/Other.ts": "export const Panel = 1; export const Card = 2;",
    }, { compare: ["exported-identifier"] });
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["Panel"]);
  });

  test("falls back to types/typings declarations without an exports map", async () => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": '{"typings":"./index.d.ts"}',
      "src/components/Card.ts": "export {};",
    });
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["Card"]);
  });

  test("takes explicit subpath names directly from the exports map", async () => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": '{"exports":{"./Button":"./dist/Button.js"}}',
      "node_modules/@ef-global/backpack/index.d.ts": "",
      "src/components/Button.ts": "",
    }, { compare: ["file-name"] });
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["Button"]);
  });

  test("expands wildcard exports against installed files", async () => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": '{"exports":{"./*":{"types":"./dist/*.d.ts"}}}',
      "node_modules/@ef-global/backpack/index.d.ts": "",
      "node_modules/@ef-global/backpack/dist/Button.d.ts": "export default function Button(): void;",
      "src/components/Button.ts": "",
    });
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["Button"]);
  });

  test("ignores metadata, asset subpaths and lowercase modules that export no matching identifier", async () => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": JSON.stringify({ exports: {
        ".": { types: "./index.d.ts" },
        "./package.json": "./package.json",
        "./styles": "./styles.css",
        "./Logo.svg": "./Logo.svg",
        "./utils": { types: "./utils.d.ts" },
      } }),
      "node_modules/@ef-global/backpack/utils.d.ts": "export declare function cn(): string;",
      "src/components/utils/Custom.ts": "",
      "src/components/package/Custom.ts": "",
      "src/components/styles/Custom.ts": "",
      "src/components/Logo/Custom.ts": "",
    });
    expect(result.filesChecked).toBe(4);
    expect(result.results).toEqual([]);
  });

  test("reserves actual lowercase identifiers and PascalCase component subpaths", async () => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": JSON.stringify({ exports: {
        "./utils": { types: "./utils.d.ts" },
        "./Button": { types: "./Button.d.ts" },
      } }),
      "node_modules/@ef-global/backpack/index.d.ts": "",
      "node_modules/@ef-global/backpack/utils.d.ts": "export declare function utils(): void;",
      "node_modules/@ef-global/backpack/Button.d.ts": "export default function(): void;",
      "src/components/utils/Custom.ts": "",
      "src/components/Button/Custom.ts": "",
    });
    expect(result.results.map((entry) => entry.context?.symbol).sort()).toEqual(["Button", "utils"]);
  });

  test("defaults to value exports, with an opt-in for types and explicit type-only re-exports", async () => {
    const files = {
      "node_modules/@ef-global/backpack/package.json": '{"exports":{".":{"types":"./index.d.ts"},"./ButtonProps":{"types":"./props.d.ts"}}}',
      "node_modules/@ef-global/backpack/index.d.ts": 'export { Button, cn } from "./values"; export { TypeOnlyButton } from "./barrel"; export type * from "./types";',
      "node_modules/@ef-global/backpack/barrel.d.ts": 'export type { Button as TypeOnlyButton } from "./values";',
      "node_modules/@ef-global/backpack/values.d.ts": 'export declare const Button: unknown; export declare function cn(): string;',
      "node_modules/@ef-global/backpack/types.d.ts": 'export interface ButtonProps {} export declare const TypeOnlyStar: unknown;',
      "node_modules/@ef-global/backpack/props.d.ts": 'export interface ButtonProps {}',
      "src/components/Other.ts": "export const ButtonProps = 1, Button = 1, cn = 1, TypeOnlyButton = 1, TypeOnlyStar = 1;",
    };
    const values = await run(files);
    expect(values.results.map((entry) => entry.context?.symbol).sort()).toEqual(["Button", "cn"]);
    const all = await run(files, { includeTypes: true });
    expect(all.results.map((entry) => entry.context?.symbol).sort()).toEqual(["Button", "ButtonProps", "TypeOnlyButton", "TypeOnlyStar", "cn"]);
  });

  test("ignores local type-only exports by default too", async () => {
    const files = { "src/components/Other.ts": "export interface Button {} export type Card = string;" };
    expect((await run(files)).results).toEqual([]);
    expect((await run(files, { includeTypes: true })).results.map((entry) => entry.context?.symbol)).toEqual(["Button", "Card"]);
  });

  test.each([
    'export * from "@missing/peer/components";',
    'export { MissingButton } from "@missing/peer/components";',
  ])("warns about a missing peer and continues checking available exports", async (missing) => {
    const result = await run({
      "node_modules/@ef-global/backpack/index.d.ts": 'export * from "./public";',
      "node_modules/@ef-global/backpack/public.d.ts": `${missing} export { Card } from "./Card";`,
      "src/components/MissingButton.ts": "",
      "src/components/Card.ts": "",
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ severity: "warning", line: 1 });
    expect(result.results[0]?.message).toContain('missing peer "@missing/peer"');
    expect(result.results[1]).toMatchObject({ severity: "error", context: { symbol: "Card" } });
  });

  test.each([
    'export * from "@missing/peer";',
    'export { Card } from "@missing/peer";',
  ])("all names behind missing peers are a rule error, even with warning severity", async (missing) => {
    const result = await run({
      "node_modules/@ef-global/backpack/package.json": '{"exports":{".":{"types":"./index.d.ts"}}}',
      "node_modules/@ef-global/backpack/index.d.ts": missing,
      "src/components/Card.tsx": "export const Card = () => <article />;",
    }, { severity: "warning" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ severity: "error", ruleError: true });
    expect(result.results[0]?.message).toContain("No exported names could be read");
    expect(result.results[0]?.message).toContain("@missing/peer");
  });

  test("file, folder and exported identifiers can be selected independently", async () => {
    const files = { "src/components/Button/Other.ts": "\nexport const Card = 1;" };
    expect((await run(files, { compare: ["file-name"] })).results).toEqual([]);
    expect((await run(files, { compare: ["folder-name"] })).results[0]?.context?.symbol).toBe("Button");
    expect((await run(files, { compare: ["exported-identifier"] })).results[0]?.context?.symbol).toBe("Card");
  });

  test("also catches non-exported component declarations in differently named files", async () => {
    const result = await run({ "src/components/Custom.tsx": "const Button = () => <button />; export default Button;" });
    expect(result.results[0]).toMatchObject({ line: 1, context: { symbol: "Button" } });
  });

  test.each([
    "export default function Button() { return null; }",
    "const Button = () => null; export default Button;",
    "export default class Button {}",
  ])("checks named default exports even when they render nothing", async (source) => {
    const result = await run({ "src/components/Custom.tsx": source }, { compare: ["exported-identifier"] });
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["Button"]);
  });

  test("case sensitivity defaults to true; allow uses the same comparison", async () => {
    const files = { "src/components/button.ts": "" };
    expect((await run(files)).results).toEqual([]);
    expect((await run(files, { caseSensitive: false })).results).toHaveLength(1);
    expect((await run(files, { caseSensitive: false, allow: ["BUTTON"] })).results).toEqual([]);
    expect((await run({ "src/components/Button.ts": "" }, { allow: ["button"] })).results).toHaveLength(1);
  });

  test("respects excludes, warning severity and custom messages", async () => {
    const files = { "src/components/Button.ts": "", "src/components/Card.ts": "" };
    const result = await run(files, { exclude: ["**/Button.ts"], severity: "warning", message: "Choose a custom name" });
    expect(result.filesChecked).toBe(1);
    expect(result.results[0]).toMatchObject({ severity: "warning", message: 'Choose a custom name (file name "Card" is reserved by @ef-global/backpack)' });
  });

  test("uses the full package names but reports only changed local files under --since", async () => {
    const cwd = makeProject({ ...FAKE_BACKPACK, "src/components/Button.ts": "", "src/components/Card.ts": "" });
    const context = createRuleContext(cwd, ["node_modules"], { changedFiles: new Set(["src/components/Card.ts"]) });
    const result = await runReservedNamesRule(RESERVED_NAMES, { cwd, include: [], exclude: [], context });
    expect(result.filesChecked).toBe(2);
    expect(result.results.map((entry) => entry.context?.symbol)).toEqual(["Card"]);
  });

  test.each([
    { "node_modules/@ef-global/backpack/package.json": "{" },
    { "node_modules/@ef-global/backpack/index.d.ts": "export const Button: =;" },
    { "node_modules/@ef-global/backpack/index.d.ts": 'export * from "./missing";' },
    { "src/components/Other.ts": "export const =;" },
  ] as Record<string, string>[])("fails clearly on malformed package or source files", async (broken) => {
    const result = await run({ "src/components/Button.ts": "", ...broken });
    expect(result.results.some((entry) => entry.severity === "error" && entry.message.startsWith("Cannot check reserved names:"))).toBe(true);
  });

  test("a missing package and a package with no readable names are errors", async () => {
    const cwd = makeProject({ "src/components/Button.ts": "" });
    const missing = await runReservedNamesRule(RESERVED_NAMES, { cwd, include: [], exclude: [] });
    expect(missing.results[0]?.message).toContain("was not found");
    const empty = await run({ "node_modules/@ef-global/backpack/package.json": "{}", "node_modules/@ef-global/backpack/index.d.ts": "" });
    expect(empty.results[0]?.message).toContain("No exported names");
  });
});
