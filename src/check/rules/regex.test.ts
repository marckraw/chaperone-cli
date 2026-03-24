import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runRegexRule } from "./regex";
import type { RegexRule } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runRegexRule", () => {
  test("mustMatch does not produce false positives across multi-file globs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "chaperone-regex-rule-"));
    tempDirs.push(cwd);

    const files = [
      ["apps/api/src/modules/a/a.route.ts", "operationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/b/b.route.ts", "operationId\noperationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/c/c.route.ts", "operationId\noperationId\noperationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/d/d.route.ts", "operationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/e/e.route.ts", "operationId\noperationId\noperationId\noperationId\n"],
      ["apps/api/src/modules/me/me.route.ts", "operationId\n"],
      ["apps/api/src/modules/task-activity/task-activity.route.ts", "operationId\n"],
    ] as const;

    for (const [file, content] of files) {
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
    }

    const rule: RegexRule = {
      type: "regex",
      id: "test-must-match",
      severity: "error",
      files: "apps/api/src/modules/*/*.route.ts",
      pattern: "operationId",
      mustMatch: true,
      message: "Must have operationId",
    };

    const result = await runRegexRule(rule, {
      cwd,
      include: [],
      exclude: [],
    });

    expect(result.results).toHaveLength(0);
  });
});
