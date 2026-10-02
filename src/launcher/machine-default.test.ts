/**
 * The machine default end to end: `bun src/cli.ts` (this checkout, as the installed chaperone)
 * where nothing is pinned and the machine default names a version, against a local release server
 * serving fake binaries. HOME (where the machine config file is), the cache and
 * CHAPERONE_DEFAULT_VERSION are the sandbox's: nothing here reads or writes the real ones, and
 * nothing downloads from GitHub.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import {
  ASSET,
  cachedFiles,
  fakeBinary,
  hasTerminal,
  installIntoCache,
  launcherBinary,
  machineConfigPath,
  offlineUrl,
  report,
  runChaperone,
  runOnTerminal,
  sandbox,
  startReleaseServer,
  writeMachineConfig,
  type ReleaseServer,
  type Run,
  type RunOptions,
  type Sandbox,
} from "../testing/fake-releases";
import { VERSION } from "../version";

const CLI = join(import.meta.dir, "..", "cli.ts");
const posixTest = process.platform === "win32" ? test.skip : test;
const terminalTest = hasTerminal ? test : test.skip;
// Each test starts several processes: give a slow CI runner room (bun's default is 5 s).
const SLOW = 20_000;

const servers: ReleaseServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  cleanupProjects();
});

function serve(...args: Parameters<typeof startReleaseServer>): ReleaseServer {
  const server = startReleaseServer(...args);
  servers.push(server);
  return server;
}

/** Run this checkout's launcher (`bun src/cli.ts`) as the installed chaperone. */
function chaperone(box: Sandbox, url: string, args: string[], options: RunOptions = {}): Promise<Run> {
  return runChaperone([process.execPath, CLI], box, url, args, options);
}

/** The machine config file as messages show it: under the sandbox's HOME, so `~/...`. */
function label(box: Sandbox): string {
  return process.platform === "win32" ? machineConfigPath(box) : "~/.config/chaperone/config.json";
}

/** A sandbox whose project pins nothing, with a machine default in its config file. */
function withDefault(version: string): Sandbox {
  const box = sandbox(null);
  writeMachineConfig(box, { defaultVersion: version });
  return box;
}

