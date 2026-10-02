/**
 * The commands the launcher answers itself, whatever version the project pins: `version`, `pin`,
 * `default` and `cache`. Loaded only for those commands.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { EXIT, parseArgs, UsageError } from "../utils/args";
import { scanArgs } from "./argv";
import { setDefaultInConfigText, setPinInConfigText, type DefaultEdit } from "./config-text";
import {
  cacheRoot,
  cachedVersionPath,
  ensureVersion,
  machineConfigFile,
  readFileDefault,
  readMachineConfigText,
  readMachineDefault,
  readProjectPin,
  type MachineConfigFile,
} from "./context";
import { LaunchError } from "./errors";
import { isPartialFile } from "./install";
import {
  checkPinValue,
  checkVersionValue,
  DEFAULT_ENV,
  DEFAULT_FIELD,
  DEFAULT_FIELD_SETTING,
  defaultFromEnv,
  describeOrigin,
  NO_DEFAULT,
  normalizeVersion,
  PIN_FIELD,
} from "./pin";
import { compareVersionsDescending, describeInvalidDefault, fixInvalidDefault, formatVersionLine, isTruthyEnv } from "./plan";

/**
 * `chaperone --version`: the version that runs this project's commands (the pinned one, or where
 * nothing is pinned the machine default), and the launcher's. Exits 2 when the pin is invalid, or
 * when the machine default that would decide here is.
 */
export function runVersion(args: string[], selfVersion: string): number {
  const project = readProjectPin(scanArgs(["version", ...args]));
  const ignorePin = isTruthyEnv(process.env["CHAPERONE_IGNORE_PIN"]);
  const machineDefault = project.pin.kind === "none" ? readMachineDefault() : NO_DEFAULT;
  const runs = project.pin.kind === "pinned" ? project.pin.version : machineDefault.kind === "set" ? machineDefault.version : null;
  let cached = false;
  if (runs !== null && runs !== selfVersion) {
    try {
      cached = existsSync(cachedVersionPath(runs));
    } catch {}
  }
  console.log(
    formatVersionLine({
      selfVersion,
      pin: project.pin,
      configLabel: project.exists ? project.configLabel : null,
      machineDefault,
      cached,
      ignorePin,
    })
  );
  const invalidPin = project.exists && project.pin.kind === "invalid";
  const invalidDefault = machineDefault.kind === "invalid" && !ignorePin;
  return invalidPin || invalidDefault ? EXIT.ERROR : EXIT.OK;
}

const LOCATION_FLAGS = {
  help: { names: ["--help", "-h"], type: "boolean" },
  config: { names: ["--config", "-c"], type: "string" },
  cwd: { names: ["--cwd"], type: "string" },
} as const;

/** Split the positional arguments from the flags (whose values may not start with "-"). */
function splitPositionals(args: readonly string[]): { positionals: string[]; flags: string[] } {
  const positionals: string[] = [];
  const flags: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    flags.push(arg);
    if ((arg === "--config" || arg === "-c" || arg === "--cwd") && args[index + 1] !== undefined) {
      flags.push(args[++index]!);
    }
  }
  return { positionals, flags };
}

function usageError(command: string, message: string): number {
  console.error(`Error: ${message}`);
  console.error(`Run "chaperone ${command} --help" for usage information.`);
  return EXIT.ERROR;
}

const pinHelp = (selfVersion: string) => `
chaperone pin - Pin the Chaperone version this repository runs

USAGE:
  chaperone pin [version] [options]

Writes "${PIN_FIELD}" to .chaperone.json. From then on every chaperone
command in this repository runs that version: the chaperone you installed
downloads it once, checks it against the release's SHA256SUMS.txt, keeps it in
its cache and runs it. Without a version, pins this binary's version
(${selfVersion}). Another version is downloaded and verified first, so a pin
that cannot be installed is never written.

OPTIONS:
  --config, -c <path>   Config file path (default: .chaperone.json)
  --cwd <path>          Working directory (default: current directory)
  --help, -h            Show this help message

EXAMPLES:
  chaperone pin                 Pin ${selfVersion}
  chaperone pin 0.9.0           Pin 0.9.0 (v0.9.0 works too)
`;

