import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import type { ExecResult } from "../../utils/process";
import { DEFAULT_CONFIG } from "../types";
import { interpretESLintRun, parseESLintOutput } from "./eslint";
import { runAllTools } from "./index";
import { interpretPrettierRun, parsePrettierOutput } from "./prettier";
import { checksNothing, interpretTypeScriptRun, parseTypeScriptOutput } from "./typescript";

afterEach(cleanupProjects);

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

const exec = (partial: Partial<ExecResult>): ExecResult => ({ stdout: "", stderr: "", exitCode: 0, ...partial });

describe("typescript runner", () => {
  test("parses located diagnostics and appends continuation lines", () => {
    const results = parseTypeScriptOutput(fixture("tsc-errors.txt"));
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      file: "src/a.ts",
      line: 1,
      column: 14,
      rule: "typescript/TS2322",
      severity: "error",
    });
    expect(results[2]!.message).toContain("The types of 'x.y' are incompatible");
    expect(results[2]!.message).toContain("Type 'string' is not assignable to type 'number'.");
  });

  test("parses global diagnostics such as TS18003", () => {
    const run = interpretTypeScriptRun(exec({ stdout: fixture("tsc-no-inputs.txt"), exitCode: 2 }), "tsc --noEmit");
    expect(run.success).toBe(false);
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ rule: "typescript/TS18003", severity: "error", file: "tsconfig.json" });
  });

  test("fails closed when tsc exits non-zero without diagnostics", () => {
    const run = interpretTypeScriptRun(
      exec({ stderr: "RangeError: Maximum call stack size exceeded", exitCode: 1 }),
      "tsc --noEmit"
    );
    expect(run.success).toBe(false);
    expect(run.error).toContain("exited with code 1 without reporting any diagnostics");
    expect(run.results[0]).toMatchObject({ rule: "typescript/runner-error", severity: "error" });
    expect(run.results[0]!.context?.commandOutput).toContain("Maximum call stack");
  });

  test("passes on a clean exit", () => {
    expect(interpretTypeScriptRun(exec({}), "tsc").success).toBe(true);
  });
});

describe("eslint runner", () => {
  test("parses JSON output, including fatal parse errors", () => {
    const issues = parseESLintOutput(fixture("eslint-issues.json"), "/project");
    expect(issues?.map((result) => [result.file, result.rule, result.severity])).toEqual([
      ["src/a.js", "eslint/no-unused-vars", "error"],
      ["src/a.js", "eslint/no-console", "warning"],
    ]);

    const withParseError = parseESLintOutput(fixture("eslint-parse-error.json"), "/project");
    expect(withParseError?.some((result) => result.rule === "eslint/parse-error" && result.severity === "error")).toBe(
      true
    );
  });

  test("fails closed on a configuration crash (exit code 2)", () => {
    const run = interpretESLintRun(
      exec({ stderr: fixture("eslint-config-crash.stderr.txt"), exitCode: 2 }),
      "/project",
      "eslint --format json ."
    );
    expect(run.success).toBe(false);
    expect(run.error).toContain("exited with code 2");
    expect(run.results[0]!.context?.commandOutput).toContain("Cannot find package 'eslint-plugin-does-not-exist'");
  });

  test("fails closed on unparseable output", () => {
    const run = interpretESLintRun(exec({ stdout: "not json", exitCode: 1 }), "/project", "eslint");
    expect(run.error).toContain("could not be parsed");
  });

  test("reports issues on exit code 1", () => {
    const run = interpretESLintRun(exec({ stdout: fixture("eslint-issues.json"), exitCode: 1 }), "/project", "eslint");
    expect(run.error).toBeUndefined();
    expect(run.results).toHaveLength(2);
    expect(run.success).toBe(false);
  });
});

describe("prettier runner", () => {
  test("reads Prettier 3 [warn] lines from stderr", () => {
    const cwd = makeProject({ "src/ugly.ts": "const   a =1\n" });
    const run = interpretPrettierRun(
      exec({ stdout: "Checking formatting...\n", stderr: fixture("prettier-unformatted.stderr.txt"), exitCode: 1 }),
      cwd,
      "prettier --check ."
    );
    expect(run.results).toEqual([
      {
        file: "src/ugly.ts",
        rule: "prettier/format",
        message: "File is not formatted according to Prettier rules",
        severity: "warning",
        source: "prettier",
        fixable: true,
      },
    ]);
  });

  test("reports syntax errors as errors", () => {
    const cwd = makeProject({ "src/broken.ts": "const = ;\n", "src/ugly.ts": "const   a =1\n" });
    const run = interpretPrettierRun(
      exec({
        stdout: fixture("prettier-syntax-error.stdout.txt"),
        stderr: fixture("prettier-syntax-error.stderr.txt"),
        exitCode: 2,
      }),
      cwd,
      "prettier --check ."
    );
    expect(run.results.map((result) => [result.file, result.rule, result.severity])).toEqual([
      ["src/broken.ts", "prettier/syntax-error", "error"],
      ["src/ugly.ts", "prettier/format", "warning"],
    ]);
  });

  test("fails closed when Prettier exits 2 without naming a file", () => {
    const cwd = makeProject();
    const run = interpretPrettierRun(
      exec({ stderr: fixture("prettier-no-match.stderr.txt"), exitCode: 2 }),
      cwd,
      "prettier --check ."
    );
    expect(run.success).toBe(false);
    expect(run.results[0]!.rule).toBe("prettier/runner-error");
  });

  test("still understands bare paths from older Prettier versions", () => {
    const cwd = makeProject({ "a.ts": "" });
    expect(parsePrettierOutput("Checking formatting...\na.ts\n", cwd)).toHaveLength(1);
  });
});

