/**
 * scripts/install.sh against a local release server. HOME is a temporary directory, so the
 * script's fallback to ~/.local/bin can never reach a real installation.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { ASSET, fakeBinary, startReleaseServer, type ReleaseServer } from "../testing/fake-releases";

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "install.sh");
const hasCurl = Bun.which("curl") !== null && process.platform !== "win32";
const scriptTest = hasCurl ? test : test.skip;
// Each test starts several processes: give a slow CI runner room (bun's default is 5 s).
const SLOW = 20_000;

const servers: ReleaseServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  cleanupProjects();
});

async function install(cwd: string, args: string[], env: Record<string, string> = {}) {
  const server = startReleaseServer({
    "0.8.0": { binary: fakeBinary("0.8.0") },
    "0.7.1": { binary: fakeBinary("0.7.1") },
  });
  servers.push(server);
  const installDir = makeProject();
  const child = Bun.spawn(["sh", SCRIPT, "--install-dir", installDir, ...args], {
    cwd,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: makeProject(), CHAPERONE_RELEASES_URL: server.url, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await child.exited;
  const installed = () => readFileSync(join(installDir, "chaperone"), "utf-8");
  return { exitCode: child.exitCode, stdout, stderr, installed, requests: server.requests };
}

const project = (config: string) => makeProject({ ".chaperone.json": config });

describe("install.sh --version pinned", () => {
  scriptTest("installs the version .chaperone.json pins", async () => {
    const cwd = project('{\n  "chaperoneVersion": "0.8.0",\n  "version": "1.0.0"\n}\n');
    const run = await install(cwd, ["--version", "pinned"]);
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("Installing chaperone v0.8.0 (pinned in .chaperone.json)");
    expect(run.installed()).toBe(fakeBinary("0.8.0"));
    expect(run.requests).toEqual(["/v0.8.0/SHA256SUMS.txt", `/v0.8.0/${ASSET}`]);
  }, SLOW);

  scriptTest("CHAPERONE_VERSION=pinned, a v-prefixed pin, and a key split from its value", async () => {
    const cwd = project('{ "version": "1.0.0",\n  "chaperoneVersion":\n    "v0.7.1" }');
    const run = await install(cwd, [], { CHAPERONE_VERSION: "pinned" });
    expect(run.exitCode).toBe(0);
    expect(run.installed()).toBe(fakeBinary("0.7.1"));
  }, SLOW);

  scriptTest("--config reads another file", async () => {
    const cwd = project('{ "chaperoneVersion": "0.8.0" }');
    writeFileSync(join(cwd, "ci.json"), '{ "chaperoneVersion": "0.7.1" }');
    const run = await install(cwd, ["--version", "pinned", "--config", "ci.json"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("(pinned in ci.json)");
    expect(run.installed()).toBe(fakeBinary("0.7.1"));
  }, SLOW);

  scriptTest("fails without a pin, with an invalid pin, or without a config", async () => {
    const noPin = await install(project('{ "version": "1.0.0" }'), ["--version", "pinned"]);
    expect(noPin.exitCode).toBe(1);
    expect(noPin.stderr).toContain('has no "chaperoneVersion"');

    const range = await install(project('{ "chaperoneVersion": "^0.8.0" }'), ["--version", "pinned"]);
    expect(range.exitCode).toBe(1);
    expect(range.stderr).toContain('is "^0.8.0", not an exact version');

    const missing = await install(makeProject(), ["--version", "pinned"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(".chaperone.json not found");
    expect(missing.requests).toEqual([]);
  }, SLOW);

  scriptTest("an explicit version still wins", async () => {
    const run = await install(project('{ "chaperoneVersion": "0.8.0" }'), ["--version", "0.7.1"]);
    expect(run.exitCode).toBe(0);
    expect(run.installed()).toBe(fakeBinary("0.7.1"));
  }, SLOW);
});
