/**
 * What the launcher needs from the command line, read before any command parses it. Pure.
 */

import { isAbsolute, join, relative, resolve } from "node:path";

export const CONFIG_FILENAME = ".chaperone.json";

export interface LauncherArgs {
  /** The first argument: the command (or `--version`, `--help`, ...) */
  command: string | undefined;
  /** `--cwd <path>` */
  cwd?: string;
  /** `--config <path>` / `-c <path>` */
  config?: string;
  /** `check --format json`: failures must still print one JSON document on stdout */
  jsonOutput: boolean;
}

/**
 * The options that take a value, per command, as each command's parser defines them. A flag means
 * different things in different commands (`-f` is `--format` in `check` and `--force` in `init`),
 * so reading another command's table would take the wrong value.
 */
const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  check: ["--config", "-c", "--cwd", "--format", "-f", "--since"],
  analyze: ["--config", "-c", "--cwd", "--api-key"],
  init: ["--cwd"],
};
const DEFAULT_VALUE_OPTIONS: readonly string[] = ["--config", "-c", "--cwd"];

/**
 * Find the options that locate the config, the same way the command's own parser reads them
 * (src/utils/args.ts): `--cwd <path>`, `--config <path>`, `-c <path>`, the `--name=value` forms,
 * and never a value that starts with "-" (the parser rejects that as a missing value).
 */
export function scanArgs(args: readonly string[]): LauncherArgs {
  const result: LauncherArgs = { command: args[0], jsonOutput: false };
  const valueOptions = VALUE_OPTIONS[result.command ?? ""] ?? DEFAULT_VALUE_OPTIONS;
  let format: string | undefined;

  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!valueOptions.includes(name)) continue;

    let value: string | undefined;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else {
      const next = args[index + 1];
      if (next === undefined || (next.startsWith("-") && next.length > 1)) continue;
      value = next;
      index++;
    }

    if (name === "--cwd") result.cwd = value;
    else if (name === "--config" || name === "-c") result.config = value;
    else if (name === "--format" || name === "-f") format = value;
  }

  result.jsonOutput = result.command === "check" && format === "json";
  return result;
}

/**
 * The config file a command reads: `<cwd>/.chaperone.json`, or `--config` resolved against
 * `--cwd` (as `check` resolves it).
 */
export function resolveConfigPath(args: LauncherArgs, processCwd: string): string {
  const cwd = resolve(processCwd, args.cwd ?? ".");
  return args.config ? resolve(cwd, args.config) : join(cwd, CONFIG_FILENAME);
}

/** A path for messages: relative to the working directory when inside it. */
export function displayPath(path: string, processCwd: string): string {
  const relativePath = relative(processCwd, path);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath) ? relativePath : path;
}

export type LauncherCommand = "version" | "pin" | "cache" | "default";

/**
 * Commands the launcher answers itself, whatever the pin (or the machine default) says.
 * Everything else runs in the pinned version.
 */
export function launcherCommand(command: string | undefined): LauncherCommand | null {
  if (command === "version" || command === "--version" || command === "-v") return "version";
  if (command === "pin") return "pin";
  if (command === "cache") return "cache";
  if (command === "default") return "default";
  return null;
}
