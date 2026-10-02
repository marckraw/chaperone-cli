/**
 * The launcher: the first thing every chaperone binary runs.
 *
 * A project pins its Chaperone with `"chaperoneVersion": "0.10.0"` in .chaperone.json; where
 * nothing is pinned, the machine default (CHAPERONE_DEFAULT_VERSION, or `"defaultVersion"` in
 * ~/.config/chaperone/config.json) names the version instead. When that version is not this
 * binary's, the launcher runs it (from the cache, downloading and verifying it first if needed)
 * with the same arguments, stdio and environment, and its exit code (or signal) becomes this
 * run's. Without either, or when the versions match, this binary runs as usual.
 *
 * Kept light on purpose: nothing here imports the checks, zod or the AI SDK, and the download
 * code (node:crypto) and the launcher's own commands (node:util) load only when needed, so
 * handing over to a cached version costs little more than starting a binary.
 */

import { writeSync } from "node:fs";
import { EXIT } from "../utils/args";
import { VERSION } from "../version";
import { launcherCommand, scanArgs, type LauncherArgs } from "./argv";
import { ensureVersion, logLine, readMachineDefault, readProjectPin } from "./context";
import { LaunchError } from "./errors";
import { formatMarker, isOwnMarker, LAUNCH_MARKER, parseMarker } from "./marker";
import { describeOrigin, NO_DEFAULT, type DefaultOrigin, type PinState } from "./pin";
import { defaultInUse, formatIgnoreNote, isTruthyEnv, planLaunch, type LaunchFailure } from "./plan";
import { execBinary, exitLikeChild, launchMode, spawnBinary, whyNotRunnable } from "./run-binary";

export { PIN_FIELD, checkPinValue, isMisspelledPinKey, misspelledPinKeyMessage, formatPinHint, shouldShowPinHint } from "./pin";
export type { PinState } from "./pin";

/**
 * What the commands need to know about the version choice (for the hint to pin, and the update
 * notice).
 */
export interface LaunchContext {
  pin: PinState;
  /** The config file exists */
  hasConfig: boolean;
  /** The config file as shown to the user */
  configLabel: string;
  /** The machine default that chose this binary's version, where nothing is pinned */
  machineDefault: { version: string; origin: DefaultOrigin } | null;
}

export type LauncherOutcome = { kind: "run-self"; context: LaunchContext } | { kind: "exit"; code: number };

/**
 * Report a launch failure: on stderr, and for `check --format json` also as the one JSON document
 * on stdout, so a pipe into `jq` still reads why nothing ran. Exit code 2.
 */
function fail(message: string, args: LauncherArgs, error: LaunchFailure = "pinned-version-unavailable"): LauncherOutcome {
  logLine(message);
  if (args.jsonOutput) {
    const document = { success: false, error, exitCode: EXIT.ERROR, message };
    writeSync(1, `${JSON.stringify(document, null, 2)}\n`);
  }
  return { kind: "exit", code: EXIT.ERROR };
}

/**
 * Decide whether this binary runs the command, and if not, run the version the pin (or the
 * machine default) names. Returns when this binary should run the command, or with the exit code
 * to exit with.
 */
export async function runLauncher(args: string[]): Promise<LauncherOutcome> {
  // The recursion guard's marker is only for this process: remove it before anything can start a
  // child (a `command` rule running chaperone elsewhere must launch normally).
  const marker = parseMarker(process.env[LAUNCH_MARKER]);
  delete process.env[LAUNCH_MARKER];
  const ownMarker = marker && isOwnMarker(marker, { pid: process.pid, ppid: process.ppid }) ? marker : null;

  const scanned = scanArgs(args);
  const own = launcherCommand(scanned.command);
  if (own) {
    const commands = await import("./commands");
    if (own === "version") return { kind: "exit", code: commands.runVersion(args.slice(1), VERSION) };
    if (own === "pin") return { kind: "exit", code: await commands.runPin(args.slice(1), VERSION) };
    if (own === "default") return { kind: "exit", code: await commands.runDefault(args.slice(1), VERSION) };
    return { kind: "exit", code: commands.runCache(args.slice(1)) };
  }

  const project = readProjectPin(scanned);
  const ignorePin = isTruthyEnv(process.env["CHAPERONE_IGNORE_PIN"]);
  // A repository's own pin always wins: the machine default is read only where nothing is pinned.
  const machineDefault = project.pin.kind === "none" ? readMachineDefault() : NO_DEFAULT;
  const plan = planLaunch({ pin: project.pin, machineDefault, selfVersion: VERSION, ownMarker, ignorePin });
  const context: LaunchContext = {
    pin: project.pin,
    hasConfig: project.exists,
    configLabel: project.configLabel,
    machineDefault: defaultInUse({ pin: project.pin, machineDefault, selfVersion: VERSION, ignorePin }),
  };

  if (plan.action === "fail") return fail(plan.message, scanned, plan.error);
  if (plan.action === "run-self") {
    if (plan.reason === "ignored") {
      const note = formatIgnoreNote({ selfVersion: VERSION, pin: project.pin, configLabel: project.configLabel, machineDefault });
      if (note) logLine(note);
    }
    return { kind: "run-self", context };
  }

  const asker =
    plan.source === "default" && machineDefault.kind === "set"
      ? `The machine default ${describeOrigin(machineDefault.origin)} is`
      : `${project.configLabel} pins`;
  let binary: string;
  try {
    binary = await ensureVersion(plan.version, asker);
  } catch (error) {
    if (error instanceof LaunchError) return fail(error.message, scanned);
    throw error;
  }

  const unrunnable = whyNotRunnable(binary);
  if (unrunnable) {
    return fail(
      `cannot run Chaperone ${plan.version} (${binary}): ${unrunnable}. If the cache is on a filesystem mounted ` +
        "noexec, set CHAPERONE_CACHE_DIR to a directory that allows running programs; otherwise remove it with " +
        `"chaperone cache clear ${plan.version}" and run again to download it afresh. Nothing ran.`,
      scanned
    );
  }

  const mode = launchMode();
  const env: Record<string, string | undefined> = {
    ...process.env,
    [LAUNCH_MARKER]: formatMarker({ version: plan.version, mode, pid: process.pid }),
    // The pin (or the machine default) decides the version, so the launched binary's "update
    // available" notice would only mislead (versions before 0.10 know nothing of pins; 0.7 and
    // older print it anyway).
    CHAPERONE_NO_UPDATE_CHECK: "1",
  };

  if (mode === "exec") {
    try {
      execBinary(binary, args, env);
    } catch (error) {
      // Bun aborts when execve fails (hence the check above); a runtime that throws ends up here.
      const reason = error instanceof Error ? error.message : String(error);
      return fail(
        `cannot run Chaperone ${plan.version} (${binary}): ${reason}. ` +
          `Remove it with "chaperone cache clear ${plan.version}" and run again to download it afresh. Nothing ran.`,
        scanned
      );
    }
  }

  try {
    return { kind: "exit", code: exitLikeChild(await spawnBinary(binary, args, env)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`cannot run Chaperone ${plan.version} (${binary}): ${reason}. Nothing ran.`, scanned);
  }
}
