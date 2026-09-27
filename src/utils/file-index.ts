/**
 * A single walk of the project tree, shared by every rule in a run.
 *
 * The index holds every file that survives the global exclude patterns (excluded
 * directories are pruned, never read), answers glob queries from memory, and caches
 * file contents lazily so each file is read at most once per run.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileExcludes, compileGlob, normalizeGlob, staticPrefix, walkFiles } from "./glob";

export interface FileIndex {
  /** Absolute project root */
  readonly root: string;
  /** Every indexed file: relative POSIX paths, sorted */
  readonly files: readonly string[];
  /** Whether the file is in the index */
  has(path: string): boolean;
  /** Whether the directory contains at least one indexed file */
  hasDirectory(path: string): boolean;
  /** Direct child directories of `directory` ("" for the root) that contain indexed files */
  childDirectories(directory: string): string[];
  /** Indexed files matching `pattern`, minus files matching `exclude` (exclude semantics) */
  glob(pattern: string, exclude?: readonly string[]): string[];
  /** Read a file relative to the root (cached). Returns null when it cannot be read. */
  read(path: string): string | null;
  /** Directories the walk could not read and files that could not be read, so far */
  unreadable(): string[];
}

export interface FileIndexOptions {
  exclude?: readonly string[];
  /** Pre-computed file list (for tests); skips the walk */
  files?: readonly string[];
}

export function createFileIndex(root: string, options: FileIndexOptions = {}): FileIndex {
  const unreadable = new Set<string>();
  const files = options.files
    ? [...options.files].sort()
    : walkFiles(root, {
        exclude: options.exclude ?? [],
        onUnreadable: (path) => unreadable.add(path === "" ? "." : `${path}/`),
      });
  const fileSet = new Set(files);
  const contentCache = new Map<string, string | null>();
  const globCache = new Map<string, string[]>();
  let directories: Map<string, Set<string>> | null = null;

  const getDirectories = (): Map<string, Set<string>> => {
    if (directories) {
      return directories;
    }
    directories = new Map([["", new Set<string>()]]);
    for (const file of files) {
      const segments = file.split("/");
      let parent = "";
      for (let index = 0; index < segments.length - 1; index++) {
        const directory = parent ? `${parent}/${segments[index]}` : segments[index]!;
        if (!directories.has(directory)) {
          directories.set(directory, new Set());
        }
        directories.get(parent)!.add(directory);
        parent = directory;
      }
    }
    return directories;
  };

  const candidatesFor = (pattern: string): readonly string[] => {
    const prefix = staticPrefix(pattern);
    if (prefix === "") {
      return files;
    }
    // Files are sorted, so everything sharing the literal prefix is one contiguous range.
    const start = lowerBound(files, prefix);
    let end = start;
    while (end < files.length && files[end]!.startsWith(prefix)) {
      end++;
    }
    return files.slice(start, end);
  };

  return {
    root,
    files,
    unreadable: () => [...unreadable].sort(),
    has: (path) => fileSet.has(normalizeGlob(path)),
    hasDirectory: (path) => getDirectories().has(normalizeGlob(path).replace(/\/$/, "")),
    childDirectories: (directory) => {
      const children = getDirectories().get(normalizeGlob(directory).replace(/\/$/, ""));
      return children ? [...children].sort() : [];
    },
    glob(pattern, exclude = []) {
      const normalized = normalizeGlob(pattern);
      const key = `${normalized}\u0000${exclude.join("\u0001")}`;
      const cached = globCache.get(key);
      if (cached) {
        return cached;
      }

      const matcher = compileGlob(normalized);
      let matches = candidatesFor(normalized).filter((file) => matcher(file));
      if (exclude.length > 0) {
        const excludeMatcher = compileExcludes(exclude);
        matches = matches.filter((file) => !excludeMatcher.excludes(file));
      }

      globCache.set(key, matches);
      return matches;
    },
    read(path) {
      const normalized = normalizeGlob(path);
      if (contentCache.has(normalized)) {
        return contentCache.get(normalized) ?? null;
      }
      let content: string | null;
      try {
        content = readFileSync(join(root, normalized), "utf-8");
      } catch {
        content = null;
        // An indexed file that cannot be read is a gap in the check, not a pass
        if (fileSet.has(normalized)) unreadable.add(normalized);
      }
      contentCache.set(normalized, content);
      return content;
    },
  };
}

function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
