/**
 * Test helpers for the launcher: fake Chaperone binaries and a local release server, so no test
 * downloads anything from GitHub.
 *
 * A fake binary is a shell script that execs a small Bun program (keeping the pid, as a real
 * binary would). The program prints one JSON line describing how it was started (unless
 * FAKE_SILENT is set), then exits with FAKE_EXIT, kills itself with SIGTERM (FAKE_MODE=kill-self),
 * or waits (FAKE_MODE=sleep), for FAKE_SLEEP_MS before exiting with FAKE_EXIT if that is set.
 */

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { releaseAsset, resolveMachineConfigPath } from "../launcher/paths";
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
  if (process.env.FAKE_SLEEP_MS) {
    setTimeout(() => process.exit(Number(process.env.FAKE_EXIT ?? "0")), Number(process.env.FAKE_SLEEP_MS));
  }
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

/**
 * A URL where nothing listens: the network is down. Port 1 is privileged, so no test server
 * (here or in a test run going on at the same time) can be listening there, and a connection is
 * refused at once. (A port freed by a stopped server could be taken again before it is used.)
 */
export function offlineUrl(): string {
  return "http://127.0.0.1:1";
}

/** A project, with a cache and a home of its own. */
export interface Sandbox {
  project: string;
  cache: string;
  home: string;
}

/** A project pinning `pin` (or nothing), with an empty cache and home of its own. */
export function sandbox(pin: string | null = "0.8.0", extra: Record<string, unknown> = {}): Sandbox {
  const config = { ...(pin === null ? {} : { chaperoneVersion: pin }), version: "1.0.0", rules: { custom: [] }, ...extra };
  return {
    project: makeProject({ ".chaperone.json": `${JSON.stringify(config, null, 2)}\n` }),
    cache: makeProject(),
    home: makeProject(),
  };
}

export interface Run {
  exitCode: number | null;
  signalCode: string | null;
  pid: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Called with the process once it has printed its first line on stdout */
  onFirstLine?: (process: ReturnType<typeof Bun.spawn>) => void;
  /** Kill the run after this long (default 10 s), so a regression cannot leave it running */
  killAfterMs?: number;
}

/**
 * The environment of a run in a sandbox: HOME, the cache and the machine config file are the
 * sandbox's, releases come from `url`, the update check is off, and no CHAPERONE_*, FAKE_* or
 * XDG_* variable leaks in from the test's own environment (a machine default included).
 */
export function sandboxEnv(box: Sandbox, url: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("CHAPERONE_") && !key.startsWith("FAKE_") && key !== "XDG_CACHE_HOME" && key !== "XDG_CONFIG_HOME") {
      env[key] = value;
    }
  }
  return Object.assign(env, {
    HOME: box.home,
    // Windows reads the machine config from %APPDATA%
    APPDATA: join(box.home, "AppData", "Roaming"),
    CHAPERONE_CACHE_DIR: box.cache,
    CHAPERONE_RELEASES_URL: url,
    CHAPERONE_NO_UPDATE_CHECK: "1",
    NO_COLOR: "",
    FORCE_COLOR: "",
    ...extra,
  });
}

/** The sandbox's machine config file: `<home>/.config/chaperone/config.json` outside Windows. */
export function machineConfigPath(box: Sandbox): string {
  return resolveMachineConfigPath({ env: sandboxEnv(box, ""), platform: process.platform, home: box.home });
}

/** Write the sandbox's machine config file: `config` as JSON, or a string as it is. */
export function writeMachineConfig(box: Sandbox, config: unknown): string {
  const path = machineConfigPath(box);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof config === "string" ? config : `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

/**
 * Run a chaperone (`command`: this checkout's launcher, or a compiled binary) in a sandbox (see
 * {@link sandboxEnv}).
 */
export async function runChaperone(
  command: readonly string[],
  box: Sandbox,
  url: string,
  args: string[],
  options: RunOptions = {}
): Promise<Run> {
  const env = sandboxEnv(box, url, options.env);

  const child = Bun.spawn([...command, ...args], {
    cwd: options.cwd ?? box.project,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = setTimeout(() => child.kill("SIGKILL"), options.killAfterMs ?? 10_000);

  const readStdout = async () => {
    let text = "";
    let notified = false;
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      text += decoder.decode(chunk, { stream: true });
      if (!notified && text.includes("\n") && options.onFirstLine) {
        notified = true;
        options.onFirstLine(child);
      }
    }
    return text;
  };
  const [stdout, stderr] = await Promise.all([readStdout(), new Response(child.stderr).text()]);
  await child.exited;
  clearTimeout(deadline);
  return { exitCode: child.exitCode, signalCode: child.signalCode, pid: child.pid, stdout, stderr };
}

/** The fake binary's report: the first line it printed. */
export const report = (run: Run): FakeReport => JSON.parse(run.stdout.trim().split("\n")[0]!);

/** The files in a sandbox cache's directory for `version`. */
export const cachedFiles = (box: Sandbox, version: string): string[] =>
  existsSync(join(box.cache, version)) ? readdirSync(join(box.cache, version)).sort() : [];

/** script(1), which runs a command on a terminal; null where there is none (Windows). */
const SCRIPT = process.platform === "win32" ? null : Bun.which("script");

/** {@link runOnTerminal} works here. */
export const hasTerminal = SCRIPT !== null;

/**
 * Run a chaperone in a sandbox with stdout and stderr on a terminal, as a person runs it, and
 * return what the terminal showed (both streams). Releases come from nowhere: offline.
 */
export function runOnTerminal(
  command: readonly string[],
  box: Sandbox,
  args: string[],
  env: Record<string, string | undefined> = {}
): string {
  const line = [...command, ...args].map((part) => `'${part}'`).join(" ");
  // BSD (macOS) and util-linux spell it differently.
  const argv = process.platform === "darwin" ? [SCRIPT!, "-q", "/dev/null", "/bin/sh", "-c", line] : [SCRIPT!, "-qec", line, "/dev/null"];
  const result = Bun.spawnSync(argv, {
    cwd: box.project,
    env: sandboxEnv(box, offlineUrl(), { NO_COLOR: "1", ...env }),
    stdin: "ignore",
  });
  return result.stdout.toString();
}
