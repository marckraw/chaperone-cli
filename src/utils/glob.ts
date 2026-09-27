/**
 * Glob matching and file walking for Chaperone.
 *
 * All paths are POSIX paths relative to the project root (no leading "./").
 *
 * Match patterns (rule `files`, `allowedIn`, layer globs, ...) use Bun.Glob syntax:
 * `*`, `**`, `?`, `[abc]` and nested `{a,b}` braces. A trailing `**` matches everything
 * below a directory, `**` segments match zero or more directories, `*` also matches
 * dotfiles, and characters such as `+`, `(` and `)` are literal. A pattern that is equal
 * to the path also matches, so literal paths like `src/app/[id]/page.tsx` work unescaped.
 *
 * Exclude patterns follow .gitignore conventions (see {@link compileExcludes}).
 */

import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

export type PathMatcher = (path: string) => boolean;

const GLOB_META = /[*?[\]{}!\\]/;
const matcherCache = new Map<string, PathMatcher>();

/**
 * Normalize a user-supplied pattern: trim and drop leading "./" segments.
 */
export function normalizeGlob(pattern: string): string {
  let normalized = pattern.trim();
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

/**
 * Whether a pattern contains glob syntax (as opposed to a literal path).
 */
export function hasGlobSyntax(pattern: string): boolean {
  return GLOB_META.test(pattern);
}

/**
 * Compile a glob pattern into a cached matcher function.
 */
export function compileGlob(pattern: string): PathMatcher {
  const normalized = normalizeGlob(pattern);
  const cached = matcherCache.get(normalized);
  if (cached) {
    return cached;
  }

  const glob = new Bun.Glob(normalized);
  const matcher: PathMatcher = (path) => path === normalized || glob.match(path);
  matcherCache.set(normalized, matcher);
  return matcher;
}

/**
 * Match a single relative file path against a glob pattern.
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  return compileGlob(pattern)(normalizeGlob(filePath));
}

/**
 * The literal directory prefix of a pattern: every leading segment without glob syntax.
 * Returns "" when the first segment already contains glob syntax.
 *
 * Examples: "src/**\/*.ts" → "src/", "apps/*\/src" → "apps/", "a/b.ts" → "a/b.ts".
 */
export function staticPrefix(pattern: string): string {
  const normalized = normalizeGlob(pattern);
  const segments = normalized.split("/");
  const literal: string[] = [];

  for (const segment of segments) {
    if (hasGlobSyntax(segment)) {
      return literal.length > 0 ? `${literal.join("/")}/` : "";
    }
    literal.push(segment);
  }

  return literal.join("/");
}

/**
 * Report syntax problems in a glob pattern (unbalanced braces or brackets, empty pattern).
 * Returns null when the pattern looks valid.
 */
export function checkGlobSyntax(pattern: string): string | null {
  if (normalizeGlob(pattern) === "") {
    return "pattern is empty";
  }

  let braces = 0;
  let inClass = false;

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (inClass) {
      if (character === "]") {
        inClass = false;
      }
      continue;
    }
    if (character === "[") {
      inClass = true;
    } else if (character === "{") {
      braces++;
    } else if (character === "}") {
      braces--;
      if (braces < 0) {
        return "has an unmatched '}'";
      }
    }
  }

  if (inClass) {
    return "has an unclosed '['";
  }
  if (braces !== 0) {
    return "has an unclosed '{'";
  }
  return null;
}

export interface CompiledExcludePattern {
  source: string;
  negated: boolean;
  /** Anchored patterns match root-relative paths; unanchored ones match a single path segment. */
  anchored: boolean;
  match: PathMatcher;
  /** For anchored patterns ending in "/**": matches the directory itself so it can be pruned. */
  matchDirectory: PathMatcher | null;
}

export interface ExcludeMatcher {
  readonly patterns: readonly string[];
  /** True when the path, or any of its ancestor directories, is excluded. */
  excludes(path: string): boolean;
}

/**
 * Compile exclude patterns with .gitignore semantics:
 *
 * - A pattern without a slash (e.g. `dist`, `*.log`) matches a file or directory name at any depth.
 * - A pattern with a slash (e.g. `src/generated`, `apps/*\/out`) is anchored to the project root.
 *   A leading `/` anchors a slash-less pattern (`/dist` only matches the top-level `dist`).
 * - An excluded directory excludes everything below it; a trailing `/` or `/**` is optional.
 * - For each file or directory the last matching pattern wins, so `!pattern` re-includes what an
 *   earlier pattern excluded. As in .gitignore, nothing below an excluded directory can be
 *   re-included: re-include the directory itself (`!src/build`) instead.
 */
