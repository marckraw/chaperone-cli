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

const takesValue = (arg: string, ...names: string[]) => names.includes(arg);

/**
 * Find the options that locate the config, the same way `check` and `analyze` read them:
 * `--cwd <path>`, `--config <path>`, `-c <path>`, and the `--name=value` forms.
 */
export function scanArgs(args: readonly string[]): LauncherArgs {
  const result: LauncherArgs = { command: args[0], jsonOutput: false };
  let format: string | undefined;

  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    const next = (): string | undefined => {
      if (inline !== undefined) return inline;
      const value = args[index + 1];
      if (value === undefined) return undefined;
      index++;
      return value;
    };

    if (takesValue(name, "--cwd")) result.cwd = next();
    else if (takesValue(name, "--config", "-c")) result.config = next();
    else if (takesValue(name, "--format", "-f")) format = next();
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

export type LauncherCommand = "version" | "pin" | "cache";

/**
 * Commands the launcher answers itself, whatever the pin says. Everything else runs in the
 * pinned version.
 */
export function launcherCommand(command: string | undefined): LauncherCommand | null {
  if (command === "version" || command === "--version" || command === "-v") return "version";
  if (command === "pin") return "pin";
  if (command === "cache") return "cache";
  return null;
}
