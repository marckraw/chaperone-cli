/**
 * The launcher's decisions and messages. Pure.
 */

import type { LaunchMarker } from "./marker";
import type { PinState } from "./pin";

/** Environment values that switch something on: anything but "", "0" and "false". */
export function isTruthyEnv(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

export type LaunchPlan =
  | { action: "run-self"; reason: "no-pin" | "invalid-pin" | "same-version" | "launched" | "ignored" }
  | { action: "launch"; version: string }
  | { action: "fail"; message: string };

export interface PlanInput {
  pin: PinState;
  /** This binary's version */
  selfVersion: string;
  /** The launch marker meant for this process, if any (see {@link isOwnMarker}) */
  ownMarker: LaunchMarker | null;
  /** CHAPERONE_IGNORE_PIN is set */
  ignorePin: boolean;
}

/**
 * Whether to run this binary or the pinned version. The recursion guard:
 * - a process the launcher started never launches again;
 * - nor does a binary whose version is the pinned one;
 * - a launched binary that is not the version it was launched as fails: the cache holds the
 *   wrong file, and running it would run a different version silently.
 */
export function planLaunch({ pin, selfVersion, ownMarker, ignorePin }: PlanInput): LaunchPlan {
  if (ownMarker) {
    if (ownMarker.version !== selfVersion) {
      return {
        action: "fail",
        message:
          `this binary was launched as Chaperone ${ownMarker.version}, but it is ${selfVersion}: the cached copy of ` +
          `${ownMarker.version} is not that version. Remove it with "chaperone cache clear ${ownMarker.version}" and run again.`,
      };
    }
    return { action: "run-self", reason: "launched" };
  }
  if (pin.kind === "none") return { action: "run-self", reason: "no-pin" };
  // Loading the config reports an invalid pin (exit code 2), so nothing is checked unpinned.
  if (pin.kind === "invalid") return { action: "run-self", reason: "invalid-pin" };
  if (pin.version === selfVersion) return { action: "run-self", reason: "same-version" };
  if (ignorePin) return { action: "run-self", reason: "ignored" };
  return { action: "launch", version: pin.version };
}

export interface VersionLineInput {
  selfVersion: string;
  pin: PinState;
  /** The config file as shown to the user, or null when there is none */
  configLabel: string | null;
  /** The pinned version is in the cache */
  cached: boolean;
  ignorePin: boolean;
}

/**
 * `chaperone --version`. The first version is the one that runs this repository's commands, so
 * `chaperone --version | awk '{print $2}'` keeps working; the launcher's own version follows.
 */
export function formatVersionLine({ selfVersion, pin, configLabel, cached, ignorePin }: VersionLineInput): string {
  const self = `chaperone v${selfVersion}`;
  if (!configLabel || pin.kind === "none") {
    return configLabel ? `${self} (not pinned: "chaperone pin" pins it in ${configLabel})` : self;
  }
  if (pin.kind === "invalid") return `${self} (${configLabel}: ${pin.message})`;
  if (pin.version === selfVersion) return `${self} (pinned in ${configLabel})`;
  if (ignorePin) return `${self} (CHAPERONE_IGNORE_PIN is set: ignoring v${pin.version}, pinned in ${configLabel})`;
  return `chaperone v${pin.version} (pinned in ${configLabel}, launched by v${selfVersion}${cached ? "" : "; downloaded on first use"})`;
}

/**
 * Sort versions newest first (numeric MAJOR.MINOR.PATCH; a pre-release sorts before its release).
 */
export function compareVersionsDescending(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = "", pre] = version.split("-", 2);
    return { numbers: core.split(".").map(Number), pre: pre ?? null };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    const difference = (right.numbers[index] ?? 0) - (left.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return -1;
  if (right.pre === null) return 1;
  return right.pre.localeCompare(left.pre);
}