/**
 * `chaperone pin [version]`: write the pin, after making sure the version can be installed.
 */
export async function runPin(args: string[], selfVersion: string): Promise<number> {
  const { positionals, flags } = splitPositionals(args);
  let parsed;
  try {
    parsed = parseArgs(flags, LOCATION_FLAGS);
  } catch (error) {
    if (error instanceof UsageError) return usageError("pin", error.message);
    throw error;
  }
  if (parsed.help) {
    console.log(pinHelp(selfVersion));
    return EXIT.OK;
  }
  if (positionals.length > 1) return usageError("pin", `Unexpected argument: ${positionals[1]}`);

  let version = selfVersion;
  if (positionals[0] !== undefined) {
    const check = checkPinValue(positionals[0]);
    if (!check.ok) return usageError("pin", check.message);
    version = check.version;
  }

  const project = readProjectPin({ command: "pin", cwd: parsed.cwd, config: parsed.config, jsonOutput: false });
  if (!project.exists) {
    console.error(`Error: ${project.configLabel} not found. Run "chaperone init" first: it pins the version too.`);
    return EXIT.ERROR;
  }

  let text: string;
  let edit;
  try {
    text = readFileSync(project.configPath, "utf-8");
    edit = setPinInConfigText(text, version);
  } catch (error) {
    console.error(`Error: cannot pin in ${project.configLabel}: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }

  if (edit.text === text) {
    console.log(`${project.configLabel} already pins Chaperone ${version}.`);
    return EXIT.OK;
  }

  if (version !== selfVersion) {
    try {
      await ensureVersion(version, "Pinning");
    } catch (error) {
      if (!(error instanceof LaunchError)) throw error;
      console.error(`Error: ${error.message}`);
      console.error(`${project.configLabel} was not changed.`);
      return EXIT.ERROR;
    }
  }

  writeFileSync(project.configPath, edit.text, "utf-8");
  const previous = typeof edit.previous === "string" ? normalizeVersion(edit.previous) ?? edit.previous : null;
  const notes = [
    previous && previous !== version ? `was ${previous}` : null,
    edit.replacedKey ? `replaced the misspelled "${edit.replacedKey}"` : null,
  ].filter(Boolean);
  console.log(`Pinned Chaperone ${version} in ${project.configLabel}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}.`);
  return EXIT.OK;
}

const defaultHelp = (selfVersion: string, file: string) => `
chaperone default - Set the Chaperone version this machine runs where nothing is pinned

USAGE:
  chaperone default                Show the machine default, and where it comes from
  chaperone default <version>      Set it (downloaded and verified first)
  chaperone default --clear        Remove it

A repository that pins a version ("${PIN_FIELD}" in .chaperone.json) always
runs its pin. Everywhere else, chaperone runs the machine default:
${DEFAULT_ENV} when it is set, otherwise "${DEFAULT_FIELD}" in
  ${file}
Without either, it runs itself (${selfVersion}).

The default is treated exactly like a pin: downloaded once, checked against the
release's SHA256SUMS.txt, cached, and never replaced by another version. A
version that cannot be installed is never written. CHAPERONE_IGNORE_PIN=1
ignores the default too.

OPTIONS:
  --clear       Remove the machine default (other fields in the file stay)
  --help, -h    Show this help message

EXAMPLES:
  chaperone default 0.7.1       Keep repositories that pin nothing on 0.7.1
  chaperone default             Show it
  chaperone default --clear     Repositories that pin nothing run this chaperone
`;

const DEFAULT_FLAGS = {
  help: LOCATION_FLAGS.help,
  clear: { names: ["--clear"], type: "boolean" },
} as const;

/**
 * `chaperone default [<version> | --clear]`: show, set or remove the machine default. A version is
 * downloaded and verified before it is written, as `chaperone pin` does.
 */
export async function runDefault(args: string[], selfVersion: string): Promise<number> {
  const { positionals, flags } = splitPositionals(args);
  let parsed;
  try {
    parsed = parseArgs(flags, DEFAULT_FLAGS);
  } catch (error) {
    if (error instanceof UsageError) return usageError("default", error.message);
    throw error;
  }
  const file = machineConfigFile();
  if (parsed.help) {
    console.log(defaultHelp(selfVersion, file.label));
    return EXIT.OK;
  }
  if (positionals.length > 1) return usageError("default", `Unexpected argument: ${positionals[1]}`);

  const [requested] = positionals;
  if (parsed.clear) {
    if (requested !== undefined) return usageError("default", `--clear takes no version (got "${requested}")`);
    return clearDefault(file, selfVersion);
  }
  if (requested === undefined) return showDefault(file, selfVersion);

  const check = checkVersionValue(requested, DEFAULT_FIELD_SETTING);
  if (!check.ok) return usageError("default", check.message);
  return setDefault(file, check.version, selfVersion);
}

/** `chaperone default`: the machine default and where it comes from. Exits 2 when it is invalid. */
function showDefault(file: MachineConfigFile, selfVersion: string): number {
  const fromEnv = defaultFromEnv(process.env[DEFAULT_ENV]);
  const fromFile = readFileDefault(file);
  const current = fromEnv ?? fromFile;

  if (current.kind === "invalid") {
    console.error(`Error: ${describeInvalidDefault(current)}`);
    const fix = fixInvalidDefault(current.origin);
    console.error(`${fix.charAt(0).toUpperCase()}${fix.slice(1)}.`);
    return EXIT.ERROR;
  }
  if (current.kind === "none") {
    console.log(
      `No machine default: where nothing is pinned, this chaperone (${selfVersion}) runs. ` +
        `Set one with "chaperone default <version>" (written to ${file.label}).`
    );
    return EXIT.OK;
  }

  console.log(`Machine default: Chaperone ${current.version}, ${describeOrigin(current.origin)}.`);
  if (fromEnv && fromFile.kind === "set") {
    console.log(`(${file.label} sets ${fromFile.version}; ${DEFAULT_ENV} overrides it.)`);
  } else if (fromEnv && fromFile.kind === "invalid") {
    console.log(`(${DEFAULT_ENV} overrides ${file.label}, which is invalid: ${fromFile.message})`);
  }
  console.log(`Repositories that pin nothing run it; a repository's own "${PIN_FIELD}" always wins.`);
  return EXIT.OK;
}

/** The machine config file's text, or null when there is none; or, when it cannot be read, an exit code. */
function readForEdit(file: MachineConfigFile, action: string): { text: string | null } | { exit: number } {
  try {
    return { text: readMachineConfigText(file) };
  } catch (error) {
    console.error(`Error: cannot ${action}: cannot read ${file.label}: ${error instanceof Error ? error.message : String(error)}`);
    return { exit: EXIT.ERROR };
  }
}

/** Edit the file's text, or report why it cannot be edited (an exit code). */
function editDefault(file: MachineConfigFile, text: string | null, version: string | null, action: string): DefaultEdit | number {
  try {
    return setDefaultInConfigText(text, version);
  } catch (error) {
    const problem = error instanceof SyntaxError ? `is not valid JSON (${error.message})` : `cannot be edited: ${(error as Error).message}`;
    console.error(`Error: cannot ${action}: ${file.label} ${problem}. Fix or remove it, and run again.`);
    return EXIT.ERROR;
  }
}

/**
 * Replace the file in one step (a temporary file renamed into place), so a run reading it at the
 * same time sees the old content or the new, never half of it.
 */
function writeMachineConfig(file: MachineConfigFile, text: string): void {
  mkdirSync(dirname(file.path), { recursive: true });
  const temporary = `${file.path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text, "utf-8");
    renameSync(temporary, file.path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

/** Say so when CHAPERONE_DEFAULT_VERSION decides in this environment, not the file. */
function noteEnvOverride(file: MachineConfigFile): void {
  const value = process.env[DEFAULT_ENV];
  if (value) console.error(`Note: ${DEFAULT_ENV} is set (${value}), and overrides ${file.label} in this environment.`);
}

async function setDefault(file: MachineConfigFile, version: string, selfVersion: string): Promise<number> {
  const action = "set the machine default";
  // Read and edit first: a file that cannot be edited is reported before anything is downloaded.
  const read = readForEdit(file, action);
  if ("exit" in read) return read.exit;
  const edit = editDefault(file, read.text, version, action);
  if (typeof edit === "number") return edit;

  // Downloaded and verified even when the file already names it: once this succeeds, a run that
  // needs the default works offline.
  if (version !== selfVersion) {
    try {
      await ensureVersion(version, "Setting the machine default to");
    } catch (error) {
      if (!(error instanceof LaunchError)) throw error;
      console.error(`Error: ${error.message}`);
      console.error(`${file.label} was not changed.`);
      return EXIT.ERROR;
    }
  }

  if (edit.unchanged) {
    console.log(`The machine default is already Chaperone ${version} (${file.label}).`);
  } else {
    try {
      writeMachineConfig(file, edit.text);
    } catch (error) {
      console.error(`Error: cannot write ${file.label}: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT.ERROR;
    }
    const previous = typeof edit.previous === "string" ? normalizeVersion(edit.previous) ?? edit.previous : null;
    const notes = [
      previous && previous !== version ? `was ${previous}` : null,
      edit.replacedKey ? `replaced the misspelled "${edit.replacedKey}"` : null,
    ].filter(Boolean);
    console.log(`Set the machine default to Chaperone ${version} in ${file.label}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}.`);
  }
  noteEnvOverride(file);
  return EXIT.OK;
}

