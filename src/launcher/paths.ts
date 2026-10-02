/**
 * Where pinned versions come from and where they are kept, and where the machine's config file
 * is. Pure: the environment, platform and home directory are passed in.
 */

import { posix, win32 } from "node:path";

/** Releases are downloaded from `<base>/v<version>/<file>`. */
export const DEFAULT_RELEASES_URL = "https://github.com/marckraw/chaperone-cli/releases/download";

/** Every release publishes this file next to its binaries: `<sha256>  <asset>` per line. */
export const CHECKSUMS_FILE = "SHA256SUMS.txt";

/**
 * The release asset for a platform, as `build.ts` names it, or null when no binary is published
 * for that platform.
 */
export function releaseAsset(platform: string, arch: string): string | null {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : null;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!os || !cpu || (os === "windows" && cpu !== "x64")) return null;
  return `chaperone-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
}

export interface CacheLocationInput {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  home: string;
  /** Resolves a relative CHAPERONE_CACHE_DIR */
  cwd: string;
}

/**
 * The cache root, holding one directory per version:
 * 1. `CHAPERONE_CACHE_DIR`, when set;
 * 2. `$XDG_CACHE_HOME/chaperone`, when XDG_CACHE_HOME is an absolute path (any platform);
 * 3. Windows: `%LOCALAPPDATA%\chaperone\cache`;
 * 4. macOS and Linux: `~/.cache/chaperone`. (Not `~/Library/Caches` on macOS: macOS may purge it
 *    when the disk runs low, and a purged pin fails offline.)
 */
export function resolveCacheRoot({ env, platform, home, cwd }: CacheLocationInput): string {
  const path = platform === "win32" ? win32 : posix;
  const override = env["CHAPERONE_CACHE_DIR"];
  if (override) return path.resolve(cwd, override);

  const xdg = env["XDG_CACHE_HOME"];
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "chaperone");

  if (platform === "win32") {
    const localAppData = env["LOCALAPPDATA"] || path.join(home, "AppData", "Local");
    return path.join(localAppData, "chaperone", "cache");
  }
  return path.join(home, ".cache", "chaperone");
}

export interface ConfigLocationInput {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  home: string;
}

/**
 * The machine's config file, which holds the machine default (`"defaultVersion"`), found the way
 * the cache root is:
 * 1. `$XDG_CONFIG_HOME/chaperone/config.json`, when XDG_CONFIG_HOME is an absolute path (any
 *    platform);
 * 2. Windows: `%APPDATA%\chaperone\config.json`;
 * 3. macOS and Linux: `~/.config/chaperone/config.json`.
 */
export function resolveMachineConfigPath({ env, platform, home }: ConfigLocationInput): string {
  const path = platform === "win32" ? win32 : posix;
  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg && path.isAbsolute(xdg)) return path.join(xdg, "chaperone", "config.json");

  if (platform === "win32") {
    const appData = env["APPDATA"] || path.join(home, "AppData", "Roaming");
    return path.join(appData, "chaperone", "config.json");
  }
  return path.join(home, ".config", "chaperone", "config.json");
}

/** A path for messages: `~/.config/...` for a path inside the home directory (outside Windows). */
export function homeRelativePath(path: string, home: string, platform: string): string {
  if (platform === "win32" || home === "" || home === "/") return path;
  const prefix = home.endsWith("/") ? home : `${home}/`;
  return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path;
}

/** `<root>/<version>/<asset>`: one directory per version, so clearing one version is one rmdir. */
export function cachedBinaryPath(root: string, version: string, asset: string, platform: string): string {
  return (platform === "win32" ? win32 : posix).join(root, version, asset);
}

/** The URL of a release file (`SHA256SUMS.txt` or a binary). Tags are `v<version>`. */
export function releaseFileUrl(baseUrl: string, version: string, file: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v${version}/${file}`;
}

/**
 * The expected SHA-256 (lowercase hex) of `asset` in a SHA256SUMS.txt (`shasum -a 256` output:
 * `<hash>  <name>`, or `<hash> *<name>` in binary mode), or null when it has no entry.
 */
export function findChecksum(sums: string, asset: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match && match[2] === asset) return match[1]!.toLowerCase();
  }
  return null;
}
