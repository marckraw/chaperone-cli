/**
 * The launcher end to end: `bun src/cli.ts` (this checkout, as the installed chaperone) in a
 * project that pins another version, against a local release server serving fake binaries.
 * Nothing here downloads from GitHub or touches a real cache: HOME and CHAPERONE_CACHE_DIR are
 * temporary directories.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import {
  ASSET,
  cachedFiles,
  fakeBinary,
  hasTerminal,
  installIntoCache,
  launcherBinary,
  offlineUrl,
  report,
  runChaperone,
  runOnTerminal,
  sandbox,
  startReleaseServer,
  type ReleaseServer,
  type Run,
  type RunOptions,
  type Sandbox,
} from "../testing/fake-releases";
import { VERSION } from "../version";

const CLI = join(import.meta.dir, "..", "cli.ts");
const posixTest = process.platform === "win32" ? test.skip : test;
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

describe("launching a pinned version", () => {
  posixTest("downloads, verifies and caches it, then runs it with the same arguments", async () => {
    const box = sandbox("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0") } });
    const args = ["check", "--format", "json", "two words", "", "ünïcödé", "--weird=a=b", "-c", ".chaperone.json", "$HOME", "*"];

    const run = await chaperone(box, server.url, args);

    expect(run.stderr).toContain(`verified ${ASSET} 0.8.0`);
    expect(run.exitCode).toBe(0);
    expect(report(run).label).toBe("0.8.0");
    expect(report(run).argv).toEqual(args);
    expect(server.requests).toEqual(["/v0.8.0/SHA256SUMS.txt", `/v0.8.0/${ASSET}`]);
    expect(cachedFiles(box, "0.8.0")).toEqual([ASSET]);
    expect(readFileSync(join(box.cache, "0.8.0", ASSET), "utf-8")).toBe(fakeBinary("0.8.0"));
    expect(statSync(join(box.cache, "0.8.0", ASSET)).mode & 0o111).not.toBe(0);
  }, SLOW);

  posixTest("runs the cached copy without the network", async () => {
    const box = sandbox("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0") } });
    expect((await chaperone(box, server.url, ["check"])).exitCode).toBe(0);
    const requests = server.requests.length;

    const run = await chaperone(box, offlineUrl(), ["check", "--since", "main"]);
    expect(run.exitCode).toBe(0);
    expect(report(run)).toMatchObject({ label: "0.8.0", argv: ["check", "--since", "main"] });
    expect(run.stderr).toBe("");
    expect(server.requests.length).toBe(requests);
  }, SLOW);

  posixTest("passes the exit code through, 2 included", async () => {
    const box = sandbox("0.8.0");
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    for (const code of [0, 1, 2, 7]) {
      const run = await chaperone(box, offlineUrl(), ["check"], { env: { FAKE_EXIT: String(code) } });
      expect(run.exitCode).toBe(code);
    }
  }, SLOW);

  posixTest("the pinned binary takes over the process: pid, environment and working directory", async () => {
    const box = sandbox("0.8.0");
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    const run = await chaperone(box, offlineUrl(), ["check"], {
      env: { FAKE_PASSTHROUGH: "kept", CHAPERONE_NO_UPDATE_CHECK: undefined },
    });

    const fake = report(run);
    expect(fake.pid).toBe(run.pid);
    expect(fake.cwd).toBe(realpathSync(box.project));
    expect(fake.passthrough).toBe("kept");
    // The recursion guard's marker, made for this pid
    expect(fake.launched).toBe(`0.8.0 exec ${run.pid}`);
    // Versions before 0.10 know nothing of pins: their "update available" notice would mislead
    expect(fake.noUpdateCheck).toBe("1");
  }, SLOW);

  posixTest("signals reach the pinned binary, and the run ends by the same signal", async () => {
    const box = sandbox("0.8.0");
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));

    const killed = await chaperone(box, offlineUrl(), ["check"], { env: { FAKE_MODE: "kill-self" } });
    expect(killed.signalCode).toBe("SIGTERM");

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      const run = await chaperone(box, offlineUrl(), ["check"], {
        env: { FAKE_MODE: "sleep" },
        onFirstLine: (child) => child.kill(signal),
      });
      expect(report(run).label).toBe("0.8.0");
      expect(run.signalCode).toBe(signal);
    }
  }, SLOW);

  posixTest("reads the pin through --cwd and --config, as check does", async () => {
    const box = sandbox("0.8.0");
    writeFileSync(join(box.project, "ci.json"), JSON.stringify({ chaperoneVersion: "0.7.1", version: "1.0.0" }));
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    installIntoCache(box.cache, "0.7.1", fakeBinary("0.7.1"));
    const elsewhere = makeProject();

    const viaCwd = await chaperone(box, offlineUrl(), ["check", "--cwd", box.project], { cwd: elsewhere });
    expect(report(viaCwd).label).toBe("0.8.0");

    const viaConfig = await chaperone(box, offlineUrl(), ["check", "--cwd", box.project, "-c", "ci.json"], { cwd: elsewhere });
    expect(report(viaConfig).label).toBe("0.7.1");

    // Without --cwd, the directory has no config: nothing is pinned and this checkout runs
    const unpinned = await chaperone(box, offlineUrl(), ["check", "--format", "json"], { cwd: elsewhere });
    expect(JSON.parse(unpinned.stdout).success).toBe(true);
  }, SLOW);

  posixTest("reads each command's own options: init -f is --force, so --cwd still counts", async () => {
    // The root pins 0.8.0 and the package 0.7.1: `init -f --cwd packages/a` must run 0.7.1.
    const box = sandbox("0.8.0");
    const pkg = join(box.project, "packages", "a");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, ".chaperone.json"), JSON.stringify({ chaperoneVersion: "0.7.1" }));
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    installIntoCache(box.cache, "0.7.1", fakeBinary("0.7.1"));

    const run = await chaperone(box, offlineUrl(), ["init", "-f", "--cwd", "packages/a"]);
    expect(report(run)).toMatchObject({ label: "0.7.1", argv: ["init", "-f", "--cwd", "packages/a"] });
  }, SLOW);

  posixTest("two runs at once both succeed and leave one verified binary", async () => {
    const box = sandbox("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0") } }, { holdBinariesUntil: 2 });

    const runs = await Promise.all([
      chaperone(box, server.url, ["check", "first"]),
      chaperone(box, server.url, ["check", "second"]),
    ]);

    expect(runs.map((run) => run.exitCode)).toEqual([0, 0]);
    expect(runs.map((run) => report(run).argv[1])).toEqual(["first", "second"]);
    // Both downloaded at the same time, and both renamed into place
    expect(server.requests.filter((path) => path.endsWith(ASSET)).length).toBe(2);
    expect(cachedFiles(box, "0.8.0")).toEqual([ASSET]);
    expect(readFileSync(join(box.cache, "0.8.0", ASSET), "utf-8")).toBe(fakeBinary("0.8.0"));
  }, SLOW);
});

describe("when the pinned version cannot be installed", () => {
  posixTest("refuses a binary whose checksum does not match", async () => {
    const box = sandbox("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0"), sums: `${"f".repeat(64)}  ${ASSET}\n` } });

    const run = await chaperone(box, server.url, ["check"]);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`refused ${ASSET} for Chaperone 0.8.0`);
    expect(run.stderr).toContain("does not match SHA256SUMS.txt");
    expect(run.stdout).toBe("");
    // Nothing installed, nothing left behind
    expect(cachedFiles(box, "0.8.0")).toEqual([]);
  }, SLOW);

  posixTest("refuses a release whose SHA256SUMS.txt has no entry for this platform", async () => {
    const box = sandbox("0.8.0");
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0"), sums: `${"f".repeat(64)}  chaperone-plan9-mips\n` } });
    const run = await chaperone(box, server.url, ["check"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`has no entry for ${ASSET}`);
    expect(server.requests).toEqual(["/v0.8.0/SHA256SUMS.txt"]);
  }, SLOW);

  posixTest("a pin with no release fails with exit code 2", async () => {
    const box = sandbox("0.99.0");
    const server = serve({});
    const run = await chaperone(box, server.url, ["check"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("Chaperone 0.99.0 has no release to download");
  }, SLOW);

  test("offline without a cached copy: exit code 2, what to do, and never another version", async () => {
    const box = sandbox("0.8.0");
    const run = await chaperone(box, offlineUrl(), ["check"]);

    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(".chaperone.json pins Chaperone 0.8.0, which is not in the cache");
    expect(run.stderr).toContain("Nothing ran: Chaperone never falls back to another version.");
    expect(run.stderr).toContain("Run again once 127.0.0.1");
    expect(run.stderr).toContain("CHAPERONE_RELEASES_URL");
  }, SLOW);

  test("offline with --format json: the reason is the one JSON document on stdout", async () => {
    const box = sandbox("0.8.0");
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(2);
    const json = JSON.parse(run.stdout);
    expect(json).toMatchObject({ success: false, error: "pinned-version-unavailable", exitCode: 2 });
    expect(json.message).toContain("never falls back to another version");
  }, SLOW);

  posixTest("a cached binary that cannot be run fails with exit code 2 and says why (Bun would abort)", async () => {
    // As on a cache mounted noexec: execve would fail, and Bun aborts on that (exit code 134).
    const box = sandbox("0.8.0");
    chmodSync(installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0")), 0o644);
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("cannot run Chaperone 0.8.0");
    expect(run.stderr).toContain("noexec");
    expect(JSON.parse(run.stdout).error).toBe("pinned-version-unavailable");
  }, SLOW);
});

describe("the recursion guard", () => {
  test("a pin equal to this binary's version runs it, without the network", async () => {
    const box = sandbox(VERSION);
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).success).toBe(true);
    expect(run.stderr).toBe("");
  }, SLOW);

  posixTest("a cached binary that is not the version it claims fails instead of launching again", async () => {
    const box = sandbox("0.8.0");
    // The "0.8.0" in the cache is really this checkout: without the guard it would exec itself forever.
    installIntoCache(box.cache, "0.8.0", launcherBinary(CLI));
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(`this binary was launched as Chaperone 0.8.0, but it is ${VERSION}`);
    expect(JSON.parse(run.stdout).error).toBe("pinned-version-unavailable");
  }, 15_000);

  posixTest("a marker inherited from another process is ignored", async () => {
    const box = sandbox("0.8.0");
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    const run = await chaperone(box, offlineUrl(), ["check"], { env: { CHAPERONE_LAUNCHED: "0.8.0 exec 1" } });
    expect(run.exitCode).toBe(0);
    expect(report(run).launched).toBe(`0.8.0 exec ${run.pid}`);
  }, SLOW);

  test("CHAPERONE_IGNORE_PIN runs this binary, and says so", async () => {
    const box = sandbox("0.8.0");
    const run = await chaperone(box, offlineUrl(), ["check", "--format", "json"], { env: { CHAPERONE_IGNORE_PIN: "1" } });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout).success).toBe(true);
    expect(run.stderr).toContain(`CHAPERONE_IGNORE_PIN is set: running ${VERSION}, not 0.8.0`);
  }, SLOW);
});

describe("chaperone --version", () => {
  test("names the version that runs here, then the launcher's", async () => {
    const box = sandbox("0.8.0");
    expect((await chaperone(box, offlineUrl(), ["--version"])).stdout).toBe(
      `chaperone v0.8.0 (pinned in .chaperone.json, launched by v${VERSION}; downloaded on first use)\n`
    );
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    expect((await chaperone(box, offlineUrl(), ["version"])).stdout).toBe(
      `chaperone v0.8.0 (pinned in .chaperone.json, launched by v${VERSION})\n`
    );
  }, SLOW);

  test("reads the config --cwd and --config name", async () => {
    const box = sandbox("0.8.0");
    writeFileSync(join(box.project, "ci.json"), JSON.stringify({ chaperoneVersion: "0.7.1" }));
    const elsewhere = makeProject();
    const viaCwd = await chaperone(box, offlineUrl(), ["--version", "--cwd", box.project], { cwd: elsewhere });
    expect(viaCwd.stdout).toStartWith("chaperone v0.8.0 (pinned in ");
    const viaConfig = await chaperone(box, offlineUrl(), ["version", "-c", "ci.json"]);
    expect(viaConfig.stdout).toStartWith("chaperone v0.7.1 (pinned in ci.json, ");
  }, SLOW);

  test("without a pin, and with an invalid one (exit code 2)", async () => {
    expect((await chaperone(sandbox(null), offlineUrl(), ["-v"])).stdout).toBe(
      `chaperone v${VERSION} (not pinned: "chaperone pin" pins it in .chaperone.json)\n`
    );
    const invalid = await chaperone(sandbox("latest"), offlineUrl(), ["--version"]);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stdout).toContain('"chaperoneVersion" must be an exact version');
  }, SLOW);
});

describe("chaperone pin", () => {
  test("pins this binary's version, keeping the file's formatting", async () => {
    const box = sandbox(null);
    const configPath = join(box.project, ".chaperone.json");
    writeFileSync(configPath, '{\n    "version": "1.0.0",\n    "rules": { "custom": [] }\n}\n');

    const run = await chaperone(box, offlineUrl(), ["pin"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(`Pinned Chaperone ${VERSION} in .chaperone.json.\n`);
    expect(readFileSync(configPath, "utf-8")).toBe(
      `{\n    "chaperoneVersion": "${VERSION}",\n    "version": "1.0.0",\n    "rules": { "custom": [] }\n}\n`
    );

    const again = await chaperone(box, offlineUrl(), ["pin"]);
    expect(again.stdout).toBe(`.chaperone.json already pins Chaperone ${VERSION}.\n`);
  }, SLOW);

  posixTest("installs another version before pinning it (v-prefix accepted)", async () => {
    const box = sandbox(VERSION);
    const server = serve({ "0.8.0": { binary: fakeBinary("0.8.0") } });
    const run = await chaperone(box, server.url, ["pin", "v0.8.0"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(`Pinned Chaperone 0.8.0 in .chaperone.json (was ${VERSION}).\n`);
    expect(JSON.parse(readFileSync(join(box.project, ".chaperone.json"), "utf-8")).chaperoneVersion).toBe("0.8.0");
    expect(cachedFiles(box, "0.8.0")).toEqual([ASSET]);
  }, SLOW);

  test("never writes a pin it could not install", async () => {
    const box = sandbox(null);
    const configPath = join(box.project, ".chaperone.json");
    const before = readFileSync(configPath, "utf-8");
    const run = await chaperone(box, offlineUrl(), ["pin", "0.8.0"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain(".chaperone.json was not changed.");
    expect(readFileSync(configPath, "utf-8")).toBe(before);
  }, SLOW);

  test("rejects versions that are not exact, and a missing config", async () => {
    const latest = await chaperone(sandbox(null), offlineUrl(), ["pin", "latest"]);
    expect(latest.exitCode).toBe(2);
    expect(latest.stderr).toContain('"chaperoneVersion" must be an exact version');

    const range = await chaperone(sandbox(null), offlineUrl(), ["pin", "^0.8"]);
    expect(range.stderr).toContain('(did you mean "0.8.0"?)');

    const empty = { project: makeProject(), cache: makeProject(), home: makeProject() };
    const missing = await chaperone(empty, offlineUrl(), ["pin"]);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('Run "chaperone init" first');
  }, SLOW);
});

describe("chaperone cache", () => {
  test("lists and clears cached versions, removing only its own files", async () => {
    const box = sandbox(null);
    installIntoCache(box.cache, "0.8.0", fakeBinary("0.8.0"));
    installIntoCache(box.cache, "0.10.0", fakeBinary("0.10.0"));
    writeFileSync(join(box.cache, "0.10.0", "notes.txt"), "not ours");
    writeFileSync(join(box.cache, "README"), "not ours either");

    const list = await chaperone(box, offlineUrl(), ["cache"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain(`Chaperone cache: ${box.cache}`);
    expect(list.stdout.indexOf("0.10.0")).toBeLessThan(list.stdout.indexOf("0.8.0"));
    expect(list.stdout).toContain("2 versions");

    const one = await chaperone(box, offlineUrl(), ["cache", "clear", "v0.8.0"]);
    expect(one.stdout).toContain("Removed Chaperone 0.8.0");
    expect(existsSync(join(box.cache, "0.8.0"))).toBe(false);
    expect(cachedFiles(box, "0.10.0")).toEqual([ASSET, "notes.txt"]);

    const all = await chaperone(box, offlineUrl(), ["cache", "clear"]);
    expect(all.exitCode).toBe(0);
    expect(cachedFiles(box, "0.10.0")).toEqual(["notes.txt"]);
    expect(existsSync(join(box.cache, "README"))).toBe(true);
  }, SLOW);
});

describe("the hint to pin", () => {
  test("never appears in machine output or when stderr is not a terminal", async () => {
    const box = sandbox(null);
    for (const args of [["check"], ["check", "--format", "json"], ["check", "--format", "ai"], ["check", "--quiet"]]) {
      const run = await chaperone(box, offlineUrl(), args);
      expect(run.exitCode).toBe(0);
      expect(run.stderr).not.toContain("chaperone pin");
    }
  }, SLOW);

  const ttyTest = hasTerminal ? test : test.skip;
  ttyTest("appears once after a text report on a terminal", async () => {
    const output = runOnTerminal([process.execPath, CLI], sandbox(null), ["check"]);
    expect(output).toContain("PASSED");
    expect(output.match(/Tip: pin Chaperone for this repository with "chaperone pin"/g)?.length).toBe(1);
  }, SLOW);
});