function clearDefault(file: MachineConfigFile, selfVersion: string): number {
  const action = "remove the machine default";
  const read = readForEdit(file, action);
  if ("exit" in read) return read.exit;
  const edit = read.text === null ? null : editDefault(file, read.text, null, action);
  if (typeof edit === "number") return edit;

  if (edit === null || edit.unchanged) {
    console.log(`No machine default in ${file.label}: nothing to remove.`);
  } else {
    try {
      writeMachineConfig(file, edit.text);
    } catch (error) {
      console.error(`Error: cannot write ${file.label}: ${error instanceof Error ? error.message : String(error)}`);
      return EXIT.ERROR;
    }
    const was = typeof edit.previous === "string" ? ` (${normalizeVersion(edit.previous) ?? edit.previous})` : "";
    const misspelled = edit.removed.filter((key) => key !== DEFAULT_FIELD);
    const also = misspelled.length > 0 ? `, with the misspelled ${misspelled.map((key) => `"${key}"`).join(", ")}` : "";
    console.log(
      `Removed the machine default${was} from ${file.label}${also}. Where nothing is pinned, this chaperone (${selfVersion}) runs.`
    );
  }
  noteEnvOverride(file);
  return EXIT.OK;
}

const cacheHelp = (root: string) => `
chaperone cache - List or clear the Chaperone versions downloaded for pins

USAGE:
  chaperone cache                   List the cached versions
  chaperone cache clear             Remove every cached version
  chaperone cache clear <version>   Remove one version

The cache is ${root}
(CHAPERONE_CACHE_DIR, or $XDG_CACHE_HOME/chaperone, or ~/.cache/chaperone;
%LOCALAPPDATA%\\chaperone\\cache on Windows). A removed version is downloaded
again the next time a repository that pins it (or the machine default) runs
chaperone.
`;

