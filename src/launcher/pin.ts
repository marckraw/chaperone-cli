/**
 * The version pin: `"chaperoneVersion": "0.10.0"` in a project's .chaperone.json.
 *
 * Pure: no I/O. The launcher reads the pin with {@link readPin} before anything else runs, and
 * the config schema validates it with {@link checkPinValue} and {@link isMisspelledPinKey}, so both
 * agree on what a valid pin is.
 */

import { editDistance } from "../utils/suggest";

export const PIN_FIELD = "chaperoneVersion";

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

/**
 * Validate a `chaperoneVersion` value, with a suggestion when it is close to a version.
 */
export function checkPinValue(value: unknown): PinCheck {
  if (typeof value !== "string") {
    const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return {
      ok: false,
      message: `"${PIN_FIELD}" must be a string with an exact version, such as "${EXAMPLE_VERSION}" (got ${got})`,
    };
  }

  const version = normalizeVersion(value);
  if (version) return { ok: true, version };

  const base = `"${PIN_FIELD}" must be an exact version, such as "${EXAMPLE_VERSION}"`;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed === "latest" || trimmed === "*" || trimmed === "x" || trimmed === "next") {
    return {
      ok: false,
      message: `${base} (got "${value}"): run "chaperone pin" to pin the version you have installed`,
    };
  }

  const suggestion = suggestVersion(value);
  const isRange = /^\s*(?:[\^~<>=]|.*(?:\.[x*]|\s-\s|\|\|))/i.test(value);
  return {
    ok: false,
    message: `${base}${isRange ? ", not a range" : ""} (got "${value}")${suggestion ? ` (did you mean "${suggestion}"?)` : ""}`,
  };
}

const CANONICAL_KEY = PIN_FIELD.toLowerCase();

/**
 * True for a key that is almost `chaperoneVersion` (`chaperone_version`, `chaperoneVerison`,
 * `ChaperoneVersion`, ...). A misspelled pin pins nothing, so it is an error, not a warning.
 */
export function isMisspelledPinKey(key: string): boolean {
  if (key === PIN_FIELD) return false;
  const squashed = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return squashed === CANONICAL_KEY || editDistance(squashed, CANONICAL_KEY) <= 2;
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

export function formatPinHint(version: string, configLabel: string): string {
  return `Tip: pin Chaperone for this repository with "chaperone pin" (writes "${PIN_FIELD}": "${version}" to ${configLabel}).`;
}
