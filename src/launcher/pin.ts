/**
 * The version a project or a machine asks for:
 * - the pin, `"chaperoneVersion": "0.10.0"` in a project's .chaperone.json;
 * - the machine default, the version a machine runs where nothing pins one:
 *   `CHAPERONE_DEFAULT_VERSION`, or `"defaultVersion"` in the machine's config file.
 *
 * Pure: no I/O. The launcher reads the pin with {@link readPin} before anything else runs, and the
 * machine default with {@link defaultFromEnv} and {@link defaultFromConfigText} where nothing is
 * pinned; the config schema validates the pin with {@link checkPinValue} and
 * {@link isMisspelledPinKey}. One parser, {@link checkVersionValue}, decides what a valid version is
 * for all of them.
 */

import { editDistance } from "../utils/suggest";

export const PIN_FIELD = "chaperoneVersion";

/** The machine default's field in the machine's config file. */
export const DEFAULT_FIELD = "defaultVersion";

/** Sets the machine default, over the config file. */
export const DEFAULT_ENV = "CHAPERONE_DEFAULT_VERSION";

/** Shown in messages as what a pin looks like. */
const EXAMPLE_VERSION = "0.10.0";

const NUMBER = "(?:0|[1-9]\\d*)";
const IDENTIFIER = "[0-9A-Za-z-]+";

/**
 * An exact version: MAJOR.MINOR.PATCH, an optional pre-release (`-rc.1`) and an optional leading
 * `v`, which is dropped (`v0.10.0` pins `0.10.0`, the release tagged `v0.10.0`). Ranges, partial
 * versions, build metadata and "latest" are not versions.
 */
const EXACT_VERSION = new RegExp(`^v?(${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?)$`);

export type PinCheck = { ok: true; version: string } | { ok: false; message: string };

/**
 * The bare version (`0.10.0`) for an exact version with or without a leading `v`, or null.
 */
export function normalizeVersion(input: string): string | null {
  const match = EXACT_VERSION.exec(input);
  return match ? match[1]! : null;
}

/**
 * The closest exact version to what was written: `"^0.9"` → `"0.9.0"`, `" v0.9.0 "` → `"0.9.0"`.
 */
function suggestVersion(input: string): string | null {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(input);
  if (!match) return null;
  const parts = [match[1], match[2], match[3]].map((part) => String(Number(part ?? "0")));
  const suggestion = parts.join(".");
  return suggestion !== input && normalizeVersion(suggestion) ? suggestion : null;
}

/** A setting that holds a version, as messages name it. */
export interface VersionSetting {
  /** `"chaperoneVersion"`, `"defaultVersion"` or `CHAPERONE_DEFAULT_VERSION` */
  name: string;
  /** What to do instead of "latest" or an empty value, when there is something to say */
  latestHint?: string;
}

const PIN_SETTING: VersionSetting = {
  name: `"${PIN_FIELD}"`,
  latestHint: 'run "chaperone pin" to pin the version you have installed',
};

/** `"defaultVersion"` in the machine's config file (and `chaperone default <version>`). */
export const DEFAULT_FIELD_SETTING: VersionSetting = { name: `"${DEFAULT_FIELD}"` };

/** The `CHAPERONE_DEFAULT_VERSION` environment variable. */
export const DEFAULT_ENV_SETTING: VersionSetting = { name: DEFAULT_ENV };

/**
 * Validate a version setting's value, with a suggestion when it is close to a version.
 */
export function checkVersionValue(value: unknown, setting: VersionSetting): PinCheck {
  if (typeof value !== "string") {
    const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return {
      ok: false,
      message: `${setting.name} must be a string with an exact version, such as "${EXAMPLE_VERSION}" (got ${got})`,
    };
  }

  const version = normalizeVersion(value);
  if (version) return { ok: true, version };

  const base = `${setting.name} must be an exact version, such as "${EXAMPLE_VERSION}"`;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed === "latest" || trimmed === "*" || trimmed === "x" || trimmed === "next") {
    return { ok: false, message: `${base} (got "${value}")${setting.latestHint ? `: ${setting.latestHint}` : ""}` };
  }

  const suggestion = suggestVersion(value);
  const isRange = /^\s*(?:[\^~<>=]|.*(?:\.[x*]|\s-\s|\|\|))/i.test(value);
  return {
    ok: false,
    message: `${base}${isRange ? ", not a range" : ""} (got "${value}")${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`,
  };
}

/**
 * Validate a `chaperoneVersion` value, with a suggestion when it is close to a version.
 */
export function checkPinValue(value: unknown): PinCheck {
  return checkVersionValue(value, PIN_SETTING);
}

const CANONICAL_KEY = PIN_FIELD.toLowerCase();

/** `key` squashed to lowercase letters and digits, and within two edits of `canonical`. */
function isNearMiss(key: string, canonical: string): boolean {
  const squashed = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return squashed === canonical || editDistance(squashed, canonical) <= 2;
}

/**
 * True for a key that is almost `chaperoneVersion` (`chaperone_version`, `chaperoneVerison`,
 * `ChaperoneVersion`, ...). A misspelled pin pins nothing, so it is an error, not a warning.
 */
export function isMisspelledPinKey(key: string): boolean {
  if (key === PIN_FIELD) return false;
  return isNearMiss(key, CANONICAL_KEY);
}

export function misspelledPinKeyMessage(key: string): string {
  return `unknown field "${key}" (did you mean "${PIN_FIELD}"?): a misspelled version pin pins nothing`;
}

/**
 * What a config file says about the version to run.
 * - `none`: no pin, so the installed binary runs;
 * - `pinned`: run `version`;
 * - `invalid`: the pin cannot be used (the installed binary runs, and loading the config fails
 *   with exit code 2, so nothing is checked with an unpinned version).
 */
