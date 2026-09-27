import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "../check/config-loader";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { analyze } from "./index";
import { mergeRulesIntoRawConfig } from "./config-merger";
import { customRuleSchema } from "./schemas";
import type { ExtractionResponse } from "./types";

afterEach(cleanupProjects);

const NEW_RULE = {
  type: "regex",
  id: "no-console-log",
  severity: "error",
  files: "src/**/*.ts",
  pattern: "console\\.log\\(",
  message: "No console.log",
  source: "CLAUDE.md",
  originalText: "Do not use console.log",
};

function extractor(rules: unknown[]) {
  return async (): Promise<ExtractionResponse> => ({ rules, summary: "test", skipped: [] });
}

const readConfig = (cwd: string) => readFileSync(join(cwd, ".chaperone.json"), "utf-8");

describe("analyze", () => {
  test("patches only the user's own file: extends is kept and presets are not inlined", async () => {
    const original = {
      version: "1.0.0",
      extends: ["chaperone/pure-functions"],
      exclude: ["generated"],
      rules: { custom: [{ id: "mine", type: "package-fields", severity: "warning", requiredFields: ["name"] }] },
    };
    const cwd = makeProject({
      ".chaperone.json": JSON.stringify(original, null, 2),
      "CLAUDE.md": "Do not use console.log.\n",
    });

    const result = await analyze({ cwd, extract: extractor([NEW_RULE]) });

    expect(result.written).toBe(true);
    const written = JSON.parse(readConfig(cwd));
    expect(written.extends).toEqual(["chaperone/pure-functions"]);
    expect(written.exclude).toEqual(["generated"]);
    expect(written.rules.custom.map((rule: { id: string }) => rule.id)).toEqual(["mine", "no-console-log"]);
  });

  test("writes nothing when the existing config does not load", async () => {
    const broken = JSON.stringify({ rules: { custom: [{ id: "old", type: "relationship", severity: "error" }] } });
    const cwd = makeProject({ ".chaperone.json": broken, "CLAUDE.md": "Do not use console.log.\n" });

    await expect(analyze({ cwd, extract: extractor([NEW_RULE]) })).rejects.toBeInstanceOf(ConfigError);
    expect(readConfig(cwd)).toBe(broken);
  });

  test("writes nothing when the config is not valid JSON", async () => {
    const cwd = makeProject({ ".chaperone.json": "{ nope", "CLAUDE.md": "x\n" });
    await expect(analyze({ cwd, extract: extractor([NEW_RULE]) })).rejects.toBeInstanceOf(ConfigError);
    expect(readConfig(cwd)).toBe("{ nope");
  });

  test("rejects extracted rules that fail the config schema", async () => {
    const cwd = makeProject({ ".chaperone.json": JSON.stringify({ version: "1.0.0" }), "CLAUDE.md": "x\n" });
    const invalid = { ...NEW_RULE, id: "broken", files: undefined };

    const result = await analyze({ cwd, extract: extractor([invalid]) });

    expect(result.written).toBe(false);
    expect(result.addedRules).toEqual([]);
    expect(result.skippedInstructions[0]!.reason).toContain('missing required field "files"');
    expect(JSON.parse(readConfig(cwd))).toEqual({ version: "1.0.0" });
  });

  test("does not reuse ids of preset rules", async () => {
    const cwd = makeProject({
      ".chaperone.json": JSON.stringify({ extends: ["chaperone/pure-functions"] }),
      "CLAUDE.md": "x\n",
    });
    const result = await analyze({
      cwd,
      extract: extractor([{ ...NEW_RULE, id: "preset/pure-no-api-imports" }]),
    });
    expect(result.addedRules).toEqual([]);
    expect(result.skippedRules[0]!.reason).toContain("used by an extended preset");
  });

  test("--dry-run writes nothing", async () => {
    const cwd = makeProject({ ".chaperone.json": JSON.stringify({ version: "1.0.0" }), "CLAUDE.md": "x\n" });
    const result = await analyze({ cwd, dryRun: true, extract: extractor([NEW_RULE]) });
    expect(result.addedRules).toHaveLength(1);
    expect(result.written).toBe(false);
    expect(JSON.parse(readConfig(cwd))).toEqual({ version: "1.0.0" });
  });

  test("creates a minimal config when none exists", async () => {
    const cwd = makeProject({ "CLAUDE.md": "x\n" });
    await analyze({ cwd, extract: extractor([NEW_RULE]) });
    expect(existsSync(join(cwd, ".chaperone.json"))).toBe(true);
    expect(JSON.parse(readConfig(cwd))).toEqual({ version: "1.0.0", rules: { custom: [NEW_RULE] } });
  });
});

describe("mergeRulesIntoRawConfig", () => {
  test("force replaces AI-generated rules and keeps hand-written ones", () => {
    const raw = {
      extends: ["chaperone/pure-functions"],
      rules: {
        custom: [
          { id: "manual", type: "command", severity: "error", command: "true" },
          { id: "old-ai", type: "regex", severity: "error", files: "a", pattern: "b", message: "c", source: "CLAUDE.md" },
        ],
      },
    };
    const { config, added } = mergeRulesIntoRawConfig(raw, [NEW_RULE as never], { force: true });
    expect(added).toHaveLength(1);
    expect((config["rules"] as { custom: Array<{ id: string }> }).custom.map((rule) => rule.id)).toEqual([
      "manual",
      "no-console-log",
    ]);
    expect(config["extends"]).toEqual(["chaperone/pure-functions"]);
  });
});

describe("analyze schema", () => {
  test("is restricted to the rule types analyze supports", () => {
    expect(customRuleSchema.safeParse(NEW_RULE).success).toBe(true);
    expect(
      customRuleSchema.safeParse({ type: "import-boundary", id: "x", severity: "error", layers: {} }).success
    ).toBe(false);
  });
});
