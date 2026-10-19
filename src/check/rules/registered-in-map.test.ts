import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { REGISTERED_IN_MAP, REGISTERED_SCHEMAS } from "../../testing/backbase-fixtures";
import type { RegisteredInMapRule } from "../types";
import { runRegisteredInMapRule } from "./registered-in-map";
import { createRuleContext } from "./utils/rule-context";

afterEach(cleanupProjects);

function run(files: Record<string, string> = {}, options: Partial<RegisteredInMapRule> = {}) {
  const cwd = makeProject({ ...REGISTERED_SCHEMAS, ...files });
  return runRegisteredInMapRule({ ...REGISTERED_IN_MAP, ...options }, { cwd, include: [], exclude: ["node_modules"] });
}

describe("registered-in-map", () => {
  test("a clean fixture passes, including imported object spreads", async () => {
    expect((await run()).results).toEqual([]);
  });

  test("reads the real boilerplate schemas and trimmed map, including schema-only settings", async () => {
    const fixture = (file: string) => readFileSync(join(import.meta.dir, "__fixtures__/backpack-boilerplate", file), "utf8");
    const cwd = makeProject({
      "src/components/page.sb.ts": fixture("page.sb.ts.txt"),
      "src/components/settings.sb.ts": fixture("settings.sb.ts.txt"),
      "src/components/component-list.ts": fixture("component-list.ts.txt"),
      "tsconfig.json": fixture("tsconfig.json.txt"),
    });
    const result = await runRegisteredInMapRule(REGISTERED_IN_MAP, { cwd, include: [], exclude: ["node_modules"] });
    expect(result.filesChecked).toBe(2);
    expect(result.results).toEqual([]);

    // Removing the real InternalComponents spread must make settings unregistered.
    const missing = makeProject({
      "src/components/settings.sb.ts": fixture("settings.sb.ts.txt"),
      "src/components/component-list.ts": fixture("component-list.ts.txt").replace("  ...InternalComponents,", ""),
    });
    const broken = await runRegisteredInMapRule(REGISTERED_IN_MAP, { cwd: missing, include: [], exclude: [] });
    expect(broken.results).toHaveLength(1);
    expect(broken.results[0]?.context?.symbol).toBe("settings");
  });

  test("one missing schema produces one violation, with its schema name and location", async () => {
    const result = await run({ "src/card.sb.ts": 'export default {\n name: "card", schema: {}\n};' });
    expect(result.filesChecked).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ file: "src/card.sb.ts", line: 2, rule: "registered-in-map/schema-is-registered", context: { symbol: "card" } });
  });

  test("supports aliases, re-exported spreads, nested spreads, shorthand and computed literal keys", async () => {
    const result = await run({
      "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
      "src/constants.ts": 'export const key = "hero" as const;',
      "src/hero.sb.ts": 'import { key as name } from "@/constants"; const schema = { name } satisfies object; export { schema as default };',
      "src/components/local.ts": 'import { key } from "../constants"; const Hero = 1; const inner = { [key]: Hero }; export const LocalComponents = { ...inner };',
      "src/components/barrel.ts": 'export { LocalComponents as Local } from "./local";',
      "src/components/component-list.ts": 'import { Local as Components } from "./barrel"; const extras = {}; export const map = ({ ...extras, ...Components } as const);',
    });
    expect(result.results).toEqual([]);
  });

  test("reads finite map keys declared by an installed package", async () => {
    const result = await run({
      "node_modules/design-system/package.json": '{"types":"./index.d.ts"}',
      "node_modules/design-system/index.d.ts": 'export declare const Components: { hero: unknown };',
      "src/components/component-list.ts": 'import { Components } from "design-system"; export default { ...Components };',
    });
    expect(result.results).toEqual([]);
  });

  test("an open dictionary declaration cannot prove which keys are registered", async () => {
    const result = await run({
      "node_modules/design-system/package.json": '{"types":"./index.d.ts"}',
      "node_modules/design-system/index.d.ts": 'export declare const Components: { [key: string]: unknown };',
      "src/components/component-list.ts": 'import { Components } from "design-system"; export default { ...Components };',
    });
    expect(result.results[0]?.message).toContain("Cannot enumerate keys");
  });

  test("uses keys, rather than string occurrences, nested keys or component values", async () => {
    const result = await run({
      "src/components/component-list.ts": '// hero\nexport default { other: "hero", nested: { hero: 1 } };',
    });
    expect(result.results[0]?.context?.symbol).toBe("hero");
  });

  test("honors spread overrides when reading the schema name", async () => {
    const result = await run({
      "src/hero.sb.ts": 'const base = { name: "old" }; export default { ...base, name: "hero" };',
    });
    expect(result.results).toEqual([]);
  });

  test("allows selecting named map and schema exports", async () => {
    const result = await run({
      "src/hero.sb.ts": 'export const metadata = {}; export const schema = { name: "hero" };',
      "src/components/component-list.ts": 'export const unrelated = {}; export const Components = { hero: 1 };',
    }, { mapExport: "Components", schemaExport: "schema" });
    expect(result.results).toEqual([]);
  });

  test.each([
    { "src/hero.sb.ts": "export default { name: ;" },
    { "src/components/component-list.ts": "export default { hero: ;" },
    { "src/components/local.ts": "export const LocalComponents = { hero: ;" },
    { "src/hero.sb.ts": 'export default { name: getName() };' },
    { "src/hero.sb.ts": 'export default { schema: { name: "hero" } };' },
    { "src/hero.sb.ts": 'export default { name: "" };' },
    { "src/components/component-list.ts": 'export default { ...Missing };' },
    { "src/components/component-list.ts": 'import { Missing } from "./missing"; export default { ...Missing };' },
    { "src/components/component-list.ts": 'const a = { ...b }; const b = { ...a }; export default a;' },
    { "src/components/component-list.ts": 'export const a = {}; export const b = {};' },
    { "src/components/component-list.ts": 'export default getMap();' },
    { "src/components/component-list.ts": 'export default { [getKey()]: 1 };' },
  ] as Record<string, string>[])("malformed or unresolved inputs are errors even with warning severity", async (files) => {
    const result = await run(files, { severity: "warning" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ severity: "error" });
    expect(result.results[0]?.message).toContain("Cannot check registration:");
  });

  test("missing map files fail clearly with a path", async () => {
    const result = await run({}, { mapFile: "src/missing.ts" });
    expect(result.results[0]).toMatchObject({ file: "src/missing.ts", severity: "error" });
    expect(result.results[0]?.message).toContain("Cannot read TypeScript file");
  });

  test("respects schema excludes and custom message/severity", async () => {
    const result = await run({ "src/card.sb.ts": 'export default { name: "card" };' }, {
      exclude: ["**/hero.sb.ts"], severity: "warning", message: "Register the schema",
    });
    expect(result.filesChecked).toBe(1);
    expect(result.results[0]).toMatchObject({ severity: "warning", message: 'Register the schema (schema "card" is not registered in src/components/component-list.ts)' });
  });

  test("--since still catches map/spread changes affecting unchanged schemas", async () => {
    const cwd = makeProject({ ...REGISTERED_SCHEMAS, "src/components/local.ts": "export const LocalComponents = {};" });
    const context = createRuleContext(cwd, [], { changedFiles: new Set(["src/components/local.ts"]) });
    const result = await runRegisteredInMapRule(REGISTERED_IN_MAP, { cwd, include: [], exclude: [], context });
    expect(result.results[0]?.context?.symbol).toBe("hero");
  });
});
