/**
 * Test helpers for the launcher: fake Chaperone binaries and a local release server, so no test
 * downloads anything from GitHub.
 *
 * A fake binary is a shell script that execs a small Bun program (keeping the pid, as a real
 * binary would). The program prints one JSON line describing how it was started, then exits with
 * FAKE_EXIT, kills itself with SIGTERM (FAKE_MODE=kill-self) or waits (FAKE_MODE=sleep).
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { releaseAsset } from "../launcher/paths";
import { makeProject } from "./fixtures";

/** This machine's release asset name. */
export const ASSET = releaseAsset(process.platform, process.arch) ?? "chaperone-unsupported";

export interface FakeReport {
  label: string;
  argv: string[];
  cwd: string;
  pid: number;
  launched: string | null;
  noUpdateCheck: string | null;
  passthrough: string | null;
}

const PROGRAM = `
const report = {
  label: process.env.FAKE_LABEL,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  pid: process.pid,
  launched: process.env.CHAPERONE_LAUNCHED ?? null,
  noUpdateCheck: process.env.CHAPERONE_NO_UPDATE_CHECK ?? null,
  passthrough: process.env.FAKE_PASSTHROUGH ?? null,
};
if (!process.env.FAKE_SILENT) require("node:fs").writeSync(1, JSON.stringify(report) + "\\n");
const mode = process.env.FAKE_MODE;
if (mode === "kill-self") {
  process.kill(process.pid, "SIGTERM");
  setInterval(() => {}, 1000);
} else if (mode === "sleep") {
  setInterval(() => {}, 1000);
} else {
  process.exit(Number(process.env.FAKE_EXIT ?? "0"));
}
`;

let programPath: string | null = null;

/** The fake's program, in a temporary directory that cleanupProjects() removes after each test. */
function fakeProgram(): string {
  if (!programPath || !existsSync(programPath)) {
    programPath = join(makeProject({ "fake-chaperone.js": PROGRAM }), "fake-chaperone.js");
  }
  return programPath;
}

/** The bytes of a fake release binary for `label` (each label hashes differently). */
export function fakeBinary(label: string): string {
  return `#!/bin/sh\n# fake chaperone ${label}\nFAKE_LABEL='${label}' exec '${process.execPath}' '${fakeProgram()}' "$@"\n`;
}

/** A binary that runs this checkout's launcher, whatever version it was installed as. */
export function launcherBinary(cli: string): string {
  return `#!/bin/sh\nexec '${process.execPath}' '${cli}' "$@"\n`;
}

/** Put `content` in a cache as if the launcher had installed it. */
export function installIntoCache(cacheDir: string, version: string, content: string): string {
  const path = join(cacheDir, version, ASSET);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}

export const sha256 = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");

export interface FakeRelease {
  /** The binary for this machine */
  binary: string;
  /** SHA256SUMS.txt (default: the binary's real checksum) */
  sums?: string;
}

export interface ReleaseServer {
  url: string;
  /** Paths requested, in order */
  requests: string[];
  stop(): void;
}

/**
 * Serve releases as GitHub lays them out: `/v<version>/SHA256SUMS.txt` and `/v<version>/<asset>`.
 * With `holdBinariesUntil: n`, binary downloads wait until n of them have started (or 5 s), so
 * concurrent runs really download at the same time.
 */
export function startReleaseServer(
  releases: Record<string, FakeRelease>,
  options: { holdBinariesUntil?: number } = {}
): ReleaseServer {
  const requests: string[] = [];
  let binaryRequests = 0;
  let waiting: Array<() => void> = [];

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      const match = /^\/v([^/]+)\/([^/]+)$/.exec(path);
      const release = match ? releases[match[1]!] : undefined;
      if (!match || !release) return new Response("Not Found", { status: 404 });

      if (match[2] === "SHA256SUMS.txt") {
        return new Response(release.sums ?? `${sha256(release.binary)}  ${ASSET}\n${"0".repeat(64)}  chaperone-other-os\n`);
      }
      if (match[2] !== ASSET) return new Response("Not Found", { status: 404 });

      binaryRequests++;
      const hold = options.holdBinariesUntil;
      if (hold) {
        if (binaryRequests >= hold) {
          for (const release of waiting) release();
          waiting = [];
        } else {
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
            setTimeout(resolve, 5000);
          });
        }
      }
      return new Response(release.binary);
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

/** A URL where nothing listens: the network is down. */
export function offlineUrl(): string {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const url = `http://127.0.0.1:${server.port}`;
  server.stop(true);
  return url;
}
