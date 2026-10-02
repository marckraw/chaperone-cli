/**
 * The recursion guard's environment marker. Pure.
 *
 * The launcher sets `CHAPERONE_LAUNCHED="<version> <mode> <pid>"` for the binary it runs. That
 * binary (0.10 or later) removes the marker from its environment before anything else, so the
 * commands it runs (a `command` rule that calls chaperone in another package) never inherit it,
 * and it never launches again. Binaries older than 0.10 ignore the marker and may pass it on, so
 * a marker only counts in the process it was made for:
 * - `exec`: the launcher replaced itself with the binary, which keeps the launcher's pid;
 * - `spawn` (Windows, which has no exec): the binary is the launcher's child.
 */

export const LAUNCH_MARKER = "CHAPERONE_LAUNCHED";

export type LaunchMode = "exec" | "spawn";

export interface LaunchMarker {
  /** The version the launcher meant to run */
  version: string;
  mode: LaunchMode;
  /** The launcher's pid */
  pid: number;
}

export function formatMarker(marker: LaunchMarker): string {
  return `${marker.version} ${marker.mode} ${marker.pid}`;
}

export function parseMarker(value: string | undefined): LaunchMarker | null {
  if (!value) return null;
  const match = /^(\S+) (exec|spawn) (\d+)$/.exec(value.trim());
  if (!match) return null;
  return { version: match[1]!, mode: match[2] as LaunchMode, pid: Number(match[3]) };
}

/**
 * True when this process is the one the marker was made for (and not a process further down
 * that inherited it).
 */
export function isOwnMarker(marker: LaunchMarker, self: { pid: number; ppid: number }): boolean {
  return marker.mode === "exec" ? marker.pid === self.pid : marker.pid === self.ppid;
}