describe("runAllTools", () => {
  test("reports why each runner was skipped", async () => {
    const cwd = makeProject({ "src/a.ts": "" });
    const config = {
      ...DEFAULT_CONFIG,
      rules: { ...DEFAULT_CONFIG.rules, prettier: { enabled: false } },
    };
    const { summaries, results } = await runAllTools(config, { cwd });

    expect(results).toEqual([]);
    expect(summaries.map((runner) => [runner.name, runner.status])).toEqual([
      ["typescript", "skipped"],
      ["eslint", "skipped"],
      ["prettier", "skipped"],
    ]);
    expect(summaries[0]!.reason).toContain("no tsconfig.json");
    expect(summaries[1]!.reason).toContain("no ESLint config");
    expect(summaries[2]!.reason).toContain("disabled in config");
  });

  test("detects TypeScript ESLint configs (eslint.config.ts/.mts/.cts)", async () => {
    for (const name of ["eslint.config.ts", "eslint.config.mts", "eslint.config.cts"]) {
      const cwd = makeProject({ [name]: "export default [];\n" });
      const { summaries } = await runAllTools(DEFAULT_CONFIG, { cwd });
      const eslint = summaries.find((runner) => runner.name === "eslint")!;
      expect(eslint.reason ?? "").not.toContain("no ESLint config");
    }
  });
});

describe("typescript runner: solution-style configs", () => {
  test("a tsconfig with only references is skipped with the reason instead of passing", async () => {
    const cwd = makeProject({
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    });
    const { summaries } = await runAllTools(DEFAULT_CONFIG, { cwd });
    expect(summaries[0]!.status).toBe("skipped");
    expect(summaries[0]!.reason).toContain("would check nothing");
  });

  test("checksNothing respects an explicit -p argument", () => {
    const solution = '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }';
    expect(checksNothing(solution)).toBe(true);
    expect(checksNothing(solution, ["-p", "tsconfig.app.json"])).toBe(false);
    expect(checksNothing('{ "include": ["src"] }')).toBe(false);
    expect(checksNothing('{ "extends": "./base.json", "files": [], "references": [{ "path": "./a" }] }')).toBe(false);
  });
});

describe("eslint runner: exit code 1 with only warnings", () => {
  test("fails the check (e.g. --max-warnings 0)", () => {
    const warningsOnly = JSON.stringify([
      { filePath: "/project/src/a.js", messages: [{ ruleId: "no-console", severity: 1, message: "x", line: 1, column: 1 }] },
    ]);
    const run = interpretESLintRun(exec({ stdout: warningsOnly, exitCode: 1 }), "/project", "eslint --max-warnings 0");
    expect(run.results.map((result) => [result.rule, result.severity])).toEqual([
      ["eslint/no-console", "warning"],
      ["eslint/max-warnings", "error"],
    ]);
    expect(run.success).toBe(false);
  });
});

describe("runAllTools ordering", () => {
  function projectWithFakeTools(): string {
    const script = (name: string, output: string) =>
      `#!/bin/sh\necho "${name} start" >> "$(dirname "$0")/../../tools.log"\nsleep 0.2\necho "${name} end" >> "$(dirname "$0")/../../tools.log"\nprintf '%s' '${output}'\n`;
    const cwd = makeProject({
      "tsconfig.json": '{ "include": ["src"] }',
      "eslint.config.js": "export default [];\n",
      ".prettierrc": "{}\n",
      "node_modules/.bin/tsc": script("tsc", ""),
      "node_modules/.bin/eslint": script("eslint", "[]"),
      "node_modules/.bin/prettier": script("prettier", ""),
    });
    for (const tool of ["tsc", "eslint", "prettier"]) {
      chmodSync(join(cwd, "node_modules/.bin", tool), 0o755);
    }
    return cwd;
  }

  test("--fix runs ESLint, then Prettier, then TypeScript, one at a time", async () => {
    const cwd = projectWithFakeTools();
    const { summaries } = await runAllTools(DEFAULT_CONFIG, { cwd, fix: true, sequential: true });
    expect(summaries.map((runner) => [runner.name, runner.status])).toEqual([
      ["typescript", "passed"],
      ["eslint", "passed"],
      ["prettier", "passed"],
    ]);
    expect(readFileSync(join(cwd, "tools.log"), "utf-8").trim().split("\n")).toEqual([
      "eslint start",
      "eslint end",
      "prettier start",
      "prettier end",
      "tsc start",
      "tsc end",
    ]);
  });

  test("without --fix the tools run concurrently", async () => {
    const cwd = projectWithFakeTools();
    await runAllTools(DEFAULT_CONFIG, { cwd });
    const log = readFileSync(join(cwd, "tools.log"), "utf-8").trim().split("\n");
    expect(log.slice(0, 3).every((line) => line.endsWith("start"))).toBe(true);
  });
});
