import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { check } from "./index";

afterEach(cleanupProjects);

describe("check orchestration", () => {
  test("command rules start after the tool runners have finished", async () => {
    const tool = `#!/bin/sh\necho "tsc start" >> "$(dirname "$0")/../../order.log"\nsleep 0.3\necho "tsc end" >> "$(dirname "$0")/../../order.log"\n`;
    const cwd = makeProject({
      "tsconfig.json": '{ "include": ["src"] }',
      "node_modules/.bin/tsc": tool,
      ".chaperone.json": JSON.stringify({
        version: "1.0.0",
        rules: {
          custom: [
            {
              type: "command",
              id: "writes-files",
              severity: "error",
              command: "sh",
              args: ["-c", 'echo "command" >> order.log'],
            },
          ],
        },
      }),
    });
    chmodSync(join(cwd, "node_modules/.bin/tsc"), 0o755);

    const summary = await check({ cwd, format: "json" });

    expect(summary.success).toBe(true);
    expect(readFileSync(join(cwd, "order.log"), "utf-8").trim().split("\n")).toEqual([
      "tsc start",
      "tsc end",
      "command",
    ]);
  });
});
