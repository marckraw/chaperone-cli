import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "./testing/fixtures";

const CLI = join(import.meta.dir, "cli.ts");

afterEach(cleanupProjects);

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env: Record<string, string> = {}): CliRun {
  const result = Bun.spawnSync([process.execPath, CLI, ...args], {
    cwd,
    env: { ...process.env, CHAPERONE_NO_UPDATE_CHECK: "1", NO_COLOR: "", FORCE_COLOR: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/** A project without tsconfig/eslint/prettier, so only custom rules run. */
function projectWithRules(rules: unknown[], files: Record<string, string> = {}): string {
  return makeProject({
    ".chaperone.json": JSON.stringify({ version: "1.0.0", rules: { custom: rules } }),
    ...files,
  });
}

const NO_TODO = {
  type: "regex",
  id: "no-todo",
  severity: "error",
  files: "src/**/*.ts",
  pattern: "TODO",
  message: "No TODOs",
};

const NO_FIXME_WARNING = { ...NO_TODO, id: "no-fixme", severity: "warning", pattern: "FIXME", message: "No FIXMEs" };

describe("chaperone check exit codes", () => {
  test("exits 0 when everything passes", () => {
    const cwd = projectWithRules([NO_TODO], { "src/a.ts": "export const a = 1;\n" });
    expect(runCli(["check"], cwd).exitCode).toBe(0);
  });

  test("exits 1 when the check finds errors", () => {
    const cwd = projectWithRules([NO_TODO], { "src/a.ts": "// TODO\n" });
    expect(runCli(["check"], cwd).exitCode).toBe(1);
  });

  test("exits 2 on an invalid configuration and reports every problem", () => {
    const cwd = projectWithRules([
      { ...NO_TODO, severity: "eror" },
      { id: "old", type: "relationship", severity: "error" },
    ]);
    const run = runCli(["check"], cwd);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('did you mean "error"');
    expect(run.stderr).toContain("removed in chaperone 0.5.0");
    expect(run.stdout).toBe("");
  });

  test("exits 2 on unknown options, bad formats and unknown commands", () => {
    const cwd = projectWithRules([NO_TODO]);
    expect(runCli(["check", "--bogus"], cwd).exitCode).toBe(2);
    expect(runCli(["check", "--format", "xml"], cwd).exitCode).toBe(2);
    expect(runCli(["check", "--format"], cwd).exitCode).toBe(2);
    expect(runCli(["frobnicate"], cwd).exitCode).toBe(2);
  });
});

describe("chaperone check machine output", () => {
  test("--format json prints nothing but parseable JSON on stdout", () => {
    const cwd = projectWithRules([NO_TODO], { "src/a.ts": "// TODO\n" });
    const run = runCli(["check", "--format", "json"], cwd);
    expect(run.stdout.startsWith("{")).toBe(true);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.summary.totalErrors).toBe(1);
  });

  test("--format json reports configuration errors as JSON too", () => {
    const cwd = projectWithRules([{ ...NO_TODO, files: undefined }]);
    const run = runCli(["check", "--format", "json"], cwd);
    expect(run.exitCode).toBe(2);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.error).toBe("invalid-config");
    expect(parsed.diagnostics[0].message).toBe('missing required field "files"');
  });

  test("no ANSI escape codes when stdout is not a terminal", () => {
    const cwd = projectWithRules([NO_TODO], { "src/a.ts": "// TODO\n" });
    for (const format of ["text", "json", "ai"]) {
      const run = runCli(["check", "--format", format], cwd);
      expect(run.stdout).not.toContain("\x1b");
    }
  });

  test("FORCE_COLOR colours text output", () => {
    const cwd = projectWithRules([NO_TODO], { "src/a.ts": "// TODO\n" });
    expect(runCli(["check"], cwd, { FORCE_COLOR: "1" }).stdout).toContain("\x1b[");
  });

  test("--quiet lists only errors in every format", () => {
    const cwd = projectWithRules([NO_TODO, NO_FIXME_WARNING], { "src/a.ts": "// TODO\n// FIXME\n" });

    const json = JSON.parse(runCli(["check", "--format", "json", "--quiet"], cwd).stdout);
    expect(json.results.map((result: { rule: string }) => result.rule)).toEqual(["regex/no-todo"]);
    expect(json.summary.totalWarnings).toBe(1);

    const ai = runCli(["check", "--format", "ai", "--quiet"], cwd).stdout;
    expect(ai).toContain("regex/no-todo");
    expect(ai).not.toContain("regex/no-fixme");

    const text = runCli(["check", "--quiet"], cwd).stdout;
    expect(text).toContain("regex/no-todo");
    expect(text).not.toContain("regex/no-fixme");
  });
});

describe("chaperone check visibility", () => {
  test("a rule whose glob matches nothing is reported, and PASSED says so", () => {
    const cwd = projectWithRules([{ ...NO_TODO, id: "vue-only", files: "src/**/*.vue" }], {
      "src/a.ts": "export const a = 1;\n",
    });

    const json = JSON.parse(runCli(["check", "--format", "json"], cwd).stdout);
    expect(json.status).toBe("passed-with-gaps");
    expect(json.rules).toEqual([
      expect.objectContaining({ id: "vue-only", status: "no-files", filesChecked: 0 }),
    ]);

    const text = runCli(["check"], cwd).stdout;
    expect(text).toContain("PASSED, but not everything was checked");
    expect(text).toContain('"files" glob "src/**/*.vue" matched no files');

    const ai = runCli(["check", "--format", "ai"], cwd).stdout;
    expect(ai).toContain('Rule "vue-only" (regex): "files" glob "src/**/*.vue" matched no files');
  });
});
