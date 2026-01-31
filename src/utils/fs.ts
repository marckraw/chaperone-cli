/**
 * File system utilities for Chaperone
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Check if a file exists at the given path
 */
export function fileExists(path: string): boolean {
  return existsSync(path);
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
