/**
 * The launcher inside a compiled binary (`bun build --compile --minify --bytecode`), where the lazy
 * imports and execve run the way users run them. Skipped unless CHAPERONE_TEST_BINARY names a
 * built binary; CI sets it after `bun run build`:
 *
 *   bun run build && CHAPERONE_TEST_BINARY=bin/chaperone-darwin-arm64 bun test src/launcher/compiled.test.ts
 *
 * As in launcher.test.ts, releases come from a local server and the cache is a temporary directory.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import {
  ASSET,
  cachedFiles,
  fakeBinary,
  offlineUrl,
  report,
  runChaperone,
  sandbox,
  startReleaseServer,
  type ReleaseServer,
  type Run,
  type RunOptions,
  type Sandbox,
} from "../testing/fake-releases";

const BINARY = process.env["CHAPERONE_TEST_BINARY"] ? resolve(process.env["CHAPERONE_TEST_BINARY"]) : null;
const compiledTest = BINARY && process.platform !== "win32" ? test : test.skip;
const SLOW = 20_000;

const servers: ReleaseServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  cleanupProjects();
});

function run(box: Sandbox, url: string, args: string[], options: RunOptions = {}): Promise<Run> {
  return runChaperone([BINARY!], box, url, args, options);
}

/** The binary's own version, from `--version` where no config pins anything. */
async function binaryVersion(): Promise<string> {
  const empty = { project: makeProject(), cache: makeProject(), home: makeProject() };
  const line = (await run(empty, offlineUrl(), ["--version"])).stdout.trim();
  const match = /^chaperone v(\S+)$/.exec(line);
  if (!match) throw new Error(`unexpected --version output: ${line}`);
  return match[1]!;
}

describe("the compiled binary", () => {
  compiledTest("downloads, verifies and runs a pinned version, passing arguments and the exit code through", async () => {
    const box = sandbox("0.8.0");
    const server = startReleaseServer({ "0.8.0": { binary: fakeBinary("0.8.0") } });
    servers.push(server);

    const result = await run(box, server.url, ["check", "--format", "json", "two words"], { env: { FAKE_EXIT: "2" } });

    expect(result.stderr).toContain(`verified ${ASSET} 0.8.0`);
    expect(result.exitCode).toBe(2);
    expect(report(result)).toMatchObject({ label: "0.8.0", argv: ["check", "--format", "json", "two words"] });
    // exec: the pinned binary took over the launcher's process
    expect(report(result).pid).toBe(result.pid);
    expect(cachedFiles(box, "0.8.0")).toEqual([ASSET]);

    const version = await run(box, offlineUrl(), ["--version"]);
    expect(version.stdout).toStartWith("chaperone v0.8.0 (pinned in .chaperone.json, launched by v");
  }, SLOW);

  compiledTest("refuses a download whose checksum does not match", async () => {
    const box = sandbox("0.8.0");
    const server = startReleaseServer({ "0.8.0": { binary: fakeBinary("0.8.0"), sums: `${"f".repeat(64)}  ${ASSET}\n` } });
    servers.push(server);
    const result = await run(box, server.url, ["check"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("does not match SHA256SUMS.txt");
    expect(cachedFiles(box, "0.8.0")).toEqual([]);
  }, SLOW);

  compiledTest("runs its own check when the repository pins nothing", async () => {
    const result = await run(sandbox(null), offlineUrl(), ["check", "--format", "json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).success).toBe(true);
  }, SLOW);

  compiledTest("pins its own version", async () => {
    const box = sandbox(null);
    const version = await binaryVersion();
    const result = await run(box, offlineUrl(), ["pin"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(box.project, ".chaperone.json"), "utf-8")).chaperoneVersion).toBe(version);
    // Pinned to itself: it runs its own check, with no download
    const check = await run(box, offlineUrl(), ["check", "--format", "json"]);
    expect(JSON.parse(check.stdout).success).toBe(true);
  }, SLOW);
});