describe("running the machine default", () => {
  posixTest("where nothing is pinned: downloaded, verified, cached and run in this process, with the same arguments", async () => {
    const box = withDefault("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0") } });
    const args = ["check", "--format", "json", "two words", "", "--weird=a=b"];

    const run = await chaperone(box, server.url, args, { env: { FAKE_EXIT: "1" } });

    expect(run.stderr).toContain(`verified ${ASSET} 0.8.0`);
    expect(run.exitCode).toBe(1);
    // exec, exactly as for a pin: same pid, the recursion guard's marker, no update notice
    expect(report(run)).toMatchObject({ label: "0.8.0", argv: args, pid: run.pid, launched: `0.8.0 exec ${run.pid}`, noUpdateCheck: "1" });
    expect(server.requests).toEqual(["/v0.8.0/SHA256SUMS.txt", `/v0.8.0/${ASSET}`]);
    expect(cachedFiles(box, "0.8.0")).toEqual([ASSET]);

    // From then on from the cache: offline, and without a word on stderr
    const again = await chaperone(box, offlineUrl(), ["check"]);
    expect(report(again).label).toBe("0.8.0");
    expect(again.stderr).toBe("");
  }, SLOW);

  posixTest("also where there is no config at all (chaperone init included)", async () => {
    const box = { project: makeProject(), cache: makeProject(), home: makeProject() };
    writeMachineConfig(box, { defaultVersion: "0.8.0" });
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    const run = await chaperone(box, offlineUrl(), ["init", "--yes"]);
    expect(report(run)).toMatchObject({ label: "0.8.0", argv: ["init", "--yes"] });
    expect(existsSync(join(box.project, ".chaperone.json"))).toBe(false);
  }, SLOW);

  posixTest("CHAPERONE_DEFAULT_VERSION wins over the file, and a repository's pin over both", async () => {
    const box = withDefault("0.8.0");
    for (const version of ["0.8.0", "0.7.1", "0.9.0"]) installIntoCache(box.cache, version, fakeBinary(version));
    const env = { CHAPERONE_DEFAULT_VERSION: "0.7.1" };

    expect(report(await chaperone(box, offlineUrl(), ["check"])).label).toBe("0.8.0");
    expect(report(await chaperone(box, offlineUrl(), ["check"], { env })).label).toBe("0.7.1");
    // An empty variable is not set: the file decides
    expect(report(await chaperone(box, offlineUrl(), ["check"], { env: { CHAPERONE_DEFAULT_VERSION: "" } })).label).toBe("0.8.0");

    const pinned: Sandbox = { ...sandbox("0.9.0"), cache: box.cache, home: box.home };
    expect(report(await chaperone(pinned, offlineUrl(), ["check"], { env })).label).toBe("0.9.0");
  }, SLOW);

  posixTest("reads $XDG_CONFIG_HOME/chaperone/config.json when XDG_CONFIG_HOME is absolute, else ~/.config", async () => {
    const box = withDefault("0.8.0");
    const xdg = makeProject({ "chaperone/config.json": JSON.stringify({ defaultVersion: "0.7.1" }) });
    for (const version of ["0.8.0", "0.7.1"]) installIntoCache(box.cache, version, fakeBinary(version));

    expect(report(await chaperone(box, offlineUrl(), ["check"], { env: { XDG_CONFIG_HOME: xdg } })).label).toBe("0.7.1");
    expect(report(await chaperone(box, offlineUrl(), ["check"], { env: { XDG_CONFIG_HOME: "relative/dir" } })).label).toBe("0.8.0");
  }, SLOW);

  test("a default of this binary's version runs it, without the network", async () => {
    const box = withDefault(VERSION);
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).success).toBe(true);
    expect(run.stderr).toBe("");
    expect((await chaperone(box, offlineUrl(), ["--version"])).stdout).toBe(`chaperone v${VERSION} (machine default in ${label(box)})\n`);
  }, SLOW);

  posixTest("the recursion guard holds: a cached default that is not the version it claims fails", async () => {
    // The "0.8.0" in the cache is really this checkout: without the guard it would exec itself forever.
    const box = withDefault("0.8.0");
    installIntoCache(box.cache, "0.8.0", launcherBinary(CLI));
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`this binary was launched as Chaperone 0.8.0, but it is ${VERSION}`);
    expect(JSON.parse(run.stdout).error).toBe("pinned-version-unavailable");
  }, 15_000);

  test("CHAPERONE_IGNORE_PIN runs this binary instead, and says so, even with an invalid default", async () => {
    const box = withDefault("0.8.0");
    const ignore = { CHAPERONE_IGNORE_PIN: "1" };
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"], { env: ignore });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).success).toBe(true);
    expect(run.stderr).toContain(`CHAPERONE_IGNORE_PIN is set: running ${VERSION}, not 0.8.0 (the machine default in ${label(box)}).`);

    const invalid = await chaperone(box, offlineUrl(), ["check", "--format", "json"], { env: { ...ignore, CHAPERONE_DEFAULT_VERSION: "latest" } });
    expect(invalid.exitCode).toBe(0);
    expect(invalid.stderr).toContain("ignoring the machine default from CHAPERONE_DEFAULT_VERSION, which is invalid");
  }, SLOW);
});

