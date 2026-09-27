/**
 * Process utilities for running commands
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Exit code; 124 when the command timed out, 127 when it could not be started */
  exitCode: number;
  /** True when the command was killed after exceeding the timeout */
  timedOut?: boolean;
  /** Set when the command could not be started at all (e.g. ENOENT) */
  spawnError?: string;
}

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Execute a command and return stdout, stderr, and exit code
 */
export function execCommand(
  command: string,
  args: string[],
  options: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const { cwd = process.cwd(), timeout = 120000, env } = options;
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        stdout,
        stderr,
        exitCode: killed ? 124 : code ?? 1,
        timedOut: killed || undefined,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        stdout,
        stderr: stderr || err.message,
        exitCode: 127,
        spawnError: err.message,
      });
    });
  });
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  return Bun.which(command) !== null;
}

/**
 * Find an npm binary: `node_modules/.bin/<name>` in `cwd` or any parent directory
 * (monorepos hoist tools to the root), then the PATH. Returns null when not found.
 */
export function findBinary(name: string, cwd: string): string | null {
  const candidates = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  let directory = cwd;

  for (;;) {
    for (const candidate of candidates) {
      const localPath = join(directory, "node_modules", ".bin", candidate);
      if (existsSync(localPath)) {
        return localPath;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return Bun.which(name);
}

/**
 * Find the binary path
 */
export async function findNpmBinary(name: string, cwd: string): Promise<string | null> {
  return findBinary(name, cwd);
}
