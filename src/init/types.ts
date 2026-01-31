/**
 * Type definitions for Chaperone init command
 */

export interface TypeScriptSettings {
  strict?: boolean;
  target?: string;
}

export interface TypeScriptDetection {
  detected: boolean;
  configPath?: string;
  settings?: TypeScriptSettings;
}

export type ESLintConfigFormat = "legacy" | "flat";

export interface ESLintDetection {
  detected: boolean;
  configPath?: string;
  configFormat?: ESLintConfigFormat;
}

export interface PrettierDetection {
  detected: boolean;
  configPath?: string;
}

export type PackageManagerName = "bun" | "pnpm" | "yarn" | "npm";

export interface PackageManagerDetection {
  name: PackageManagerName;
  lockfile: string;
}

export interface DetectionResult {
  typescript: TypeScriptDetection;
  eslint: ESLintDetection;
  prettier: PrettierDetection;
  packageManager: PackageManagerDetection | null;
}

export interface ProjectConfig {
  typescript: TypeScriptDetection;
  eslint: ESLintDetection;
  prettier: PrettierDetection;
  packageManager: PackageManagerDetection | null;
}

export interface IntegrationsConfig {
  respectEslintIgnore: boolean;
  respectPrettierIgnore: boolean;
  useTypescriptPaths: boolean;
}

export interface ChaperoneConfig {
  version: string;
  project: ProjectConfig;
  rules: Record<string, unknown>;
  include: string[];
  exclude: string[];
  integrations: IntegrationsConfig;
}

export interface InitOptions {
  yes?: boolean;
  force?: boolean;
  cwd?: string;
  dryRun?: boolean;
}
