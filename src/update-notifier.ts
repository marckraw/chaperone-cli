import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { VERSION } from "./version";

const CACHE_DIR = join(homedir(), ".chaperone");
const CACHE_FILE = join(CACHE_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 3000;
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/marckraw/chaperone-cli/releases/latest";
const DOWNLOAD_URL = "https://github.com/marckraw/chaperone-cli/releases/latest";

export interface UpdateCache {
  lastChecked: number;
  latestVersion: string;
  currentVersion: string;
}

// --- Pure functions ---

export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, "").split(".").map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

export function evaluateCache(
  cache: UpdateCache | null,
  currentVersion: string,
): { current: string; latest: string } | null {
  if (!cache) return null;
  if (compareSemver(cache.latestVersion, currentVersion) > 0) {
    return { current: currentVersion, latest: cache.latestVersion };
  }
  return null;
}

export function isCacheStale(
  cache: UpdateCache | null,
  ttlMs: number = CACHE_TTL_MS,
): boolean {
  if (!cache) return true;
  return Date.now() - cache.lastChecked > ttlMs;
}

export function formatUpdateNotice(current: string, latest: string): string {
  const yellow = "\x1b[33m";
  const cyan = "\x1b[36m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  return [
    "",
    `${yellow}╭─────────────────────────────────────────╮${reset}`,
    `${yellow}│${reset}  Update available: ${current} → ${bold}${cyan}${latest}${reset}  ${yellow}│${reset}`,
    `${yellow}│${reset}  ${cyan}${DOWNLOAD_URL}${reset}  ${yellow}│${reset}`,
    `${yellow}╰─────────────────────────────────────────╯${reset}`,
    "",
  ].join("\n");
}

// --- I/O functions ---

export function readCache(): UpdateCache | null {
  try {
    const data = readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (
      typeof parsed.lastChecked === "number" &&
      typeof parsed.latestVersion === "string" &&
      typeof parsed.currentVersion === "string"
    ) {
      return parsed as UpdateCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCache(data: UpdateCache): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data), "utf-8");
  } catch {
    // Silent failure — never crash the CLI
  }
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(GITHUB_RELEASES_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { tag_name?: string };
    if (typeof data.tag_name !== "string") return null;

    return data.tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

// --- Entry points ---

export function getUpdateNotification(): string | null {
  const cache = readCache();
  const update = evaluateCache(cache, VERSION);
  if (!update) return null;
  return formatUpdateNotice(update.current, update.latest);
}

export async function refreshUpdateCache(): Promise<void> {
  const cache = readCache();
  if (!isCacheStale(cache)) return;

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return;

  writeCache({
    lastChecked: Date.now(),
    latestVersion,
    currentVersion: VERSION,
  });
}
