/**
 * ANSI colour helpers that switch off cleanly for non-interactive output.
 */

export interface Palette {
  reset: string;
  bold: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  cyan: string;
  magenta: string;
}

const ANSI: Palette = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const PLAIN: Palette = {
  reset: "",
  bold: "",
  dim: "",
  red: "",
  green: "",
  yellow: "",
  blue: "",
  cyan: "",
  magenta: "",
};

export function createPalette(enabled: boolean): Palette {
  return enabled ? ANSI : PLAIN;
}

/**
 * Whether to colour output written to `stream`.
 * NO_COLOR (any value) disables colour, FORCE_COLOR (anything but "0") forces it,
 * otherwise colour is used only on interactive terminals.
 */
export function shouldUseColor(
  stream: { isTTY?: boolean },
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "") return force !== "0";
  return Boolean(stream.isTTY);
}

const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Remove ANSI escape sequences from a string.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
