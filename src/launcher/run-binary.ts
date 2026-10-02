/**
 * Running the pinned binary in place of this one.
 *
 * On macOS and Linux the launcher execs the binary (execve): the binary takes over this process,
 * its pid, stdio, signals and exit code, and nothing of the launcher stays behind. Windows has no
 * exec, so there the binary runs as a child with inherited stdio, and the launcher exits with its
 * exit code.
 */

import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { constants } from "node:os";
import type { LaunchMode } from "./marker";

export type ChildOutcome = { exitCode: number } | { signal: NodeJS.Signals };

/** How this platform runs the pinned binary. */
export function launchMode(): LaunchMode {
  return process.platform !== "win32" && typeof process.execve === "function" ? "exec" : "spawn";
}

/**
 * Why `binary` cannot be run, or null when it can. Checked before exec: when execve fails, Bun
 * does not throw but prints the error and aborts the process (exit code 134), so a cache on a
 * filesystem mounted noexec, or a binary that lost its execute bit, would end the run without a
 * word of what to do.
 */
export function whyNotRunnable(binary: string, platform: string = process.platform): string | null {
  try {
    if (!statSync(binary).isFile()) return "it is not a file";
    if (platform !== "win32") accessSync(binary, fsConstants.X_OK);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Replace this process with `binary`. Check {@link whyNotRunnable} first: if execve fails anyway,
 * Bun aborts the process (a runtime that throws instead returns here by throwing).
 */
export function execBinary(binary: string, args: readonly string[], env: Record<string, string | undefined>): never {
  return process.execve!(binary, [binary, ...args], env as NodeJS.ProcessEnv);
}

/**
 * What the launcher does with the signals it receives while the binary runs as its child.
 *
 * Windows (the only platform that spawns): the child shares the console, so it gets Ctrl-C,
 * Ctrl-Break and the console's closing itself. "Sending" it a signal would terminate it outright
 * (TerminateProcess), with no cleanup and its own children left behind, so the launcher only
 * swallows them and waits. Elsewhere (spawn is then only a fallback for a runtime without execve),
 * it forwards them.
 */
export function signalHandling(platform: string): { forward: NodeJS.Signals[]; swallow: NodeJS.Signals[] } {
  return platform === "win32"
    ? { forward: [], swallow: ["SIGINT", "SIGBREAK", "SIGHUP"] }
    : { forward: ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"], swallow: [] };
}

/**
 * Run `binary` as a child with this process's stdio, and report how it ended.
 */
export async function spawnBinary(
  binary: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
  platform: string = process.platform
): Promise<ChildOutcome> {
  const child = Bun.spawn([binary, ...args], { stdio: ["inherit", "inherit", "inherit"], env });
  const { forward, swallow } = signalHandling(platform);
  const listeners = [
    ...forward.map((signal) => [signal, () => tryKill(child, signal)] as const),
    ...swallow.map((signal) => [signal, () => {}] as const),
  ];
  for (const [signal, listener] of listeners) {
    try {
      process.on(signal, listener);
    } catch {
      // A signal this platform does not know
    }
  }

  try {
    await child.exited;
  } finally {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  }

  if (child.signalCode) return { signal: child.signalCode as NodeJS.Signals };
  return { exitCode: child.exitCode ?? 2 };
}

function tryKill(child: { kill(signal: NodeJS.Signals): void }, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {}
}

/**
 * The exit code to end this process with: the child's, or for a child ended by a signal, 128 + the
 * signal number (as a shell reports it). Outside Windows the launcher first dies of the same signal
 * itself. On Windows "killing" itself would be TerminateProcess with exit code 1, which reads as
 * "violations found".
 */
export function exitLikeChild(outcome: ChildOutcome, platform: string = process.platform): number {
  if ("exitCode" in outcome) return outcome.exitCode;
  if (platform !== "win32") {
    try {
      process.kill(process.pid, outcome.signal);
    } catch {}
  }
  return 128 + (constants.signals[outcome.signal] ?? 0);
}
