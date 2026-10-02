/**
 * The spawn path (Windows has no exec), exercised here on any platform with a fake binary, and the
 * check made before exec.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { fakeBinary, installIntoCache } from "../testing/fake-releases";
import { exitLikeChild, launchMode, signalHandling, spawnBinary, whyNotRunnable } from "./run-binary";

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

  posixTest("outside Windows, forwards a signal sent to the launcher, then stops listening", async () => {
    const before = process.listenerCount("SIGTERM");
    const running = spawnBinary(fake(), [], { ...process.env, FAKE_SILENT: "1", FAKE_MODE: "sleep" }, "linux");
    await Bun.sleep(300);
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    process.emit("SIGTERM", "SIGTERM");
    expect(await running).toEqual({ signal: "SIGTERM" });
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  posixTest("on Windows, survives Ctrl-C without passing it on: the child gets it from the console", async () => {
    const before = process.listenerCount("SIGINT");
    const env = { ...process.env, FAKE_SILENT: "1", FAKE_MODE: "sleep", FAKE_SLEEP_MS: "800", FAKE_EXIT: "3" };
    const running = spawnBinary(fake(), [], env, "win32");
    await Bun.sleep(300);
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    process.emit("SIGINT", "SIGINT");
    // Not killed: the child ran to its own end, and its exit code is the outcome
    expect(await running).toEqual({ exitCode: 3 });
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("signalHandling", () => {
  test("forwards outside Windows, and only swallows console signals on Windows", () => {
    expect(signalHandling("linux")).toEqual({ forward: ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"], swallow: [] });
    expect(signalHandling("darwin").forward).toContain("SIGINT");
    expect(signalHandling("win32")).toEqual({ forward: [], swallow: ["SIGINT", "SIGBREAK", "SIGHUP"] });
  });
});

describe("exitLikeChild", () => {
  test("returns the child's exit code", () => {
    expect(exitLikeChild({ exitCode: 2 })).toBe(2);
    expect(exitLikeChild({ exitCode: 0 })).toBe(0);
  });

  test("on Windows, reports a signal as 128 + its number instead of killing itself (exit code 1)", () => {
    expect(exitLikeChild({ signal: "SIGINT" }, "win32")).toBe(130);
    expect(exitLikeChild({ signal: "SIGTERM" }, "win32")).toBe(143);
  });
});

describe("whyNotRunnable", () => {
  posixTest("passes an executable file", () => {
    expect(whyNotRunnable(fake())).toBeNull();
  });

  posixTest("explains a missing file, a directory and a file without the execute bit", () => {
    const root = makeProject();
    expect(whyNotRunnable(join(root, "missing"))).toContain("ENOENT");
    mkdirSync(join(root, "dir"));
    expect(whyNotRunnable(join(root, "dir"))).toBe("it is not a file");
    const binary = fake();
    chmodSync(binary, 0o644);
    expect(whyNotRunnable(binary)).toContain("EACCES");
    // Windows has no execute bit to check
    expect(whyNotRunnable(binary, "win32")).toBeNull();
  });
});

describe("launchMode", () => {
  test("execs where the platform can, and spawns on Windows", () => {
    expect(launchMode()).toBe(process.platform === "win32" ? "spawn" : "exec");
  });
});