describe("when the machine default cannot be used", () => {
  test("an invalid default stops the run with exit code 2, saying where it came from", async () => {
    const box = sandbox(null);
    const fromEnv = await chaperone(box, offlineUrl(), ["check"], { env: { CHAPERONE_DEFAULT_VERSION: "latest" } });
    expect(fromEnv.exitCode).toBe(2);
    expect(fromEnv.stdout).toBe("");
    expect(fromEnv.stderr).toContain(
      'chaperone: the machine default from CHAPERONE_DEFAULT_VERSION is invalid: CHAPERONE_DEFAULT_VERSION must be an exact version, such as "0.10.0" (got "latest")'
    );
    expect(fromEnv.stderr).toContain("set CHAPERONE_DEFAULT_VERSION to an exact version, or unset it");
    expect(fromEnv.stderr).toContain("Nothing ran.");

    writeMachineConfig(box, { defaultVersion: "^0.8" });
    const fromFile = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(fromFile.exitCode).toBe(2);
    expect(fromFile.stderr).toContain(`the machine default in ${label(box)} is invalid: "defaultVersion" must be an exact version`);
    expect(fromFile.stderr).toContain('(did you mean "0.8.0"?)');
    expect(JSON.parse(fromFile.stdout)).toMatchObject({ success: false, error: "invalid-machine-default", exitCode: 2 });

    writeMachineConfig(box, "{ not json");
    const broken = await chaperone(box, offlineUrl(), ["check"]);
    expect(broken.exitCode).toBe(2);
    expect(broken.stderr).toContain(`the machine default in ${label(box)} is invalid: the file is not valid JSON`);
  }, SLOW);

  test("a repository that pins is not affected by an invalid default", async () => {
    const pinned = sandbox(VERSION);
    writeMachineConfig(pinned, { defaultVersion: "latest" });
    const unpinned: Sandbox = { ...sandbox(null), home: pinned.home, cache: pinned.cache };

    expect((await chaperone(unpinned, offlineUrl(), ["check"])).exitCode).toBe(2);
    const run = await chaperone(pinned, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).success).toBe(true);
    expect((await chaperone(pinned, offlineUrl(), ["--version"])).stdout).toBe(`chaperone v${VERSION} (pinned in .chaperone.json)\n`);
  }, SLOW);

  test("offline without a cached copy: exit code 2, what to do, and never another version", async () => {
    const box = withDefault("0.8.0");
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`The machine default in ${label(box)} is Chaperone 0.8.0, which is not in the cache`);
    expect(run.stderr).toContain("Nothing ran: Chaperone never falls back to another version.");
    expect(JSON.parse(run.stdout).error).toBe("pinned-version-unavailable");
  }, SLOW);

  posixTest("refuses a download whose checksum does not match", async () => {
    const box = withDefault("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0"), sums: `${"f".repeat(64)}  ${ASSET}\n` } });
    const run = await chaperone(box, server.url, ["check"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`refused ${ASSET} for Chaperone 0.8.0`);
    expect(run.stdout).toBe("");
    expect(cachedFiles(box, "0.8.0")).toEqual([]);
  }, SLOW);
});

describe("chaperone --version with a machine default", () => {
  test("names the default first, where it comes from, then the launcher", async () => {
    const box = withDefault("0.8.0");
    expect((await chaperone(box, offlineUrl(), ["--version"])).stdout).toBe(
      `chaperone v0.8.0 (machine default in ${label(box)}, launched by v${VERSION}; downloaded on first use)\n`
    );
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    expect((await chaperone(box, offlineUrl(), ["version"])).stdout).toBe(
      `chaperone v0.8.0 (machine default in ${label(box)}, launched by v${VERSION})\n`
    );
    expect((await chaperone(box, offlineUrl(), ["-v"], { env: { CHAPERONE_DEFAULT_VERSION: "v0.8.0" } })).stdout).toBe(
      `chaperone v0.8.0 (machine default from CHAPERONE_DEFAULT_VERSION, launched by v${VERSION})\n`
    );
  }, SLOW);

  test("an invalid default: the reason, and exit code 2", async () => {
    const run = await chaperone(sandbox(null), offlineUrl(), ["--version"], { env: { CHAPERONE_DEFAULT_VERSION: "0.8" } });
    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe(
      `chaperone v${VERSION} (machine default from CHAPERONE_DEFAULT_VERSION: CHAPERONE_DEFAULT_VERSION must be an exact version, such as "0.10.0" (got "0.8") (did you mean "0.8.0"?))\n`
    );
  }, SLOW);
});

