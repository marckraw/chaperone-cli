/**
 * The launcher's view of this machine and project: where the cache is, what the config pins, and
 * the machine default.
 */

import { existsSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { CONFIG_FILENAME, displayPath, resolveConfigPath, type LauncherArgs } from "./argv";
import { LaunchError, NetworkError } from "./errors";
import {
  cachedBinaryPath,
  DEFAULT_RELEASES_URL,
  homeRelativePath,
  releaseAsset,
  resolveCacheRoot,
  resolveMachineConfigPath,
} from "./paths";
import { DEFAULT_ENV, defaultFromConfigText, defaultFromEnv, readPin, type MachineDefault, type PinState } from "./pin";

export interface ProjectPin {
  /** Absolute path of the config file */
  configPath: string;
  /** The config file as shown in messages (`.chaperone.json`) */
  configLabel: string;
  /** The config file exists */
  exists: boolean;
  pin: PinState;
}

/**
 * Read the pin from the config file a command would load. A file that cannot be read or parsed
 * pins nothing usable; loading it reports the problem (exit code 2).
 */
export function readProjectPin(args: LauncherArgs, processCwd: string = process.cwd()): ProjectPin {
  const configPath = resolveConfigPath(args, processCwd);
  const configLabel = args.config || args.cwd ? displayPath(configPath, processCwd) : CONFIG_FILENAME;
  if (!existsSync(configPath)) return { configPath, configLabel, exists: false, pin: { kind: "none" } };

  try {
    return { configPath, configLabel, exists: true, pin: readPin(JSON.parse(readFileSync(configPath, "utf-8"))) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { configPath, configLabel, exists: true, pin: { kind: "invalid", message: `cannot read the config: ${message}` } };
  }
}

export interface MachineConfigFile {
  /** Absolute path */
  path: string;
  /** As shown in messages: `~/.config/chaperone/config.json` */
  label: string;
}

/** The machine's config file (whether or not it exists), which holds the machine default. */
export function machineConfigFile(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): MachineConfigFile {
  const path = resolveMachineConfigPath({ env, platform: process.platform, home });
  return { path, label: homeRelativePath(path, home, process.platform) };
}

/**
 * The machine config file's text, or null when there is none.
 *
 * @throws when it exists but cannot be read
 */
export function readMachineConfigText(file: MachineConfigFile): string | null {
  try {
    return readFileSync(file.path, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** The machine default the config file sets. A file that cannot be read sets an invalid one. */
export function readFileDefault(file: MachineConfigFile): MachineDefault {
  try {
    return defaultFromConfigText(readMachineConfigText(file), file.label);
  } catch (error) {
    const message = `the file cannot be read (${error instanceof Error ? error.message : String(error)})`;
    return { kind: "invalid", message, origin: { kind: "file", label: file.label } };
  }
}

/**
 * The machine default: CHAPERONE_DEFAULT_VERSION when it is set and not empty, otherwise
 * `"defaultVersion"` in the machine config file (which is then the only thing read). The launcher
 * reads it only where nothing is pinned: a repository's own pin always wins.
 */
export function readMachineDefault(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): MachineDefault {
  return defaultFromEnv(env[DEFAULT_ENV]) ?? readFileDefault(machineConfigFile(env, home));
}

/**
 * Write launcher messages to stderr, each line prefixed with `chaperone:`. Synchronous, so they
 * are out before an exec replaces the process.
 */
export function logLine(message: string): void {
  writeSync(2, message.split("\n").map((line) => `chaperone: ${line}\n`).join(""));
}

export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolveCacheRoot({ env, platform: process.platform, home: homedir(), cwd: process.cwd() });
}

export function releasesUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env["CHAPERONE_RELEASES_URL"] || DEFAULT_RELEASES_URL;
}

/**
 * This platform's release asset.
 *
 * @throws {LaunchError} when no binary is published for this platform
 */
export function platformAsset(): string {
  const asset = releaseAsset(process.platform, process.arch);
  if (!asset) {
    throw new LaunchError(
      `no Chaperone release binary exists for ${process.platform}-${process.arch}, so a pinned version cannot be ` +
        "installed here. Nothing ran: Chaperone never falls back to another version."
    );
  }
  return asset;
}

/** Where `version` lives in the cache (whether or not it is there). */
export function cachedVersionPath(version: string, env: NodeJS.ProcessEnv = process.env): string {
  return cachedBinaryPath(cacheRoot(env), version, platformAsset(), process.platform);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The cached binary for `version`, downloading and verifying it first when it is not cached.
 *
 * @throws {LaunchError} when it is not cached and cannot be installed
 */
export async function ensureVersion(version: string, why: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const binaryPath = cachedVersionPath(version, env);
  if (existsSync(binaryPath)) return binaryPath;

  const url = releasesUrl(env);
  try {
    const { installRelease } = await import("./install");
    return await installRelease({ version, asset: platformAsset(), binaryPath, releasesUrl: url, log: logLine });
  } catch (error) {
    if (!(error instanceof LaunchError)) throw error;
    const next =
      error instanceof NetworkError
        ? ` Run again once ${hostOf(url)} is reachable, or set CHAPERONE_RELEASES_URL to a mirror.`
        : "";
    throw new LaunchError(
      [
        `${why} Chaperone ${version}, which is not in the cache (${binaryPath}), and installing it failed:`,
        `  ${error.message}`,
        `Nothing ran: Chaperone never falls back to another version.${next}`,
      ].join("\n")
    );
  }
}
