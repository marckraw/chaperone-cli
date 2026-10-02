import { describe, expect, test } from "bun:test";
import { launcherCommand, resolveConfigPath, scanArgs } from "./argv";

describe("scanArgs", () => {
  test("finds --cwd and --config in both spellings", () => {
    expect(scanArgs(["check", "--cwd", "pkg", "-c", "ci.json"])).toEqual({
      command: "check",
      cwd: "pkg",
      config: "ci.json",
      jsonOutput: false,
    });
    expect(scanArgs(["analyze", "--cwd=pkg", "--config=ci.json"])).toMatchObject({ cwd: "pkg", config: "ci.json" });
  });

  test("knows when check prints JSON", () => {
    expect(scanArgs(["check", "--format", "json"]).jsonOutput).toBe(true);
    expect(scanArgs(["check", "-f", "json"]).jsonOutput).toBe(true);
    expect(scanArgs(["check", "--format=json"]).jsonOutput).toBe(true);
    expect(scanArgs(["check", "--format", "ai"]).jsonOutput).toBe(false);
    expect(scanArgs(["analyze", "--format", "json"]).jsonOutput).toBe(false);
  });

  test("does not take the command itself or other values for options", () => {
    expect(scanArgs(["--cwd"])).toEqual({ command: "--cwd", jsonOutput: false });
    expect(scanArgs(["check", "--since", "main"])).toEqual({ command: "check", jsonOutput: false });
  });

  test("reads each command's own options: -f is --force in init, not --format", () => {
    expect(scanArgs(["init", "-f", "--cwd", "packages/a"])).toEqual({ command: "init", cwd: "packages/a", jsonOutput: false });
    expect(scanArgs(["init", "--force", "--cwd=packages/a"])).toEqual({ command: "init", cwd: "packages/a", jsonOutput: false });
    expect(scanArgs(["analyze", "--api-key", "test-key", "--cwd", "pkg"])).toEqual({
      command: "analyze",
      cwd: "pkg",
      jsonOutput: false,
    });
    expect(scanArgs(["analyze", "-v", "--config", "ci.json"])).toEqual({ command: "analyze", config: "ci.json", jsonOutput: false });
  });

  test("never takes a value that starts with -, as the commands' parser does", () => {
    expect(scanArgs(["check", "--since", "--cwd", "pkg"])).toEqual({ command: "check", cwd: "pkg", jsonOutput: false });
    expect(scanArgs(["check", "--format", "--cwd", "pkg"])).toEqual({ command: "check", cwd: "pkg", jsonOutput: false });
    expect(scanArgs(["check", "-c", "--cwd", "pkg"])).toEqual({ command: "check", cwd: "pkg", jsonOutput: false });
    expect(scanArgs(["check", "--cwd", "-"])).toEqual({ command: "check", cwd: "-", jsonOutput: false });
  });
});

describe("resolveConfigPath", () => {
  test("reads the config the way check does", () => {
    expect(resolveConfigPath(scanArgs(["check"]), "/repo")).toBe("/repo/.chaperone.json");
    expect(resolveConfigPath(scanArgs(["check", "--cwd", "packages/a"]), "/repo")).toBe("/repo/packages/a/.chaperone.json");
    expect(resolveConfigPath(scanArgs(["check", "--cwd", "packages/a", "-c", "ci.json"]), "/repo")).toBe(
      "/repo/packages/a/ci.json"
    );
    expect(resolveConfigPath(scanArgs(["check", "--config", "/etc/c.json"]), "/repo")).toBe("/etc/c.json");
  });
});

describe("launcherCommand", () => {
  test("the launcher answers version, pin and cache itself", () => {
    expect(["version", "--version", "-v", "pin", "cache"].map(launcherCommand)).toEqual([
      "version",
      "version",
      "version",
      "pin",
      "cache",
    ]);
    expect(["check", "help", "--help", "init", "analyze", undefined].map(launcherCommand)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
