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
  prefix: string;
}

export interface ExcludeMatcher {
  readonly patterns: readonly string[];
  /** True when the path, or any of its ancestor directories, is excluded. */
  excludes(path: string): boolean;
}

/**
 * Compile exclude patterns with .gitignore-like semantics:
 *
 * - A pattern without a slash (e.g. `dist`, `*.log`) matches a file or directory name at any depth.
 * - A pattern with a slash (e.g. `src/generated`, `apps/*\/out`) is anchored to the project root.
 *   A leading `/` anchors a slash-less pattern (`/dist` only matches the top-level `dist`).
 * - Matching a directory excludes everything below it; a trailing `/` or `/**` is optional.
 * - Patterns are evaluated in order and the last match wins; `!pattern` re-includes paths an
 *   earlier pattern excluded.
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

    compiled.push({
      source: raw,
      negated,
      anchored,
      match: compileGlob(pattern),
      matchDirectory,
      prefix: anchored ? staticPrefix(pattern) : "",
    });
  }

  const excludes = (path: string): boolean => {
    const normalized = normalizeGlob(path);
    if (normalized === "") {
      return false;
    }
    const segments = normalized.split("/");
    let state = false;

    for (const pattern of compiled) {
      if (patternMatchesPathOrAncestor(pattern, normalized, segments)) {
        state = !pattern.negated;
      }
    }

    return state;
  };

  return { patterns: [...patterns], compiled, excludes };
}

function patternMatchesPathOrAncestor(
  pattern: CompiledExcludePattern,
  path: string,
  segments: string[]
): boolean {
  if (!pattern.anchored) {
    return segments.some((segment) => pattern.match(segment));
  }

  if (pattern.match(path)) {
    return true;
  }

  let ancestor = "";
  for (let index = 0; index < segments.length - 1; index++) {
    ancestor = index === 0 ? segments[0]! : `${ancestor}/${segments[index]}`;
    if (pattern.match(ancestor) || pattern.matchDirectory?.(ancestor)) {
      return true;
    }
  }

  return false;
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
 * Whether a negated pattern could re-include something below `directory`
 * (in which case the walker must not prune it).
 */
function mayReinclude(patterns: readonly CompiledExcludePattern[], directory: string): boolean {
  return patterns.some((pattern) => {
    if (!pattern.negated) {
      return false;
    }
    if (!pattern.anchored || pattern.prefix === "") {
      return true;
    }
    const prefix = pattern.prefix.replace(/\/$/, "");
    return prefix === directory || prefix.startsWith(`${directory}/`) || directory.startsWith(`${prefix}/`);
  });
}

export interface WalkOptions {
  /** Exclude patterns (see {@link compileExcludes}) */
  exclude?: readonly string[];
  /** Relative directory to start from (default: the root) */
  base?: string;
  /** Directory reader, injectable for tests */
  readDirectory?: (absolutePath: string) => Dirent[];
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
  const { exclude = [], base = "", readDirectory = defaultReadDirectory } = options;
  const { compiled } = compileExcludes(exclude);
  const files: string[] = [];
  const hasNegation = compiled.some((pattern) => pattern.negated);

  type Frame = { absolute: string; relative: string; matched: boolean[] };
  const initial: boolean[] = compiled.map(() => false);
  const stack: Frame[] = [{ absolute: base ? join(root, base) : root, relative: base, matched: initial }];

  if (base) {
    // Apply excludes to the ancestors of the starting directory.
    const segments = base.split("/");
    stack[0]!.matched = compiled.map((pattern) =>
      patternMatchesPathOrAncestor(pattern, base, segments)
    );
    if (decide(compiled, stack[0]!.matched) && !mayReinclude(compiled, base)) {
      return [];
    }
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readDirectory(frame.absolute);
    } catch {
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

      const matched = frame.matched.map(
        (already, index) =>
          already || patternMatchesEntry(compiled[index]!, relativePath, name, isDirectory)
      );
      const excluded = decide(compiled, matched);

      if (isDirectory) {
        if (excluded && !(hasNegation && mayReinclude(compiled, relativePath))) {
          continue;
        }
        stack.push({ absolute: join(frame.absolute, name), relative: relativePath, matched });
      } else if (!excluded) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

function decide(patterns: readonly CompiledExcludePattern[], matched: readonly boolean[]): boolean {
  for (let index = patterns.length - 1; index >= 0; index--) {
    if (matched[index]) {
      return !patterns[index]!.negated;
    }
  }
  return false;
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
