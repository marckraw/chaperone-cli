import { existsSync } from "node:fs";
import { join } from "node:path";
import { execCommand, findNpmBinary } from "../../utils/process";
import type { CheckResult } from "../types";
import type { Runner, RunnerOptions, RunnerResult } from "./types";

/**
 * Parse TypeScript compiler output
 */
function parseTypeScriptOutput(output: string): CheckResult[] {
  const results: CheckResult[] = [];
  const lines = output.split("\n");

  // TypeScript error format: file(line,col): error TSxxxx: message
  const errorRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(errorRegex);
    if (match) {
      const [, file, lineNum, col, severity, code, message] = match;
      results.push({
        file: file.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(col, 10),
        rule: `typescript/${code}`,
        message: message.trim(),
        severity: severity === "error" ? "error" : "warning",
        source: "typescript",
      });
    }
  }

  return results;
}

/**
 * TypeScript runner - runs tsc --noEmit
 */
export const typescriptRunner: Runner = {
  name: "typescript",

  async isAvailable(cwd: string): Promise<boolean> {
    // Check for tsconfig.json
    const tsconfigPath = join(cwd, "tsconfig.json");
    if (!existsSync(tsconfigPath)) {
      return false;
    }

    // Check for tsc binary
    const tscPath = await findNpmBinary("tsc", cwd);
    return tscPath !== null;
  },

  async run(options: RunnerOptions): Promise<RunnerResult> {
    const { cwd, config } = options;

    if (config?.enabled === false) {
      return {
        source: "typescript",
        results: [],
        success: true,
        skipped: true,
      };
    }

    const tscPath = await findNpmBinary("tsc", cwd);
    if (!tscPath) {
      return {
        source: "typescript",
        results: [],
        success: false,
        error: "TypeScript compiler (tsc) not found",
      };
    }

    const args = ["--noEmit", "--pretty", "false"];

    // Add any custom args from config
    if (config?.args) {
      args.push(...config.args);
    }

    const result = await execCommand(tscPath, args, { cwd });

    // tsc returns non-zero on errors
    const combined = result.stdout + result.stderr;
    const results = parseTypeScriptOutput(combined);

    return {
      source: "typescript",
      results,
      success: results.filter((r) => r.severity === "error").length === 0,
    };
  },
};
