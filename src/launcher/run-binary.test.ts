/**
 * The spawn fallback (Windows has no exec): exercised here on any platform with a fake binary.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { fakeBinary, installIntoCache } from "../testing/fake-releases";
import { exitLikeChild, launchMode, spawnBinary } from "./run-binary";

const posixTest = process.platform === "win32" ? test.skip : test;

afterEach(cleanupProjects);

function fake(): string {
  return installIntoCache(join(makeProject(), "cache"), "0.8.0", fakeBinary("0.8.0"));
}

describe("spawnBinary", () => {
  posixTest("reports the child's exit code, 2 included", async () => {
    const binary = fake();
    for (const code of [0, 2, 7]) {
      const env = { ...process.env, FAKE_SILENT: "1", FAKE_EXIT: String(code) };
      expect(await spawnBinary(binary, ["check"], env)).toEqual({ exitCode: code });
    }
  });

  posixTest("reports the signal that ended the child", async () => {
    const outcome = await spawnBinary(fake(), [], { ...process.env, FAKE_SILENT: "1", FAKE_MODE: "kill-self" });
    expect(outcome).toEqual({ signal: "SIGTERM" });
  });

  posixTest("forwards a signal sent to the launcher, then stops listening", async () => {
    const before = process.listenerCount("SIGTERM");
    const running = spawnBinary(fake(), [], { ...process.env, FAKE_SILENT: "1", FAKE_MODE: "sleep" });
    await Bun.sleep(300);
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    process.emit("SIGTERM", "SIGTERM");
    expect(await running).toEqual({ signal: "SIGTERM" });
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});

describe("exitLikeChild", () => {
  test("returns the child's exit code", () => {
    expect(exitLikeChild({ exitCode: 2 })).toBe(2);
    expect(exitLikeChild({ exitCode: 0 })).toBe(0);
  });
});

describe("launchMode", () => {
  test("execs where the platform can, and spawns on Windows", () => {
    expect(launchMode()).toBe(process.platform === "win32" ? "spawn" : "exec");
  });
});
