/**
 * The launcher's decisions and messages. Pure.
 */

import type { LaunchMarker } from "./marker";
import { DEFAULT_ENV, describeOrigin, type DefaultOrigin, type MachineDefault, type PinState } from "./pin";

/** Environment values that switch something on: anything but "", "0" and "false". */
export function isTruthyEnv(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/** The `error` of the JSON document a failed launch prints for `check --format json`. */
export type LaunchFailure = "pinned-version-unavailable" | "invalid-machine-default";

export type LaunchPlan =
  | { action: "run-self"; reason: "no-pin" | "invalid-pin" | "same-version" | "launched" | "ignored" }
  | { action: "launch"; version: string; source: "pin" | "default" }
  | { action: "fail"; error: LaunchFailure; message: string };

export interface PlanInput {
  pin: PinState;
  /** The machine default, which counts only where nothing is pinned */
  machineDefault: MachineDefault;
  /** This binary's version */
  selfVersion: string;
  /** The launch marker meant for this process, if any (see {@link isOwnMarker}) */
  ownMarker: LaunchMarker | null;
  /** CHAPERONE_IGNORE_PIN is set: it sets aside the pin and the machine default */
  ignorePin: boolean;
}

/**
 * Whether to run this binary or another version: the pinned one, or where nothing is pinned the
 * machine default, treated exactly like a pin. A repository's own pin always wins. The recursion
 * guard:
 * - a process the launcher started never launches again;
 * - nor does a binary whose version is the one asked for;
 * - a launched binary that is not the version it was launched as fails: the cache holds the
 *   wrong file, and running it would run a different version silently.
 */
export function planLaunch({ pin, machineDefault, selfVersion, ownMarker, ignorePin }: PlanInput): LaunchPlan {
  if (ownMarker) {
    if (ownMarker.version !== selfVersion) {
      return {
        action: "fail",
        error: "pinned-version-unavailable",
        message:
          `this binary was launched as Chaperone ${ownMarker.version}, but it is ${selfVersion}: the cached copy of ` +
          `${ownMarker.version} is not that version. Remove it with "chaperone cache clear ${ownMarker.version}" and run again.`,
      };
    }
    return { action: "run-self", reason: "launched" };
  }
  // Loading the config reports an invalid pin (exit code 2), so nothing is checked unpinned.
  if (pin.kind === "invalid") return { action: "run-self", reason: "invalid-pin" };

  let wanted: { version: string; source: "pin" | "default" };
  if (pin.kind === "pinned") {
    wanted = { version: pin.version, source: "pin" };
  } else if (machineDefault.kind === "set") {
    wanted = { version: machineDefault.version, source: "default" };
  } else if (machineDefault.kind === "invalid") {
    if (ignorePin) return { action: "run-self", reason: "ignored" };
    return { action: "fail", error: "invalid-machine-default", message: formatInvalidDefault(machineDefault) };
  } else {
    return { action: "run-self", reason: "no-pin" };
  }

  if (wanted.version === selfVersion) return { action: "run-self", reason: "same-version" };
  if (ignorePin) return { action: "run-self", reason: "ignored" };
  return { action: "launch", ...wanted };
}

/** The first line of what an invalid machine default says: what is wrong, and where. */
export function describeInvalidDefault({ message, origin }: { message: string; origin: DefaultOrigin }): string {
  return `the machine default ${describeOrigin(origin)} is invalid: ${message}`;
}

/** How to fix an invalid machine default. */
export function fixInvalidDefault(origin: DefaultOrigin): string {
  return origin.kind === "env"
    ? `set ${DEFAULT_ENV} to an exact version, or unset it`
    : 'fix it with "chaperone default <version>", or remove it with "chaperone default --clear"';
}

/** Why nothing ran: the machine default, which decides here, is invalid. */
export function formatInvalidDefault(machineDefault: { message: string; origin: DefaultOrigin }): string {
  return [
    describeInvalidDefault(machineDefault),
    "Nothing here pins a version, so the machine default decides which Chaperone runs: " +
      `${fixInvalidDefault(machineDefault.origin)}; or pin this repository with "chaperone pin <version>". Nothing ran.`,
  ].join("\n");
}

/**
 * The machine default that chose this binary's version, if one did: nothing is pinned, the
 * default names this version, and CHAPERONE_IGNORE_PIN is not set. (A version the launcher runs
 * for the default sees the same default, and runs as its version.)
 */
export function defaultInUse(input: {
  pin: PinState;
  machineDefault: MachineDefault;
  selfVersion: string;
  ignorePin: boolean;
}): { version: string; origin: DefaultOrigin } | null {
  const { pin, machineDefault, selfVersion, ignorePin } = input;
  if (pin.kind !== "none" || ignorePin || machineDefault.kind !== "set" || machineDefault.version !== selfVersion) return null;
  return { version: machineDefault.version, origin: machineDefault.origin };
}

/**
 * The note on stderr when CHAPERONE_IGNORE_PIN sets something aside, or null when it set nothing
 * aside.
 */
export function formatIgnoreNote(input: {
  selfVersion: string;
  pin: PinState;
  configLabel: string;
  machineDefault: MachineDefault;
}): string | null {
  const { selfVersion, pin, configLabel, machineDefault } = input;
  const running = `CHAPERONE_IGNORE_PIN is set: running ${selfVersion}`;
  if (pin.kind === "pinned") {
    return pin.version === selfVersion ? null : `${running}, not ${pin.version} (pinned in ${configLabel}).`;
  }
  if (pin.kind === "invalid" || machineDefault.kind === "none") return null;
  const where = `the machine default ${describeOrigin(machineDefault.origin)}`;
  if (machineDefault.kind === "invalid") return `${running}, ignoring ${where}, which is invalid: ${machineDefault.message}`;
  return machineDefault.version === selfVersion ? null : `${running}, not ${machineDefault.version} (${where}).`;
}

export interface VersionLineInput {
  selfVersion: string;
  pin: PinState;
  /** The config file as shown to the user, or null when there is none */
  configLabel: string | null;
  /** The machine default, which counts only where nothing is pinned */
  machineDefault: MachineDefault;
  /** The version that runs here (pinned, or the default) is in the cache */
  cached: boolean;
  ignorePin: boolean;
}

/**
 * `chaperone --version`. The first version is the one that runs this repository's commands, so
 * `chaperone --version | awk '{print $2}'` keeps working; the launcher's own version follows.
 */
export function formatVersionLine({ selfVersion, pin, configLabel, machineDefault, cached, ignorePin }: VersionLineInput): string {
  const self = `chaperone v${selfVersion}`;
  const launched = (version: string, where: string) =>
    `chaperone v${version} (${where}, launched by v${selfVersion}${cached ? "" : "; downloaded on first use"})`;

  if (configLabel && pin.kind !== "none") {
    if (pin.kind === "invalid") return `${self} (${configLabel}: ${pin.message})`;
    const where = `pinned in ${configLabel}`;
    if (pin.version === selfVersion) return `${self} (${where})`;
    if (ignorePin) return `${self} (CHAPERONE_IGNORE_PIN is set: ignoring v${pin.version}, ${where})`;
    return launched(pin.version, where);
  }

  // Nothing is pinned: the machine default decides, if there is one.
  if (machineDefault.kind !== "none") {
    const where = `machine default ${describeOrigin(machineDefault.origin)}`;
    if (machineDefault.kind === "invalid") {
      return ignorePin ? `${self} (CHAPERONE_IGNORE_PIN is set: ignoring the invalid ${where})` : `${self} (${where}: ${machineDefault.message})`;
    }
    if (machineDefault.version === selfVersion) return `${self} (${where})`;
    if (ignorePin) return `${self} (CHAPERONE_IGNORE_PIN is set: ignoring v${machineDefault.version}, the ${where})`;
    return launched(machineDefault.version, where);
  }
  return configLabel ? `${self} (not pinned: "chaperone pin" pins it in ${configLabel})` : self;
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
