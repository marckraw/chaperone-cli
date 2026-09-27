/**
 * Config file names that signal a tool is set up in a project.
 * Shared by `chaperone init` (detection) and the check runners.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const TYPESCRIPT_CONFIG_FILES = ["tsconfig.json"] as const;

export const ESLINT_FLAT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
] as const;

export const ESLINT_LEGACY_CONFIG_FILES = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
] as const;

export const PRETTIER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json5",
  ".prettierrc.toml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.ts",
  ".prettierrc.mts",
  ".prettierrc.cts",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.mts",
  "prettier.config.cts",
] as const;

/**
 * The first of `candidates` that exists in `cwd`, or null.
 */
export function findConfigFile(cwd: string, candidates: readonly string[]): string | null {
  return candidates.find((candidate) => existsSync(join(cwd, candidate))) ?? null;
}

/**
 * Whether package.json in `cwd` has the given top-level key (e.g. "eslintConfig").
 */
export function packageJsonHasKey(cwd: string, key: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8")) as Record<string, unknown>;
    return pkg[key] !== undefined;
  } catch {
    return false;
  }
}
