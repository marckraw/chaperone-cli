import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute, relative } from "node:path";
import { execCommand, findNpmBinary } from "../../utils/process";
import type { CheckResult } from "../types";
import type { Runner, RunnerOptions, RunnerResult } from "./types";

/**
 * Parse Prettier --check output
 * Prettier outputs files that need formatting to stdout when using --check
 */
function parsePrettierOutput(output: string, cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Prettier --check outputs file paths that need formatting
    // Skip info messages
    if (
      line.startsWith("Checking") ||
      line.includes("All matched files") ||
      line.includes("Code style issues")
    ) {
      continue;
    }

    // Get relative path
    const filePath = line.trim();
    if (filePath && existsSync(join(cwd, filePath))) {
      results.push({
        file: filePath,
        rule: "prettier/format",
        message: "File is not formatted according to Prettier rules",
        severity: "warning",
        source: "prettier",
        fixable: true,
      });
    } else if (filePath && isAbsolute(filePath) && existsSync(filePath)) {
      results.push({
        file: relative(cwd, filePath),
        rule: "prettier/format",
        message: "File is not formatted according to Prettier rules",
        severity: "warning",
        source: "prettier",
        fixable: true,
      });
    }
  }

  return results;
}

/**
 * Check if Prettier config exists
 */
function hasPrettierConfig(cwd: string): boolean {
  const configFiles = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.json5",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
  ];

  for (const file of configFiles) {
    if (existsSync(join(cwd, file))) {
      return true;
    }
  }

  // Check package.json for prettier config
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.prettier) {
        return true;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return false;
}

/**
 * Prettier runner
 */
export const prettierRunner: Runner = {
  name: "prettier",

  async isAvailable(cwd: string): Promise<boolean> {
    if (!hasPrettierConfig(cwd)) {
      return false;
    }

    const prettierPath = await findNpmBinary("prettier", cwd);
    return prettierPath !== null;
  },

  async run(options: RunnerOptions): Promise<RunnerResult> {
    const { cwd, fix, config, files } = options;

    if (config?.enabled === false) {
      return {
        source: "prettier",
        results: [],
        success: true,
        skipped: true,
      };
    }

    const prettierPath = await findNpmBinary("prettier", cwd);
    if (!prettierPath) {
      return {
        source: "prettier",
        results: [],
        success: false,
        error: "Prettier not found",
      };
    }

    const args = fix ? ["--write"] : ["--check"];

    // Add custom args
    if (config?.args) {
      args.push(...config.args);
    }

    // Add files or default pattern
    if (files && files.length > 0) {
      args.push(...files);
    } else {
      args.push(".");
    }

    const result = await execCommand(prettierPath, args, { cwd });

    // In check mode, prettier exits with 1 if files need formatting
    // and outputs the file list to stdout
    const results = fix ? [] : parsePrettierOutput(result.stdout, cwd);

    return {
      source: "prettier",
      results,
      success: result.exitCode === 0,
    };
  },
};