interface CachedVersion {
  version: string;
  directory: string;
  /** Our files in the directory: binaries and leftover partial downloads */
  files: Array<{ path: string; name: string; bytes: number }>;
}

/** The cache's version directories, newest first. Only files Chaperone writes are listed. */
function listCache(root: string): CachedVersion[] {
  if (!existsSync(root)) return [];
  const versions: CachedVersion[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || normalizeVersion(entry.name) !== entry.name) continue;
    const directory = join(root, entry.name);
    const files = readdirSync(directory)
      .filter((name) => name.startsWith("chaperone-") || isPartialFile(name))
      .map((name) => {
        const path = join(directory, name);
        return { path, name, bytes: statSync(path).size };
      });
    versions.push({ version: entry.name, directory, files });
  }
  return versions.sort((a, b) => compareVersionsDescending(a.version, b.version));
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const totalBytes = (versions: CachedVersion[]) =>
  versions.reduce((sum, version) => sum + version.files.reduce((size, file) => size + file.bytes, 0), 0);

/**
 * `chaperone cache [clear [version]]`. Clearing removes only the files Chaperone wrote (binaries
 * named `chaperone-*` and partial downloads) and then the emptied version directories, so a
 * CHAPERONE_CACHE_DIR pointed at the wrong place loses nothing else.
 */
