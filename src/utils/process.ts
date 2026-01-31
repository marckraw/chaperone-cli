/**
 * Process utilities for running commands
 */

import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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

    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: killed ? 124 : (code ?? 1),
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr || err.message,
        exitCode: 1,
      });
    });
  });
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  const result = await execCommand("which", [command]);
  return result.exitCode === 0;
}

/**
 * Find the npm/npx binary path
 */
export async function findNpmBinary(name: string, cwd: string): Promise<string | null> {
  // Try local node_modules first
  const localPath = `${cwd}/node_modules/.bin/${name}`;
  const checkLocal = await execCommand("test", ["-x", localPath]);
  if (checkLocal.exitCode === 0) {
    return localPath;
  }

  // Fall back to global
  if (await commandExists(name)) {
    return name;
  }

  return null;
}
