import type { RegisteredInMapRule, ReservedNamesRule } from "../check/types";

export const RESERVED_NAMES: ReservedNamesRule = {
  type: "reserved-names",
  id: "no-backpack-shadowing",
  severity: "error",
  package: "@ef-global/backpack",
  files: "src/components/**/*.{ts,tsx}",
};

export const REGISTERED_IN_MAP: RegisteredInMapRule = {
  type: "registered-in-map",
  id: "schema-is-registered",
  severity: "error",
  files: "src/**/*.sb.ts",
  mapFile: "src/components/component-list.ts",
};

export const FAKE_BACKPACK = {
  "node_modules/@ef-global/backpack/package.json": JSON.stringify({
    name: "@ef-global/backpack",
    exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./Button": "./Button.js" },
  }),
  "node_modules/@ef-global/backpack/index.d.ts": 'export { Card } from "./Card"; export declare const Button: unknown;',
  "node_modules/@ef-global/backpack/Card.d.ts": 'export declare const Card: unknown;',
  // The rule must read declarations without ever executing the package.
  "node_modules/@ef-global/backpack/index.js": 'throw new Error("Package code must not execute");',
};

export const REGISTERED_SCHEMAS = {
  "src/hero.sb.ts": 'export default { name: "hero", schema: { title: { type: "text" } } } as const;',
  "src/components/local.ts": 'const Hero = () => null; export const LocalComponents = { hero: Hero };',
  "src/components/component-list.ts": 'import { LocalComponents } from "./local"; export default { ...LocalComponents };',
};