export function runCache(args: string[]): number {
  const { positionals, flags } = splitPositionals(args);
  let parsed;
  try {
    parsed = parseArgs(flags, { help: LOCATION_FLAGS.help });
  } catch (error) {
    if (error instanceof UsageError) return usageError("cache", error.message);
    throw error;
  }
  const root = cacheRoot();
  if (parsed.help) {
    console.log(cacheHelp(root));
    return EXIT.OK;
  }

  const [action, target, extra] = positionals;
  if (action === undefined || action === "list") {
    const versions = listCache(root);
    if (versions.length === 0) {
      console.log(`Chaperone cache: ${root} (empty)`);
      return EXIT.OK;
    }
    console.log(`Chaperone cache: ${root}`);
    for (const version of versions) {
      const names = version.files.map((file) => (isPartialFile(file.name) ? `${file.name} (interrupted download)` : file.name));
      const size = megabytes(version.files.reduce((sum, file) => sum + file.bytes, 0));
      console.log(`  ${version.version.padEnd(10)} ${size.padStart(9)}  ${names.join(", ") || "(empty)"}`);
    }
    console.log(`${versions.length} version${versions.length === 1 ? "" : "s"}, ${megabytes(totalBytes(versions))}. Clear with "chaperone cache clear [version]".`);
    return EXIT.OK;
  }

  if (action !== "clear") return usageError("cache", `Unknown cache command: ${action}`);
  if (extra !== undefined) return usageError("cache", `Unexpected argument: ${extra}`);

  let only: string | null = null;
  if (target !== undefined) {
    only = normalizeVersion(target);
    if (!only) return usageError("cache", `"${target}" is not a version, such as "0.10.0"`);
  }

  const versions = listCache(root).filter((version) => only === null || version.version === only);
  if (versions.length === 0) {
    console.log(only ? `Chaperone ${only} is not in the cache (${root}).` : `Chaperone cache: ${root} (already empty)`);
    return EXIT.OK;
  }

  const failures: string[] = [];
  let freed = 0;
  for (const version of versions) {
    for (const file of version.files) {
      try {
        unlinkSync(file.path);
        freed += file.bytes;
      } catch (error) {
        failures.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      rmdirSync(version.directory);
    } catch {
      // Not empty: something else lives there, and it stays.
    }
  }

  const label = versions.map((version) => version.version).join(", ");
  console.log(`Removed Chaperone ${label} from ${root} (${megabytes(freed)}).`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`Error: cannot remove ${failure}`);
    return EXIT.ERROR;
  }
  return EXIT.OK;
}
