import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import { validateRule } from "../config-schema";
import type { UniqueCaptureRule } from "../types";
import { findDuplicateCaptures, runUniqueCaptureRule } from "./unique-capture";
import { createRuleContext } from "./utils/rule-context";

afterEach(cleanupProjects);

const MIGRATIONS: UniqueCaptureRule = {
  type: "unique-capture",
  id: "migration-numbers",
  severity: "error",
  files: "packages/db/drizzle/*.sql",
  capture: { pattern: "^(\\d{4})_", source: "basename" },
  message: "Two migrations share a number: generate yours again after master's",
};

describe("findDuplicateCaptures", () => {
  test("groups the files that share a key, and only those", () => {
    const duplicates = findDuplicateCaptures(
      ["d/0016_meet.sql", "d/0015_mentions.sql", "d/0016_files.sql", "d/notes.sql"],
      { pattern: "^(\\d{4})_", source: "basename" }
    );
    expect([...duplicates]).toEqual([["0016", ["d/0016_files.sql", "d/0016_meet.sql"]]]);
  });

  test("captures from the whole path by default, with any group", () => {
    const duplicates = findDuplicateCaptures(["docs/adr/7-a.md", "docs/adr/7-b.md", "docs/adr/8-c.md"], {
      pattern: "adr/((\\d+))-",
      group: 2,
    });
    expect([...duplicates.keys()]).toEqual(["7"]);
  });
});

describe("runUniqueCaptureRule", () => {
  test("reports each shared key once, at its first file, with every file that shares it", async () => {
    const cwd = makeProject({
      "packages/db/drizzle/0015_mentions.sql": "",
      "packages/db/drizzle/0016_meet.sql": "",
      "packages/db/drizzle/0016_files.sql": "",
      "packages/db/drizzle/0017_a.sql": "",
      "packages/db/drizzle/0017_b.sql": "",
      "packages/db/drizzle/0017_c.sql": "",
    });
    const result = await runUniqueCaptureRule(MIGRATIONS, { cwd, include: [], exclude: [] });
    expect(result.filesChecked).toBe(6);
    expect(result.results.map(({ file, message, context }) => ({ file, message, locations: context?.locations }))).toEqual([
      {
        file: "packages/db/drizzle/0016_files.sql",
        message: `${MIGRATIONS.message} (2 files share the key "0016")`,
        locations: ["packages/db/drizzle/0016_files.sql", "packages/db/drizzle/0016_meet.sql"],
      },
      {
        file: "packages/db/drizzle/0017_a.sql",
        message: `${MIGRATIONS.message} (3 files share the key "0017")`,
        locations: ["packages/db/drizzle/0017_a.sql", "packages/db/drizzle/0017_b.sql", "packages/db/drizzle/0017_c.sql"],
      },
    ]);
    const { message: _message, ...plain } = MIGRATIONS;
    const without = await runUniqueCaptureRule(plain, { cwd, include: [], exclude: [] });
    expect(without.results[0]!.message).toBe('2 files share the key "0016"');
  });

  test("under --since, reports a key when one of its files changed", async () => {
    const cwd = makeProject({
      "packages/db/drizzle/0016_meet.sql": "",
      "packages/db/drizzle/0016_files.sql": "",
      "packages/db/drizzle/0017_a.sql": "",
      "packages/db/drizzle/0017_b.sql": "",
    });
    const context = createRuleContext(cwd, [], { changedFiles: new Set(["packages/db/drizzle/0017_b.sql"]) });
    const result = await runUniqueCaptureRule(MIGRATIONS, { cwd, include: [], exclude: [], context });
    expect(result.results.map((entry) => entry.context?.matchedText)).toEqual(["0017"]);
  });

  test("passes a folder where every key is its own", async () => {
    const cwd = makeProject({ "packages/db/drizzle/0000_init.sql": "", "packages/db/drizzle/0001_auth.sql": "" });
    const result = await runUniqueCaptureRule(MIGRATIONS, { cwd, include: [], exclude: [] });
    expect(result.results).toEqual([]);
  });

  test("validation rejects an invalid capture pattern", () => {
    const { diagnostics } = validateRule({ ...MIGRATIONS, capture: { pattern: "(\\d{4}" } }, ".chaperone.json", ["rules", "custom", 0]);
    expect(diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(true);
  });
});
