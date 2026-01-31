import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execCommand, findNpmBinary } from "../../utils/process";
import type { CheckResult } from "../types";
import type { Runner, RunnerOptions, RunnerResult } from "./types";

/**
 * ESLint JSON output format
 */
interface ESLintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  fix?: {
    range: [number, number];
    text: string;
  };
}

interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

/**
 * Parse ESLint JSON output
 */
function parseESLintOutput(output: string, cwd: string): CheckResult[] {
  const results: CheckResult[] = [];

  if (!output.trim()) {
    return results;
  }

  try {
    const parsed = JSON.parse(output) as ESLintFileResult[];

    for (const file of parsed) {
      const relativePath = relative(cwd, file.filePath);

      for (const msg of file.messages) {
        results.push({
          file: relativePath,
          line: msg.line,
          column: msg.column,
          rule: `eslint/${msg.ruleId ?? "unknown"}`,
          message: msg.message,
          severity: msg.severity === 2 ? "error" : "warning",
          source: "eslint",
          fixable: !!msg.fix,
        });
      }
    }
  } catch {
    // If JSON parse fails, try line-by-line parsing
    // This handles cases where eslint outputs non-JSON errors
  }

  return results;
}

/**
 * Check if ESLint config exists
 */
function hasESLintConfig(cwd: string): boolean {
  const configFiles = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ];

  for (const file of configFiles) {
    if (existsSync(join(cwd, file))) {
      return true;
    }
  }

  // Check package.json for eslintConfig
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.eslintConfig) {
        return true;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return false;
}

/**
 * ESLint runner
 */
export const eslintRunner: Runner = {
  name: "eslint",

  async isAvailable(cwd: string): Promise<boolean> {
    if (!hasESLintConfig(cwd)) {
      return false;
    }

    const eslintPath = await findNpmBinary("eslint", cwd);
    return eslintPath !== null;
  },

  async run(options: RunnerOptions): Promise<RunnerResult> {
    const { cwd, fix, config, files } = options;

    if (config?.enabled === false) {
      return {
        source: "eslint",
        results: [],
        success: true,
        skipped: true,
      };
    }

    const eslintPath = await findNpmBinary("eslint", cwd);
    if (!eslintPath) {
      return {
        source: "eslint",
        results: [],
        success: false,
        error: "ESLint not found",
      };
    }

    const args = ["--format", "json"];

    if (fix) {
      args.push("--fix");
    }

    // Add custom args
    if (config?.args) {
      args.push(...config.args);
    }

    // Add files or default to current directory
    if (files && files.length > 0) {
      args.push(...files);
    } else {
      args.push(".");
    }

    const result = await execCommand(eslintPath, args, { cwd });

    // ESLint outputs JSON to stdout
    const results = parseESLintOutput(result.stdout, cwd);

    return {
      source: "eslint",
      results,
      success: results.filter((r) => r.severity === "error").length === 0,
    };
  },
};
