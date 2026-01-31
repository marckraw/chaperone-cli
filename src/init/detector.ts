/**
 * Tool detection logic for Chaperone init
 */

import { fileExists, readJsonFile, findFirstExisting, joinPath } from "../utils/fs";
import type {
  DetectionResult,
  TypeScriptDetection,
  TypeScriptSettings,
  ESLintDetection,
  ESLintConfigFormat,
  PrettierDetection,
  PackageManagerDetection,
  PackageManagerName,
} from "./types";

// TypeScript config patterns
const TYPESCRIPT_CONFIGS = ["tsconfig.json"];

// ESLint config patterns
const ESLINT_LEGACY_CONFIGS = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];

const ESLINT_FLAT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
];

// Prettier config patterns
const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
];

// Package manager lockfiles (in priority order)
const PACKAGE_MANAGER_LOCKFILES: Array<{ lockfile: string; name: PackageManagerName }> = [
  { lockfile: "bun.lockb", name: "bun" },
  { lockfile: "bun.lock", name: "bun" },
  { lockfile: "pnpm-lock.yaml", name: "pnpm" },
  { lockfile: "yarn.lock", name: "yarn" },
  { lockfile: "package-lock.json", name: "npm" },
];

interface TSConfig {
  compilerOptions?: {
    strict?: boolean;
    target?: string;
  };
}

interface PackageJson {
  eslintConfig?: Record<string, unknown>;
  prettier?: Record<string, unknown>;
}

/**
 * Detect TypeScript configuration
 */
export function detectTypeScript(cwd: string): TypeScriptDetection {
  const configPath = findFirstExisting(cwd, TYPESCRIPT_CONFIGS);

  if (!configPath) {
    return { detected: false };
  }

  const fullPath = joinPath(cwd, configPath);
  const tsconfig = readJsonFile<TSConfig>(fullPath);

  const settings: TypeScriptSettings = {};

  if (tsconfig?.compilerOptions) {
    if (typeof tsconfig.compilerOptions.strict === "boolean") {
      settings.strict = tsconfig.compilerOptions.strict;
    }
    if (tsconfig.compilerOptions.target) {
      settings.target = tsconfig.compilerOptions.target;
    }
  }

  return {
    detected: true,
    configPath,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
  };
}

/**
 * Detect ESLint configuration
 */
export function detectESLint(cwd: string): ESLintDetection {
  // Check flat config first (v9+)
  const flatConfig = findFirstExisting(cwd, ESLINT_FLAT_CONFIGS);
  if (flatConfig) {
    return {
      detected: true,
      configPath: flatConfig,
      configFormat: "flat" as ESLintConfigFormat,
    };
  }

  // Check legacy config
  const legacyConfig = findFirstExisting(cwd, ESLINT_LEGACY_CONFIGS);
  if (legacyConfig) {
    return {
      detected: true,
      configPath: legacyConfig,
      configFormat: "legacy" as ESLintConfigFormat,
    };
  }

  // Check package.json eslintConfig key
  const packageJsonPath = joinPath(cwd, "package.json");
  if (fileExists(packageJsonPath)) {
    const packageJson = readJsonFile<PackageJson>(packageJsonPath);
    if (packageJson?.eslintConfig) {
      return {
        detected: true,
        configPath: "package.json",
        configFormat: "legacy" as ESLintConfigFormat,
      };
    }
  }

  return { detected: false };
}

/**
 * Detect Prettier configuration
 */
export function detectPrettier(cwd: string): PrettierDetection {
  const configPath = findFirstExisting(cwd, PRETTIER_CONFIGS);

  if (configPath) {
    return {
      detected: true,
      configPath,
    };
  }

  // Check package.json prettier key
  const packageJsonPath = joinPath(cwd, "package.json");
  if (fileExists(packageJsonPath)) {
    const packageJson = readJsonFile<PackageJson>(packageJsonPath);
    if (packageJson?.prettier) {
      return {
        detected: true,
        configPath: "package.json",
      };
    }
  }

  return { detected: false };
}

/**
 * Detect package manager from lockfile
 */
export function detectPackageManager(cwd: string): PackageManagerDetection | null {
  for (const { lockfile, name } of PACKAGE_MANAGER_LOCKFILES) {
    const fullPath = joinPath(cwd, lockfile);
    if (fileExists(fullPath)) {
      return { name, lockfile };
    }
  }

  return null;
}

/**
 * Detect all project tools
 */
export function detectProjectTools(cwd: string): DetectionResult {
  return {
    typescript: detectTypeScript(cwd),
    eslint: detectESLint(cwd),
    prettier: detectPrettier(cwd),
    packageManager: detectPackageManager(cwd),
  };
}