export function compileExcludes(patterns: readonly string[]): ExcludeMatcher & {
  /** Internal: used by the walker */
  readonly compiled: readonly CompiledExcludePattern[];
} {
  const compiled: CompiledExcludePattern[] = [];

  for (const raw of patterns) {
    let pattern = raw.trim();
    if (pattern === "" || pattern.startsWith("#")) {
      continue;
    }

    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }

    let anchored = false;
    if (pattern.startsWith("/")) {
      anchored = true;
      pattern = pattern.replace(/^\/+/, "");
    }
    if (pattern.startsWith("./")) {
      anchored = true;
      pattern = normalizeGlob(pattern);
    }
    pattern = pattern.replace(/\/+$/, "");
    if (pattern === "") {
      continue;
    }
    if (pattern.includes("/")) {
      anchored = true;
    }

    let matchDirectory: PathMatcher | null = null;
    if (anchored && pattern.endsWith("/**")) {
      const directoryPattern = pattern.slice(0, -3);
      matchDirectory = directoryPattern === "" ? null : compileGlob(directoryPattern);
    }

    compiled.push({ source: raw, negated, anchored, match: compileGlob(pattern), matchDirectory });
  }

  const excludes = (path: string): boolean => {
    const normalized = normalizeGlob(path);
    if (normalized === "") {
      return false;
    }
    const segments = normalized.split("/");
    let prefix = "";
    for (let index = 0; index < segments.length; index++) {
      const name = segments[index]!;
      prefix = index === 0 ? name : `${prefix}/${name}`;
      if (isExcludedEntry(compiled, prefix, name, index < segments.length - 1)) {
        return true;
      }
    }
    return false;
  };

  return { patterns: [...patterns], compiled, excludes };
}

function patternMatchesEntry(
  pattern: CompiledExcludePattern,
  relativePath: string,
  name: string,
  isDirectory: boolean
): boolean {
  if (!pattern.anchored) {
    return pattern.match(name);
  }
  if (pattern.match(relativePath)) {
    return true;
  }
  return isDirectory && pattern.matchDirectory !== null && pattern.matchDirectory(relativePath);
}

/**
 * Whether one entry is excluded by the patterns that match it (the last match wins).
 * Ancestors are checked separately: an excluded directory excludes everything below it.
 */
function isExcludedEntry(
  patterns: readonly CompiledExcludePattern[],
  relativePath: string,
  name: string,
  isDirectory: boolean
): boolean {
  let excluded = false;
  for (const pattern of patterns) {
    if (patternMatchesEntry(pattern, relativePath, name, isDirectory)) {
      excluded = !pattern.negated;
    }
  }
  return excluded;
}

export interface WalkOptions {
  /** Exclude patterns (see {@link compileExcludes}) */
  exclude?: readonly string[];
  /** Relative directory to start from (default: the root) */
  base?: string;
  /** Directory reader, injectable for tests */
  readDirectory?: (absolutePath: string) => Dirent[];
  /** Called for every directory that exists but cannot be read (e.g. permission denied) */
  onUnreadable?: (relativePath: string, error: unknown) => void;
}

const defaultReadDirectory = (absolutePath: string): Dirent[] =>
  readdirSync(absolutePath, { withFileTypes: true });

/**
 * Walk `root` once and return every file path (relative, POSIX, sorted),
 * pruning excluded directories so they are never read.
 *
 * Symlinked files are included; symlinked directories are not followed.
 */
export function walkFiles(root: string, options: WalkOptions = {}): string[] {
  const { exclude = [], base = "", readDirectory = defaultReadDirectory, onUnreadable } = options;
  const matcher = compileExcludes(exclude);
  const { compiled } = matcher;
  const files: string[] = [];

  if (base && matcher.excludes(base)) {
    return [];
  }

  const stack: Array<{ absolute: string; relative: string }> = [
    { absolute: base ? join(root, base) : root, relative: base },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readDirectory(frame.absolute);
    } catch (error) {
      // A missing base directory simply has no files; anything else is reported
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" || frame.relative !== base) {
        onUnreadable?.(frame.relative, error);
      }
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;
      const relativePath = frame.relative ? `${frame.relative}/${name}` : name;
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          isFile = statSync(join(frame.absolute, name)).isFile();
        } catch {
          isFile = false;
        }
        isDirectory = false;
      }

      if (!isDirectory && !isFile) {
        continue;
      }
      if (isExcludedEntry(compiled, relativePath, name, isDirectory)) {
        continue;
      }

      if (isDirectory) {
        stack.push({ absolute: join(frame.absolute, name), relative: relativePath });
      } else {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

export interface GlobOptions {
  cwd?: string;
  ignore?: string[];
  absolute?: boolean;
}

/**
 * Find files matching a glob pattern under `cwd`, honouring `ignore` (exclude semantics).
 * Walks only the pattern's literal base directory.
 */
export function globSync(pattern: string, options: GlobOptions = {}): string[] {
  const { cwd = process.cwd(), ignore = [], absolute = false } = options;
  const normalized = normalizeGlob(pattern);
  const prefix = staticPrefix(normalized);
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
  const matcher = compileGlob(normalized);

  const matches = walkFiles(cwd, { exclude: ignore, base }).filter((file) => matcher(file));
  return absolute ? matches.map((file) => join(cwd, file)) : matches;
}

/**
 * Get all files in a directory recursively, honouring exclude patterns.
 */
export function getAllFiles(dir: string, ignore: string[] = []): string[] {
  return walkFiles(dir, { exclude: ignore });
}
