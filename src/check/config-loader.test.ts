import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { VALID_RULES } from "../testing/rule-fixtures";
import { ConfigError, getEffectivePatterns, loadConfigWithDiagnostics } from "./config-loader";

afterEach(cleanupProjects);

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function loadError(cwd: string, configPath?: string): ConfigError {
  try {
    loadConfigWithDiagnostics(cwd, configPath);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

function ruleIds(cwd: string): string[] {
  return (loadConfigWithDiagnostics(cwd).config.rules?.custom ?? []).map((rule) => rule.id);
}

describe("loadConfigWithDiagnostics", () => {
  test("falls back to defaults with a warning when there is no config", () => {
    const cwd = makeProject();
    const loaded = loadConfigWithDiagnostics(cwd);
    expect(loaded.configPath).toBeNull();
    expect(loaded.config.rules?.custom).toEqual([]);
    expect(loaded.diagnostics[0]!.message).toContain("no .chaperone.json found");
  });

  test("fails when an explicit config path does not exist", () => {
    const cwd = makeProject();
    expect(loadError(cwd, "missing.json").message).toContain("config file not found");
  });

  test("fails on invalid JSON", () => {
    const cwd = makeProject({ ".chaperone.json": "{ nope" });
    expect(loadError(cwd).diagnostics[0]!.message).toContain("invalid JSON");
  });

  test("collects every error instead of stopping at the first", () => {
    const cwd = makeProject({
      ".chaperone.json": json({
        rules: {
          custom: [
            { ...VALID_RULES.regex, id: "a", severity: "eror" },
            { ...VALID_RULES.regex, id: "b", type: "relationship" },
            { ...VALID_RULES.regex, id: "c", files: undefined },
          ],
        },
      }),
    });
    const error = loadError(cwd);
    const errors = error.diagnostics.filter((diagnostic) => diagnostic.level === "error");
    expect(errors.map((diagnostic) => diagnostic.ruleId)).toEqual(["a", "b", "c"]);
    expect(error.message).toContain("3 errors");
  });

  test("removes disabled rules even without extends", () => {
    const cwd = makeProject({
      ".chaperone.json": json({
        rules: { custom: [VALID_RULES.regex, { ...VALID_RULES["package-fields"], disabled: true }] },
      }),
    });
    const loaded = loadConfigWithDiagnostics(cwd);
    expect(loaded.config.rules?.custom?.map((rule) => rule.id)).toEqual(["no-console"]);
    expect(loaded.disabledRules).toEqual([{ id: "pkg", source: ".chaperone.json" }]);
  });

  test("a disabled stub switches off a preset rule", () => {
    const cwd = makeProject({
      ".chaperone.json": json({
        extends: ["chaperone/pure-functions"],
        rules: { custom: [{ id: "preset/pure-no-api-imports", disabled: true }] },
      }),
    });
    const loaded = loadConfigWithDiagnostics(cwd);
    expect(loaded.config.rules?.custom?.map((rule) => rule.id)).not.toContain("preset/pure-no-api-imports");
    expect(loaded.config.rules?.custom?.map((rule) => rule.id)).toContain("preset/pure-files-need-tests");
    expect(loaded.diagnostics).toEqual([]);
  });

  test("warns when a disabled stub matches no inherited rule", () => {
    const cwd = makeProject({
      ".chaperone.json": json({
        extends: ["chaperone/pure-functions"],
        rules: { custom: [{ id: "preset/pure-no-api-import", disabled: true }] },
      }),
    });
    const [warning] = loadConfigWithDiagnostics(cwd).diagnostics;
    expect(warning!.message).toContain("nothing was switched off");
  });

  test("user rules override preset rules with the same id", () => {
    const cwd = makeProject({
      ".chaperone.json": json({
        extends: ["chaperone/pure-functions"],
        rules: {
          custom: [{ ...VALID_RULES.regex, id: "preset/pure-no-api-imports", severity: "warning" }],
        },
      }),
    });
    const rule = loadConfigWithDiagnostics(cwd).config.rules?.custom?.find(
      (entry) => entry.id === "preset/pure-no-api-imports"
    );
    expect(rule?.severity).toBe("warning");
  });

  test("explains that a partial override replaces the whole inherited rule", () => {
    const cwd = makeProject({
      ".chaperone.json": json({
        extends: ["chaperone/pure-functions"],
        rules: { custom: [{ id: "preset/pure-no-api-imports", severity: "warning" }] },
      }),
    });
    const messages = loadError(cwd).diagnostics.map((diagnostic) => diagnostic.message);
    expect(messages.some((message) => message.includes("Overrides replace the whole rule"))).toBe(true);
  });

  test("validates rules coming from local presets and names the preset file", () => {
    const cwd = makeProject({
      ".chaperone.json": json({ extends: ["./presets/team.json"] }),
      "presets/team.json": json({
        rules: { custom: [{ id: "old", type: "relationship", severity: "error" }] },
      }),
    });
    const [error] = loadError(cwd).diagnostics;
    expect(error!.source).toBe("presets/team.json");
    expect(error!.ruleId).toBe("old");
  });

  test("resolves nested extends relative to the preset that declares them", () => {
    const cwd = makeProject({
      ".chaperone.json": json({ extends: ["./presets/a.json"] }),
      "presets/a.json": json({ extends: ["./b.json"], rules: { custom: [{ ...VALID_RULES.regex, id: "from-a" }] } }),
      "presets/b.json": json({ rules: { custom: [{ ...VALID_RULES.regex, id: "from-b" }] } }),
    });
    expect(ruleIds(cwd)).toEqual(["from-b", "from-a"]);
  });

  test("detects circular extends", () => {
    const cwd = makeProject({
      ".chaperone.json": json({ extends: ["./a.json"] }),
      "a.json": json({ extends: ["./b.json"] }),
      "b.json": json({ extends: ["./a.json"] }),
    });
    expect(loadError(cwd).message).toContain("circular preset dependency");
  });

  test("rejects unknown built-in presets and lists the available ones", () => {
    const cwd = makeProject({ ".chaperone.json": json({ extends: ["chaperone/nope"] }) });
    const message = loadError(cwd).message;
    expect(message).toContain('unknown built-in preset "chaperone/nope"');
    expect(message).toContain("chaperone/react-layered");
  });

  test("accepts extends as a single string", () => {
    const cwd = makeProject({ ".chaperone.json": json({ extends: "chaperone/package-essentials" }) });
    expect(ruleIds(cwd)).toEqual(["preset/required-scripts"]);
  });

  test("accumulates excludes from presets and the user config", () => {
    const cwd = makeProject({
      ".chaperone.json": json({ extends: ["./base.json"], exclude: ["generated"] }),
      "base.json": json({ exclude: ["vendor"] }),
    });
    const { config } = loadConfigWithDiagnostics(cwd);
    expect(config.exclude).toEqual(["vendor", "generated"]);
    expect(getEffectivePatterns(config).exclude).toEqual([
      "node_modules",
      ".git",
      "/dist",
      "/build",
      "vendor",
      "generated",
    ]);
  });

  test("reports unknown top-level fields as warnings", () => {
    const cwd = makeProject({ ".chaperone.json": json({ excludes: ["dist"] }) });
    const [warning] = loadConfigWithDiagnostics(cwd).diagnostics;
    expect(warning!.level).toBe("warning");
    expect(warning!.message).toContain('did you mean "exclude"');
  });
});
