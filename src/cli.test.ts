import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject, writeFiles } from "./testing/fixtures";
import { VERSION } from "./version";

const CLI = join(import.meta.dir, "cli.ts");

afterEach(cleanupProjects);

interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run this checkout's CLI. No CHAPERONE_* variable leaks in, and the machine config file is an
 * empty directory's: a machine default on the machine running the tests would otherwise make
 * these unpinned projects launch that version instead of this checkout.
 */
function runCli(args: string[], cwd: string, env: Record<string, string> = {}): CliRun {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CHAPERONE_")));
  const result = Bun.spawnSync([process.execPath, CLI, ...args], {
    cwd,
    env: {
      ...inherited,
      XDG_CONFIG_HOME: makeProject(),
      CHAPERONE_NO_UPDATE_CHECK: "1",
      NO_COLOR: "",
      FORCE_COLOR: "",
      ...env,
    },
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

describe("chaperone init", () => {
  // init turns on the TypeScript runner, so the check starts tsc: well under a second here, but past
  // bun's 5 s default on a cold CI runner (1 Oct, PR #24), which left stdout empty.
  test("writes a config that loads without warnings", () => {
    const cwd = makeProject({ "tsconfig.json": "{}", "src/a.ts": "export const a = 1;\n" });
    expect(runCli(["init", "--yes"], cwd).exitCode).toBe(0);
    // A new project runs the version that created its config
    expect(JSON.parse(readFileSync(join(cwd, ".chaperone.json"), "utf-8")).chaperoneVersion).toBe(VERSION);

    const json = JSON.parse(runCli(["check", "--format", "json"], cwd).stdout);
    expect(json.diagnostics).toEqual([]);
    expect(runCli(["init", "--yes"], cwd).exitCode).toBe(2);
  }, 30_000);
});

describe("chaperone check --since", () => {
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd });

  test("limits custom rules to files changed since the ref", () => {
    const cwd = projectWithRules([NO_TODO], { "src/old.ts": "// TODO old\n", "src/edited.ts": "export {};\n" });
    git(cwd, "init", "-q");
    git(cwd, "add", ".");
    git(cwd, "commit", "-q", "-m", "init");
    writeFileSync(join(cwd, "src/edited.ts"), "// TODO edited\n");
    writeFileSync(join(cwd, "src/new.ts"), "// TODO new\n");

    const full = JSON.parse(runCli(["check", "--format", "json"], cwd).stdout);
    expect(full.summary.totalErrors).toBe(3);

    const run = runCli(["check", "--format", "json", "--since", "HEAD"], cwd);
    const json = JSON.parse(run.stdout);
    expect(json.results.map((result: { file: string }) => result.file).sort()).toEqual([
      "src/edited.ts",
      "src/new.ts",
    ]);
    expect(json.since).toEqual({ ref: "HEAD", changedFiles: 2 });
    expect(json.gaps).toContain("custom rules only checked the 2 file(s) changed since HEAD");
    expect(run.exitCode).toBe(1);
  });

  test("exits 2 for an unknown ref or outside a git repository", () => {
    const cwd = projectWithRules([NO_TODO]);
    expect(runCli(["check", "--since", "HEAD"], cwd).stderr).toContain("not inside one");
    git(cwd, "init", "-q");
    const run = runCli(["check", "--since", "no-such-ref"], cwd);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('unknown git ref "no-such-ref"');
  });
});

describe("chaperone check --cwd", () => {
  test("exits 2 when the directory does not exist", () => {
    const run = runCli(["check", "--cwd", "/definitely/not/here", "--format", "json"], makeProject());
    expect(run.exitCode).toBe(2);
    expect(JSON.parse(run.stdout).message).toContain("directory not found");
  });
});

describe("chaperone baseline", () => {
  const BASELINE = ".chaperone-baseline.json";
  const readBaseline = (cwd: string) =>
    JSON.parse(readFileSync(join(cwd, BASELINE), "utf-8")) as { entries: Array<{ file: string }> };

  /** Two existing violations, with the baseline written */
  function legacyProject(): string {
    const cwd = projectWithRules([NO_TODO], {
      "src/a.ts": "export const a = 1; // TODO legacy a\n",
      "src/b.ts": "// TODO legacy b\nexport const b = 2;\n",
    });
    const run = runCli(["baseline"], cwd);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Created ${BASELINE}: 2 entries (2 violations).`);
    // A new baseline lists every entry it records
    expect(run.stdout).toContain("  + regex/no-todo  src/a.ts  No TODOs\n  + regex/no-todo  src/b.ts  No TODOs");
    return cwd;
  }

  test("check passes over the baselined violations", () => {
    const cwd = legacyProject();
    const run = runCli(["check"], cwd);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("Baselined: 2 (2 errors), not counted");
  });

  test("a new violation fails the check, which names only the new one", () => {
    const cwd = legacyProject();
    writeFileSync(join(cwd, "src/c.ts"), "// TODO new\n");

    const run = runCli(["check"], cwd);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain("src/c.ts:1");
    expect(run.stdout).not.toContain("src/a.ts:1");
    expect(run.stdout).not.toContain("src/b.ts:1");

    const json = JSON.parse(runCli(["check", "--format", "json"], cwd).stdout);
    expect(json.results.map((result: { file: string }) => result.file)).toEqual(["src/c.ts"]);
    expect(json.summary.totalErrors).toBe(1);
    expect(json.baseline.baselined.errors).toBe(2);
    expect(json.baseline.baselined.results.map((result: { file: string }) => result.file).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);

    const ai = runCli(["check", "--format", "ai"], cwd).stdout;
    expect(ai).toContain("**src/c.ts:1:4**");
    expect(ai).not.toContain("**src/a.ts");
    expect(ai).toContain("**Baselined:** 2 (2 errors), not counted and not listed");
  });

  test("fixing an old violation passes and reports the stale entry; baseline then shrinks the file", () => {
    const cwd = legacyProject();
    writeFileSync(join(cwd, "src/a.ts"), "export const a = 1;\n");

    const run = runCli(["check"], cwd);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("1 stale entry no longer occurs");
    expect(run.stdout).toContain("regex/no-todo  src/a.ts  No TODOs");
    const json = JSON.parse(runCli(["check", "--format", "json"], cwd).stdout);
    expect(json.baseline.stale.map((entry: { file: string }) => entry.file)).toEqual(["src/a.ts"]);
    expect(runCli(["check", "--format", "ai"], cwd).stdout).toContain("1 stale entry no longer occurs");

    const shrink = runCli(["baseline"], cwd);
    expect(shrink.exitCode).toBe(0);
    expect(shrink.stdout).toContain("Removed 1 entry that no longer occurs:\n  - regex/no-todo  src/a.ts  No TODOs");
    expect(readBaseline(cwd).entries.map((entry) => entry.file)).toEqual(["src/b.ts"]);
    expect(runCli(["check"], cwd).stdout).not.toContain("stale");
  });

  test("growing the baseline is refused unless --allow-growth, which prints what it added", () => {
    const cwd = legacyProject();
    writeFileSync(join(cwd, "src/c.ts"), "// TODO new\n");

    const refused = runCli(["baseline"], cwd);
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout).toContain("Not added: 1 violation is not in the baseline, and the baseline only shrinks:");
    expect(refused.stdout).toContain("! regex/no-todo  src/c.ts  No TODOs");
    expect(readBaseline(cwd).entries).toHaveLength(2);

    const grown = runCli(["baseline", "--allow-growth"], cwd);
    expect(grown.exitCode).toBe(0);
    expect(grown.stdout).toContain("Added 1 entry (--allow-growth):\n  + regex/no-todo  src/c.ts  No TODOs");
    expect(readBaseline(cwd).entries).toHaveLength(3);
    expect(runCli(["check"], cwd).exitCode).toBe(0);
  });

  test("deleting the committed baseline cannot grow it: baseline starts from HEAD", () => {
    const cwd = legacyProject();
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd });
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    rmSync(join(cwd, BASELINE));
    writeFileSync(join(cwd, "src/c.ts"), "// TODO new\n");
    const run = runCli(["baseline"], cwd);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain("missing from the working tree: starting from the one committed at HEAD");
    expect(run.stdout).toContain("! regex/no-todo  src/c.ts  No TODOs");
    expect(readBaseline(cwd).entries.map((entry) => entry.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(runCli(["check"], cwd).exitCode).toBe(1);
  });

  describe("a rule that cannot check", () => {
    const META = { type: "package-fields", id: "meta", severity: "error", requiredFields: ["description"] };

    test("leaves the baseline alone: baseline exits 2, check keeps the entry as unverified", () => {
      const cwd = projectWithRules([META], { "package.json": '{ "name": "x" }\n' });
      expect(runCli(["baseline"], cwd).exitCode).toBe(0);
      const before = readFileSync(join(cwd, BASELINE), "utf-8");

      writeFileSync(join(cwd, "package.json"), "{ not json");
      const run = runCli(["baseline"], cwd);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("package-fields/meta could not check (package.json): Failed to parse package.json");
      expect(readFileSync(join(cwd, BASELINE), "utf-8")).toBe(before);

      const check = runCli(["check", "--format", "json"], cwd);
      expect(check.exitCode).toBe(1);
      const json = JSON.parse(check.stdout);
      expect(json.results[0].message).toContain("Failed to parse package.json");
      expect(json.baseline.stale).toEqual([]);
      expect(json.baseline.unverified.map((entry: { rule: string }) => entry.rule)).toEqual(["package-fields/meta"]);

      // Fixed again, the legacy violation is still baselined
      writeFileSync(join(cwd, "package.json"), '{ "name": "x" }\n');
      expect(runCli(["check"], cwd).exitCode).toBe(0);
    });

    test("is never baselined: creating the baseline exits 2 and writes nothing", () => {
      const cwd = projectWithRules([META], { "package.json": "{ not json" });
      const run = runCli(["baseline"], cwd);
      expect(run.exitCode).toBe(2);
      expect(existsSync(join(cwd, BASELINE))).toBe(false);
    });
  });

  test("--no-baseline reports every violation", () => {
    const cwd = legacyProject();
    const run = runCli(["check", "--no-baseline"], cwd);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).not.toContain("Baselined");
  });

  test("an invalid baseline exits 2, as JSON too", () => {
    const cwd = projectWithRules([NO_TODO], { "src/a.ts": "", [BASELINE]: "not json" });
    const run = runCli(["check", "--format", "json"], cwd);
    expect(run.exitCode).toBe(2);
    expect(JSON.parse(run.stdout).error).toBe("invalid-baseline");
    expect(runCli(["baseline"], cwd).exitCode).toBe(2);
  });
});

describe("Backbase rule canaries", () => {
  const reserved = {
    type: "reserved-names", id: "no-backpack-shadowing", severity: "error",
    package: "@ef-global/backpack", files: "src/components/**/*.{ts,tsx}",
  };
  const registered = {
    type: "registered-in-map", id: "schema-is-registered", severity: "error",
    files: "src/**/*.sb.ts", mapFile: "src/components/component-list.ts",
  };
  const fixtures = {
    "node_modules/@ef-global/backpack/package.json": '{"exports":{".":{"types":"./index.d.ts"}}}',
    "node_modules/@ef-global/backpack/index.d.ts": "export declare const Button: unknown;",
    "src/components/CustomHero.tsx": "export const CustomHero = () => <section />;",
    "src/hero.sb.ts": 'export default { name: "hero", schema: {} };',
    "src/components/component-list.ts": 'const LocalComponents = { hero: 1 }; export default { ...LocalComponents };',
  };

  test.each(["json", "ai"])("reserved-names canary fails in %s and passes after renaming", (format) => {
    const cwd = projectWithRules([reserved], { ...fixtures, "src/components/Button.tsx": "export const Button = () => <button />;" });
    const failed = runCli(["check", "--format", format], cwd);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("no-backpack-shadowing");
    expect(failed.stdout).toContain("Button");
    if (format === "json") {
      expect(JSON.parse(failed.stdout).results).toHaveLength(1);
      expect(JSON.parse(failed.stdout).results[0].rule).toBe("reserved-names/no-backpack-shadowing");
    }
    const clean = projectWithRules([reserved], fixtures);
    expect(runCli(["check", "--format", format], clean).exitCode).toBe(0);
  });

  test.each(["json", "ai"])("registered-in-map canary fails in %s and passes after registration", (format) => {
    const cwd = projectWithRules([registered], { ...fixtures, "src/components/component-list.ts": "export default {};" });
    const failed = runCli(["check", "--format", format], cwd);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("schema-is-registered");
    expect(failed.stdout).toContain("hero");
    if (format === "json") {
      expect(JSON.parse(failed.stdout).results).toHaveLength(1);
      expect(JSON.parse(failed.stdout).results[0].rule).toBe("registered-in-map/schema-is-registered");
    }
    const clean = projectWithRules([registered], fixtures);
    expect(runCli(["check", "--format", format], clean).exitCode).toBe(0);
  });

  describe("native rule baselines", () => {
    const BASELINE = ".chaperone-baseline.json";
    const packageExports = { "node_modules/@ef-global/backpack/index.d.ts": "export declare const Button: unknown; export declare const Card: unknown;" };
    const cases: Array<{
      name: string;
      rule: unknown;
      legacyFiles: Record<string, string>;
      newFile: [string, string];
      breakRule(cwd: string): void;
      repairFiles: Record<string, string>;
      errorText: string;
    }> = [
      {
        name: "reserved-names",
        rule: reserved,
        legacyFiles: {
          ...packageExports,
          "src/components/Button.tsx": "export const Button = () => <button />;",
          "src/components/legacy/Card.tsx": "export const Card = () => <article />;",
        },
        newFile: ["src/components/Card.tsx", "export const Card = () => <article />;"],
        breakRule: (cwd) => rmSync(join(cwd, "node_modules/@ef-global/backpack"), { recursive: true }),
        repairFiles: { ...packageExports, "node_modules/@ef-global/backpack/package.json": fixtures["node_modules/@ef-global/backpack/package.json"] },
        errorText: "Cannot check reserved names:",
      },
      {
        name: "registered-in-map",
        rule: registered,
        legacyFiles: {
          "src/card.sb.ts": 'export default { name: "card" };',
          "src/components/component-list.ts": "export default {};",
        },
        newFile: ["src/footer.sb.ts", 'export default { name: "footer" };'],
        breakRule: (cwd) => writeFileSync(join(cwd, "src/components/component-list.ts"), "export default { hero: ;"),
        repairFiles: { "src/components/component-list.ts": "export default {};" },
        errorText: "Cannot check registration:",
      },
    ];

    for (const scenario of cases) {
      describe(scenario.name, () => {
        function legacyProject(): string {
          const cwd = projectWithRules([scenario.rule], { ...fixtures, ...scenario.legacyFiles });
          expect(runCli(["baseline"], cwd).exitCode).toBe(0);
          expect(JSON.parse(readFileSync(join(cwd, BASELINE), "utf8")).entries).toHaveLength(2);
          return cwd;
        }

        test("baselined violations pass", () => {
          const cwd = legacyProject();
          const checked = runCli(["check", "--format", "json"], cwd);
          expect(checked.exitCode).toBe(0);
          const output = JSON.parse(checked.stdout);
          expect(output.results).toEqual([]);
          expect(output.baseline.baselined.errors).toBe(2);
          expect(output.baseline.unverified).toEqual([]);
        });

        test("a new violation fails while the old violations remain baselined", () => {
          const cwd = legacyProject();
          writeFiles(cwd, { [scenario.newFile[0]]: scenario.newFile[1] });
          const checked = runCli(["check", "--format", "json"], cwd);
          expect(checked.exitCode).toBe(1);
          const output = JSON.parse(checked.stdout);
          expect(output.results.map((result: { file: string }) => result.file)).toEqual([scenario.newFile[0]]);
          expect(output.baseline.baselined.errors).toBe(2);
        });

        test("rule errors keep every entry unverified and baseline exits 2 without writing", () => {
          const cwd = legacyProject();
          const path = join(cwd, BASELINE);
          const before = readFileSync(path, "utf8");
          const stat = statSync(path);
          const entries = JSON.parse(before).entries;
          writeFiles(cwd, { [scenario.newFile[0]]: scenario.newFile[1] });
          scenario.breakRule(cwd);

          const checked = runCli(["check", "--format", "json"], cwd);
          expect(checked.exitCode).toBe(1);
          const output = JSON.parse(checked.stdout);
          expect(output.results.some((result: { message: string }) => result.message.startsWith(scenario.errorText))).toBe(true);
          expect(output.baseline.stale).toEqual([]);
          expect(output.baseline.unverified).toEqual(entries);
          for (const args of [["baseline"], ["baseline", "--allow-growth"]]) {
            const refused = runCli(args, cwd);
            expect(refused.exitCode).toBe(2);
            expect(refused.stderr).toContain(scenario.errorText);
            expect(readFileSync(path, "utf8")).toBe(before);
            expect(statSync(path).ino).toBe(stat.ino);
            expect(statSync(path).mtimeMs).toBe(stat.mtimeMs);
          }
          // Repairing the rule still exposes the new violation; its error was never recorded.
          writeFiles(cwd, scenario.repairFiles);
          const recovered = runCli(["check", "--format", "json"], cwd);
          expect(recovered.exitCode).toBe(1);
          expect(JSON.parse(recovered.stdout).results.map((result: { file: string }) => result.file)).toEqual([scenario.newFile[0]]);
        });

        test("rule errors cannot create a baseline, even with --allow-growth", () => {
          const cwd = projectWithRules([scenario.rule], { ...fixtures, ...scenario.legacyFiles });
          scenario.breakRule(cwd);
          for (const args of [["baseline"], ["baseline", "--allow-growth"]]) {
            expect(runCli(args, cwd).exitCode).toBe(2);
            expect(existsSync(join(cwd, BASELINE))).toBe(false);
          }
        });
      });
    }

    test.each([
      'export * from "@missing/peer";',
      'export { Card } from "@missing/peer";',
    ])("zero readable names from missing peers cannot pass or update a baseline", (missing) => {
      const cwd = projectWithRules([reserved], {
        ...fixtures, ...packageExports,
        "src/components/Button.tsx": "export const Button = () => <button />;",
      });
      expect(runCli(["baseline"], cwd).exitCode).toBe(0);
      const path = join(cwd, BASELINE);
      const before = readFileSync(path, "utf8");
      const inode = statSync(path).ino;
      writeFiles(cwd, { "src/components/Card.tsx": "export const Card = () => <article />;" });
      writeFileSync(join(cwd, "node_modules/@ef-global/backpack/index.d.ts"), missing);

      const checked = runCli(["check", "--format", "json"], cwd);
      expect(checked.exitCode).toBe(1);
      const output = JSON.parse(checked.stdout);
      expect(output.results[0].severity).toBe("error");
      expect(output.results[0].message).toContain("No exported names could be read");
      expect(output.results[0].message).toContain("@missing/peer");
      expect(output.baseline.stale).toEqual([]);
      expect(output.baseline.unverified).toEqual(JSON.parse(before).entries);
      for (const args of [["baseline"], ["baseline", "--allow-growth"]]) {
        expect(runCli(args, cwd).exitCode).toBe(2);
        expect(readFileSync(path, "utf8")).toBe(before);
        expect(statSync(path).ino).toBe(inode);
      }
      rmSync(path);
      expect(runCli(["baseline"], cwd).exitCode).toBe(2);
      expect(existsSync(path)).toBe(false);
    });
  });

});
