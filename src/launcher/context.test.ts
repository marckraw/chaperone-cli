/**
 * Reading the machine default from the environment and the machine config file. HOME and
 * XDG_CONFIG_HOME are temporary directories passed in: the real ones are never read.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { machineConfigFile, readMachineDefault } from "./context";

afterEach(cleanupProjects);

const posixTest = process.platform === "win32" ? test.skip : test;

/** A home directory whose ~/.config/chaperone/config.json sets `version`. */
function homeWithDefault(version: string): string {
  return makeProject({ ".config/chaperone/config.json": JSON.stringify({ defaultVersion: version }) });
}

describe("readMachineDefault", () => {
  posixTest("reads ~/.config/chaperone/config.json, shown as ~/...", () => {
    expect(readMachineDefault({}, homeWithDefault("0.7.1"))).toEqual({
      kind: "set",
      version: "0.7.1",
      origin: { kind: "file", label: "~/.config/chaperone/config.json" },
    });
  });

  test("CHAPERONE_DEFAULT_VERSION wins over the file; an empty one does not count", () => {
    const home = homeWithDefault("0.7.1");
    expect(readMachineDefault({ CHAPERONE_DEFAULT_VERSION: "0.8.0" }, home)).toEqual({
      kind: "set",
      version: "0.8.0",
      origin: { kind: "env" },
    });
    expect(readMachineDefault({ CHAPERONE_DEFAULT_VERSION: "" }, home)).toMatchObject({ kind: "set", version: "0.7.1" });
    // An invalid variable is invalid, whatever the file says: it never falls back to the file
    expect(readMachineDefault({ CHAPERONE_DEFAULT_VERSION: "latest" }, home)).toMatchObject({ kind: "invalid", origin: { kind: "env" } });
  });

  test("an absolute XDG_CONFIG_HOME holds the file instead", () => {
    const xdg = makeProject({ "chaperone/config.json": JSON.stringify({ defaultVersion: "0.8.0" }) });
    const home = homeWithDefault("0.7.1");
    expect(readMachineDefault({ XDG_CONFIG_HOME: xdg }, home)).toMatchObject({ kind: "set", version: "0.8.0" });
    expect(machineConfigFile({ XDG_CONFIG_HOME: xdg }, home).path).toBe(join(xdg, "chaperone", "config.json"));
  });

  test("no file: no default", () => {
    expect(readMachineDefault({}, makeProject())).toEqual({ kind: "none" });
  });

  posixTest("a file that cannot be read is invalid, never 'no default'", () => {
    const home = makeProject();
    mkdirSync(join(home, ".config", "chaperone", "config.json"), { recursive: true });
    const result = readMachineDefault({}, home);
    expect(result).toMatchObject({ kind: "invalid", origin: { kind: "file", label: "~/.config/chaperone/config.json" } });
    expect(result.kind === "invalid" && result.message).toStartWith("the file cannot be read (");
  });
});
