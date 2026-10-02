/**
 * Running the pinned binary in place of this one.
 *
 * On macOS and Linux the launcher execs the binary (execve): the binary takes over this process,
 * its pid, stdio, signals and exit code, and nothing of the launcher stays behind. Windows has no
 * exec, so there the binary runs as a child with inherited stdio; the launcher forwards signals to
 * it and exits with its exit code (or dies of the same signal).
 */

import { constants } from "node:os";
import type { LaunchMode } from "./marker";

export type ChildOutcome = { exitCode: number } | { signal: NodeJS.Signals };

const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGBREAK"];

/** How this platform runs the pinned binary. */
export function launchMode(): LaunchMode {
  return process.platform !== "win32" && typeof process.execve === "function" ? "exec" : "spawn";
}

/**
 * Replace this process with `binary`. Returns only by throwing (the binary is missing, not
 * executable, or not a program for this machine).
 */
export function execBinary(binary: string, args: readonly string[], env: Record<string, string | undefined>): never {
  return process.execve!(binary, [binary, ...args], env as NodeJS.ProcessEnv);
}

/**
 * Run `binary` as a child with this process's stdio, forwarding signals, and report how it ended.
 */
export async function spawnBinary(
  binary: string,
  args: readonly string[],
  env: Record<string, string | undefined>
): Promise<ChildOutcome> {
  const child = Bun.spawn([binary, ...args], { stdio: ["inherit", "inherit", "inherit"], env });
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const forward = () => {
      try {
        child.kill(signal);
      } catch {}
    };
    try {
      process.on(signal, forward);
    } catch {
      // A signal this platform does not know
    }
    return [signal, forward] as const;
  });

  try {
    await child.exited;
  } finally {
    for (const [signal, forward] of handlers) process.off(signal, forward);
  }

  if (child.signalCode) return { signal: child.signalCode as NodeJS.Signals };
  return { exitCode: child.exitCode ?? 2 };
}

/**
 * End this process the way the child ended: with its exit code, or by the same signal (as a
 * shell reports it, 128 + the signal number, if the signal does not end this process).
 */
export function exitLikeChild(outcome: ChildOutcome): number {
  if ("exitCode" in outcome) return outcome.exitCode;
  try {
    process.kill(process.pid, outcome.signal);
  } catch {}
  return 128 + (constants.signals[outcome.signal] ?? 0);
}