describe("chaperone default", () => {
  posixTest("downloads and verifies the version first, then writes it, keeping the file's other fields", async () => {
    const box = sandbox(null);
    const path = writeMachineConfig(box, { someOtherSetting: { keep: true } });
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0") } });

    const set = await chaperone(box, server.url, ["default", "v0.8.0"]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toBe(`Set the machine default to Chaperone 0.8.0 in ${label(box)}.\n`);
    expect(set.stderr).toContain(`verified ${ASSET} 0.8.0`);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ defaultVersion: "0.8.0", someOtherSetting: { keep: true } });
    expect(cachedFiles(box, "0.8.0")).toEqual([ASSET]);

    // Where nothing is pinned, it runs now, from the cache
    expect(report(await chaperone(box, offlineUrl(), ["check"])).label).toBe("0.8.0");

    const again = await chaperone(box, offlineUrl(), ["default", "0.8.0"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe(`The machine default is already Chaperone 0.8.0 (${label(box)}).\n`);
  }, SLOW);

  test("creates the file, and its directory, when there is none", async () => {
    const box = sandbox(null);
    const run = await chaperone(box, offlineUrl(), ["default", VERSION]);
    expect(run.exitCode).toBe(0);
    expect(readFileSync(machineConfigPath(box), "utf-8")).toBe(`{\n  "defaultVersion": "${VERSION}"\n}\n`);
  }, SLOW);

  test("shows the default and where it comes from", async () => {
    const box = sandbox(null);
    const none = await chaperone(box, offlineUrl(), ["default"]);
    expect(none.exitCode).toBe(0);
    expect(none.stdout).toStartWith(`No machine default: where nothing is pinned, this chaperone (${VERSION}) runs.`);

    writeMachineConfig(box, { defaultVersion: "0.8.0" });
    const fromFile = await chaperone(box, offlineUrl(), ["default"]);
    expect(fromFile.exitCode).toBe(0);
    expect(fromFile.stdout).toStartWith(`Machine default: Chaperone 0.8.0, in ${label(box)}.\n`);

    const fromEnv = await chaperone(box, offlineUrl(), ["default"], { env: { CHAPERONE_DEFAULT_VERSION: "0.7.1" } });
    expect(fromEnv.stdout).toStartWith(
      `Machine default: Chaperone 0.7.1, from CHAPERONE_DEFAULT_VERSION.\n(${label(box)} sets 0.8.0; CHAPERONE_DEFAULT_VERSION overrides it.)\n`
    );
  }, SLOW);

  test("--clear removes it and keeps the file's other fields; this checkout runs again", async () => {
    const box = sandbox(null);
    const path = writeMachineConfig(box, { defaultVersion: "0.8.0", someOtherSetting: 1 });

    const clear = await chaperone(box, offlineUrl(), ["default", "--clear"]);
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toBe(`Removed the machine default (0.8.0) from ${label(box)}. Where nothing is pinned, this chaperone (${VERSION}) runs.\n`);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ someOtherSetting: 1 });

    const again = await chaperone(box, offlineUrl(), ["default", "--clear"]);
    expect(again.stdout).toBe(`No machine default in ${label(box)}: nothing to remove.\n`);
    const check = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(JSON.parse(check.stdout).success).toBe(true);
  }, SLOW);

  test("never writes a version it could not download and verify", async () => {
    const box = sandbox(null);
    const offline = await chaperone(box, offlineUrl(), ["default", "0.8.0"]);
    expect(offline.exitCode).toBe(2);
    expect(offline.stderr).toContain("Setting the machine default to Chaperone 0.8.0, which is not in the cache");
    expect(offline.stderr).toContain(`${label(box)} was not changed.`);
    expect(existsSync(machineConfigPath(box))).toBe(false);
  }, SLOW);

  posixTest("refuses a version whose checksum does not match, or that has no release", async () => {
    const box = sandbox(null);
    const path = writeMachineConfig(box, { defaultVersion: VERSION });
    const before = readFileSync(path, "utf-8");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0"), sums: `${"f".repeat(64)}  ${ASSET}\n` } });

    const mismatch = await chaperone(box, server.url, ["default", "0.8.0"]);
    expect(mismatch.exitCode).toBe(2);
    expect(mismatch.stderr).toContain("does not match SHA256SUMS.txt");
    expect(cachedFiles(box, "0.8.0")).toEqual([]);

    const missing = await chaperone(box, server.url, ["default", "0.99.0"]);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Chaperone 0.99.0 has no release to download");
    expect(readFileSync(path, "utf-8")).toBe(before);
  }, SLOW);

  test("rejects versions that are not exact, and a version with --clear", async () => {
    const box = sandbox(null);
    const latest = await chaperone(box, offlineUrl(), ["default", "latest"]);
    expect(latest.exitCode).toBe(2);
    expect(latest.stderr).toContain('"defaultVersion" must be an exact version, such as "0.10.0" (got "latest")');
    expect((await chaperone(box, offlineUrl(), ["default", "^0.8"])).stderr).toContain('(did you mean "0.8.0"?)');
    const both = await chaperone(box, offlineUrl(), ["default", "0.8.0", "--clear"]);
    expect(both.exitCode).toBe(2);
    expect(both.stderr).toContain("--clear takes no version");
    expect(existsSync(machineConfigPath(box))).toBe(false);
  }, SLOW);

  test("an invalid default is shown with how to fix it (exit code 2), and setting one fixes it", async () => {
    const box = sandbox(null);
    writeMachineConfig(box, { default_version: VERSION });
    const show = await chaperone(box, offlineUrl(), ["default"]);
    expect(show.exitCode).toBe(2);
    expect(show.stderr).toContain(
      `the machine default in ${label(box)} is invalid: unknown field "default_version" (did you mean "defaultVersion"?)`
    );
    expect(show.stderr).toContain('Fix it with "chaperone default <version>", or remove it with "chaperone default --clear".');

    const fix = await chaperone(box, offlineUrl(), ["default", VERSION]);
    expect(fix.exitCode).toBe(0);
    expect(fix.stdout).toContain('replaced the misspelled "default_version"');
    expect(JSON.parse(readFileSync(machineConfigPath(box), "utf-8"))).toEqual({ defaultVersion: VERSION });
  }, SLOW);

  test("refuses to edit a file that is not valid JSON", async () => {
    const box = sandbox(null);
    const path = writeMachineConfig(box, "{ not json");
    const set = await chaperone(box, offlineUrl(), ["default", VERSION]);
    expect(set.exitCode).toBe(2);
    expect(set.stderr).toContain(`${label(box)} is not valid JSON`);
    expect((await chaperone(box, offlineUrl(), ["default", "--clear"])).exitCode).toBe(2);
    expect(readFileSync(path, "utf-8")).toBe("{ not json");
  }, SLOW);

  test("says when CHAPERONE_DEFAULT_VERSION overrides the file it writes", async () => {
    const box = sandbox(null);
    const run = await chaperone(box, offlineUrl(), ["default", VERSION], { env: { CHAPERONE_DEFAULT_VERSION: "0.7.1" } });
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain(`Note: CHAPERONE_DEFAULT_VERSION is set (0.7.1), and overrides ${label(box)} in this environment.`);
  }, SLOW);
});

describe("the hint with a machine default", () => {
  terminalTest("names the default after a text report on a terminal, and the version to pin", async () => {
    const box = withDefault(VERSION);
    const output = runOnTerminal([process.execPath, CLI], box, ["check"]);
    expect(output).toContain("PASSED");
    expect(output.match(/Tip: /g)?.length).toBe(1);
    expect(output).toContain(
      `Tip: this repository runs the machine default (Chaperone ${VERSION}, in ${label(box)}); pin it with "chaperone pin ${VERSION}"`
    );
  }, SLOW);
});
