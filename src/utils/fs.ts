/**
 * File system utilities for Chaperone
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Check if a file exists at the given path
 */
export function fileExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Whether `path` (relative to `root`) exists with exactly this case in every segment. On a
 * case-insensitive filesystem (macOS and Windows by default), existsSync finds `Fancard/` for
 * `FanCard/`; this reads each directory and compares the names.
 */
export function existsCaseExact(
  root: string,
  path: string,
  readDirectory: (directory: string) => string[] = (directory) => readdirSync(directory)
): boolean {
  let directory = root;
  for (const segment of path.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      directory = dirname(directory);
      continue;
    }
    let entries: string[];
    try {
      entries = readDirectory(directory);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    directory = join(directory, segment);
  }
  return true;
}

/**
 * Read and parse a JSON file
 * Returns null if file doesn't exist or is invalid JSON
 */
export function readJsonFile<T>(path: string): T | null {
  try {
    if (!fileExists(path)) {
      return null;
    }
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Read a file as text
 * Returns null if file doesn't exist
 */
export function readTextFile(path: string): string | null {
  try {
    if (!fileExists(path)) {
      return null;
    }
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Find the first existing file from a list of patterns
 * Returns the filename (not full path) if found, null otherwise
 */
export function findFirstExisting(cwd: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    const fullPath = join(cwd, pattern);
    if (fileExists(fullPath)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Join path segments
 */
export function joinPath(...segments: string[]): string {
  return join(...segments);
}