export type PinState =
  | { kind: "none" }
  | { kind: "pinned"; version: string }
  | { kind: "invalid"; message: string };

/**
 * Read the pin from a parsed config file.
 */
export function readPin(raw: unknown): PinState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "none" };
  const config = raw as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(config, PIN_FIELD)) {
    const check = checkPinValue(config[PIN_FIELD]);
    return check.ok ? { kind: "pinned", version: check.version } : { kind: "invalid", message: check.message };
  }

  const misspelled = Object.keys(config).find(isMisspelledPinKey);
  if (misspelled) return { kind: "invalid", message: misspelledPinKeyMessage(misspelled) };
  return { kind: "none" };
}

const CANONICAL_DEFAULT_KEY = DEFAULT_FIELD.toLowerCase();

/**
 * True for a key in the machine's config file that is almost `defaultVersion`
 * (`default_version`, `defaultVerison`, ...), or that is the project's pin field
 * (`chaperoneVersion`), which sets nothing there. A misspelled default sets nothing, and every
 * repository that does not pin would quietly run the installed version: an error.
 */
export function isMisspelledDefaultKey(key: string): boolean {
  if (key === DEFAULT_FIELD) return false;
  return key === PIN_FIELD || isMisspelledPinKey(key) || isNearMiss(key, CANONICAL_DEFAULT_KEY);
}

export function misspelledDefaultKeyMessage(key: string): string {
  const why =
    key === PIN_FIELD || isMisspelledPinKey(key)
      ? `"${PIN_FIELD}" pins a repository, in its own .chaperone.json`
      : "a misspelled machine default sets nothing";
  return `unknown field "${key}" (did you mean "${DEFAULT_FIELD}"?): ${why}`;
}

/** Where the machine default came from. `label` is the config file as shown in messages. */
export type DefaultOrigin = { kind: "env" } | { kind: "file"; label: string };

/**
 * The machine default: the version this machine runs where nothing pins one.
 * - `none`: there is none, so the installed binary runs;
 * - `set`: run `version`, exactly as if it were pinned;
 * - `invalid`: it cannot be used, and nothing runs (exit code 2).
 */
export type MachineDefault =
  | { kind: "none" }
  | { kind: "set"; version: string; origin: DefaultOrigin }
  | { kind: "invalid"; message: string; origin: DefaultOrigin };

export const NO_DEFAULT: MachineDefault = { kind: "none" };

/** `from CHAPERONE_DEFAULT_VERSION`, or `in ~/.config/chaperone/config.json`. */
export function describeOrigin(origin: DefaultOrigin): string {
  return origin.kind === "env" ? `from ${DEFAULT_ENV}` : `in ${origin.label}`;
}

/**
 * The machine default `CHAPERONE_DEFAULT_VERSION` sets, or null when it is unset or empty (then
 * the config file decides).
 */
export function defaultFromEnv(value: string | undefined): MachineDefault | null {
  if (value === undefined || value === "") return null;
  const origin: DefaultOrigin = { kind: "env" };
  const check = checkVersionValue(value, DEFAULT_ENV_SETTING);
  return check.ok ? { kind: "set", version: check.version, origin } : { kind: "invalid", message: check.message, origin };
}

/**
 * The machine default the machine's config file sets: its `"defaultVersion"`. `text` is the
 * file's content, or null when there is no file; `label` is the file as shown in messages. Other
 * fields are left alone: a later version may add some.
 */
export function defaultFromConfigText(text: string | null, label: string): MachineDefault {
  if (text === null) return NO_DEFAULT;
  const origin: DefaultOrigin = { kind: "file", label };
  const invalid = (message: string): MachineDefault => ({ kind: "invalid", message, origin });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return invalid(`the file is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return invalid(`the file must hold a JSON object, such as { "${DEFAULT_FIELD}": "${EXAMPLE_VERSION}" }`);
  }
  const config = raw as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(config, DEFAULT_FIELD)) {
    const check = checkVersionValue(config[DEFAULT_FIELD], DEFAULT_FIELD_SETTING);
    return check.ok ? { kind: "set", version: check.version, origin } : invalid(check.message);
  }

  const misspelled = Object.keys(config).find(isMisspelledDefaultKey);
  return misspelled ? invalid(misspelledDefaultKeyMessage(misspelled)) : NO_DEFAULT;
}

/**
 * The one-line hint to pin, shown after a text report on an interactive terminal only: never in
 * `--format json` or `ai`, never with `--quiet`, and never when stderr is a pipe (CI, agents).
 */
export function shouldShowPinHint(options: {
  pin: PinState;
  hasConfig: boolean;
  format: string;
  quiet: boolean;
  stderrIsTTY: boolean;
}): boolean {
  return (
    options.pin.kind === "none" &&
    options.hasConfig &&
    options.format === "text" &&
    !options.quiet &&
    options.stderrIsTTY
  );
}

/**
 * The hint's text. When the machine default chose the version that ran (`machineDefault`), it
 * says so, and names the version to pin: `chaperone pin` alone would pin the installed one.
 */
export function formatPinHint(version: string, configLabel: string, machineDefault: { origin: DefaultOrigin } | null = null): string {
  const writes = `(writes "${PIN_FIELD}": "${version}" to ${configLabel})`;
  if (machineDefault) {
    return `Tip: this repository runs the machine default (Chaperone ${version}, ${describeOrigin(machineDefault.origin)}); pin it with "chaperone pin ${version}" ${writes}.`;
  }
  return `Tip: pin Chaperone for this repository with "chaperone pin" ${writes}.`;
}
