/**
 * Glob utilities for file pattern matching
 */

import { readdirSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

export interface GlobOptions {
  cwd?: string;
  ignore?: string[];
  absolute?: boolean;
}

/**
 * Simple synchronous glob implementation
 * Supports patterns like: *.ts, **\/*.tsx, src/**\/*
 */
export function globSync(pattern: string, options: GlobOptions = {}): string[] {
  const { cwd = process.cwd(), ignore = [], absolute = false } = options;

  const results: string[] = [];
  const parts = pattern.split("/");

  function matchPattern(str: string, pat: string): boolean {
    // Convert glob pattern to regex
    const regexStr = pat.replace(/\./g, "\\.").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(str);
  }

  function walk(dir: string, patternParts: string[], depth: number): void {
    if (patternParts.length === 0) {
      return;
    }

    const currentPart = patternParts[0];
    const remainingParts = patternParts.slice(1);

    // Handle **
    if (currentPart === "**") {
      // Match current level
      if (remainingParts.length > 0) {
        walk(dir, remainingParts, depth);
      }

      // Recurse into subdirectories
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subdir = join(dir, entry.name);
          walk(subdir, patternParts, depth + 1);
        }
      }
      return;
    }

    // Read directory entries
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!matchPattern(entry.name, currentPart)) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relativePath = relative(cwd, fullPath);

      // Check ignore patterns
      const shouldIgnore = ignore.some((ignorePat) => {
        if (ignorePat.includes("*")) {
          return matchPattern(relativePath, ignorePat);
        }
        return relativePath.startsWith(ignorePat);
      });

      if (shouldIgnore) {
        continue;
      }

      if (remainingParts.length === 0) {
        // This is the final part - add to results
        if (entry.isFile()) {
          results.push(absolute ? fullPath : relativePath);
        }
      } else if (entry.isDirectory()) {
        // Continue walking
        walk(fullPath, remainingParts, depth + 1);
      }
    }
  }

  // Handle absolute patterns
  const startDir = pattern.startsWith("/") ? "/" : pattern.startsWith("./") ? cwd : cwd;

  const normalizedParts = parts.filter((p) => p !== "." && p !== "");
  walk(startDir, normalizedParts, 0);

  return results.sort();
}

/**
 * Match a single file path against a glob pattern
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const patternParts = pattern.split("/").filter((p) => p !== ".");
  const pathParts = filePath.split("/").filter((p) => p !== ".");

  let pi = 0; // pattern index
  let fi = 0; // file index

  while (pi < patternParts.length && fi < pathParts.length) {
    const pat = patternParts[pi];
    const file = pathParts[fi];

    if (pat === "**") {
      // ** matches zero or more directories
      if (pi === patternParts.length - 1) {
        return true; // ** at end matches everything
      }

      // Try matching remaining pattern at each position
      for (let tryFi = fi; tryFi <= pathParts.length; tryFi++) {
        if (matchGlob(pathParts.slice(tryFi).join("/"), patternParts.slice(pi + 1).join("/"))) {
          return true;
        }
      }
      return false;
    }

    // Convert glob pattern to regex for this segment
    const regexStr = pat.replace(/\./g, "\\.").replace(/\*/g, "[^/]*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexStr}$`);

    if (!regex.test(file)) {
      return false;
    }

    pi++;
    fi++;
  }

  // Both should be exhausted
  return pi === patternParts.length && fi === pathParts.length;
}

/**
 * Get all files in a directory recursively
 */
export function getAllFiles(dir: string, ignore: string[] = []): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(dir, fullPath);

      // Check ignore patterns
      const shouldIgnore = ignore.some((ignorePat) => {
        return relativePath.startsWith(ignorePat) || entry.name === ignorePat;
      });

      if (shouldIgnore) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(relativePath);
      }
    }
  }

  walk(dir);
  return results.sort();
}
