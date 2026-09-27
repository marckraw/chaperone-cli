/**
 * Resolve import specifiers to project files the way TypeScript-aware bundlers do:
 *
 * - relative and absolute paths, with extension probing and directory index files;
 * - `.js`/`.jsx`/`.mjs`/`.cjs` specifiers that point at `.ts`/`.tsx`/`.mts`/`.cts` sources;
 * - `compilerOptions.paths` and `baseUrl` from the nearest tsconfig.json (or jsconfig.json)
 *   above the importing file, following `extends` (relative files and packages) and,
 *   when the nearest config has no paths of its own, its project `references`.
 *
 * Bare specifiers that no alias covers (npm packages) resolve to null.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve as resolvePath } from "node:path";
import { parseJsonc } from "./jsonc";

const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".d.ts",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".vue",
  ".svelte",
];

const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

export interface ModuleResolverOptions {
  /** Absolute project root; results are relative POSIX paths from here */
  root: string;
  /** Whether a root-relative file exists (default: the filesystem) */
  fileExists?: (relativePath: string) => boolean;
  /** Resolve `paths`/`baseUrl` aliases from tsconfig.json (default: true) */
  useTsconfigPaths?: boolean;
}

export interface ModuleResolver {
  /** Resolve `specifier` imported from the root-relative `fromFile`; null when unresolvable or external */
  resolve(specifier: string, fromFile: string): string | null;
}

interface CompilerPaths {
  /** Absolute directory `paths` substitutions are relative to */
  pathsBase: string;
  paths: Record<string, string[]>;
}

interface LoadedTsconfig {
  /** Absolute baseUrl, when set */
  baseUrl?: string;
  paths?: CompilerPaths;
  /** Referenced projects (used when this config has no paths of its own) */
  references: LoadedTsconfig[];
}

interface RawTsconfig {
  extends?: string | string[];
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  references?: Array<{ path?: string }>;
}

function readTsconfig(absolutePath: string): RawTsconfig | null {
  try {
    const parsed = parseJsonc(readFileSync(absolutePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as RawTsconfig) : null;
  } catch {
    return null;
  }
}

function resolveExtendsPath(specifier: string, fromDirectory: string): string | null {
  const candidates: string[] = [];
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const base = resolvePath(fromDirectory, specifier);
    candidates.push(base, `${base}.json`, join(base, "tsconfig.json"));
  } else {
    // A package, e.g. "@tsconfig/node20/tsconfig.json" or "@repo/tsconfig/base"
    let directory = fromDirectory;
    for (;;) {
      const base = join(directory, "node_modules", specifier);
      candidates.push(base, `${base}.json`, join(base, "tsconfig.json"));
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function loadTsconfig(absolutePath: string, cache: Map<string, LoadedTsconfig | null>, seen: Set<string>): LoadedTsconfig | null {
  if (cache.has(absolutePath)) return cache.get(absolutePath) ?? null;
  if (seen.has(absolutePath)) return null;
  seen.add(absolutePath);

  const raw = readTsconfig(absolutePath);
  if (!raw) {
    cache.set(absolutePath, null);
    return null;
  }

  const directory = dirname(absolutePath);
  const result: LoadedTsconfig = { references: [] };

  // Later entries in `extends` override earlier ones; the file itself overrides both.
  const parents = typeof raw.extends === "string" ? [raw.extends] : Array.isArray(raw.extends) ? raw.extends : [];
  for (const parentSpecifier of parents) {
    if (typeof parentSpecifier !== "string") continue;
    const parentPath = resolveExtendsPath(parentSpecifier, directory);
    const parent = parentPath ? loadTsconfig(parentPath, cache, seen) : null;
    if (parent) {
      if (parent.baseUrl !== undefined) result.baseUrl = parent.baseUrl;
      if (parent.paths) result.paths = parent.paths;
    }
  }

  const options = raw.compilerOptions ?? {};
  if (typeof options.baseUrl === "string") {
    result.baseUrl = resolvePath(directory, options.baseUrl);
  }
  if (options.paths && typeof options.paths === "object") {
    result.paths = { pathsBase: directory, paths: options.paths };
  }
  // Paths inherited or declared are relative to baseUrl when one is in effect.
  if (result.paths && result.baseUrl !== undefined) {
    result.paths = { ...result.paths, pathsBase: result.baseUrl };
  }

  if (!result.paths && Array.isArray(raw.references)) {
    for (const reference of raw.references) {
      if (typeof reference?.path !== "string") continue;
      const referencePath = resolvePath(directory, reference.path);
      const configPath = referencePath.endsWith(".json") ? referencePath : join(referencePath, "tsconfig.json");
      const loaded = existsSync(configPath) ? loadTsconfig(configPath, cache, seen) : null;
      if (loaded) result.references.push(loaded);
    }
  }

  cache.set(absolutePath, result);
  return result;
}

/**
 * TypeScript's `paths` matching: exact keys win, otherwise the wildcard pattern with
 * the longest prefix. Returns the substituted candidates (absolute paths).
 */
export function matchTsconfigPaths(specifier: string, compilerPaths: CompilerPaths): string[] {
  const { paths, pathsBase } = compilerPaths;
  let bestKey: string | null = null;
  let bestPrefixLength = -1;
  let captured = "";

  for (const key of Object.keys(paths)) {
    const star = key.indexOf("*");
    if (star === -1) {
      if (key === specifier) {
        bestKey = key;
        captured = "";
        break;
      }
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      prefix.length > bestPrefixLength
    ) {
      bestKey = key;
      bestPrefixLength = prefix.length;
      captured = specifier.slice(prefix.length, specifier.length - suffix.length);
    }
  }

  if (bestKey === null) return [];
  const substitutions = paths[bestKey];
  if (!Array.isArray(substitutions)) return [];
  return substitutions
    .filter((substitution): substitution is string => typeof substitution === "string")
    .map((substitution) => resolvePath(pathsBase, substitution.replace("*", captured)));
}

/**
 * Create a resolver for a project root.
 */
export function createModuleResolver(options: ModuleResolverOptions): ModuleResolver {
  const root = resolvePath(options.root);
  const fileExists =
    options.fileExists ??
    ((path: string) => {
      try {
        return statSync(join(root, path)).isFile();
      } catch {
        return false;
      }
    });
  const useTsconfigPaths = options.useTsconfigPaths ?? true;
  const configCache = new Map<string, LoadedTsconfig | null>();
  const nearestConfigCache = new Map<string, LoadedTsconfig | null>();
  const resolutionCache = new Map<string, string | null>();

  const toRelative = (absolutePath: string): string | null => {
    const relativePath = relative(root, absolutePath).split("\\").join("/");
    if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
    return relativePath;
  };

  const probe = (relativePath: string): string | null => {
    const normalized = posix.normalize(relativePath).replace(/\/$/, "");
    if (normalized.startsWith("..") || normalized === ".") return null;
    if (fileExists(normalized)) return normalized;

    const extensionMatch = /\.[cm]?jsx?$/.exec(normalized);
    if (extensionMatch) {
      const stem = normalized.slice(0, -extensionMatch[0].length);
      for (const extension of JS_TO_TS[extensionMatch[0]] ?? []) {
        if (fileExists(stem + extension)) return stem + extension;
      }
    }
    for (const extension of RESOLVE_EXTENSIONS) {
      if (fileExists(normalized + extension)) return normalized + extension;
    }
    for (const extension of RESOLVE_EXTENSIONS) {
      const indexFile = `${normalized}/index${extension}`;
      if (fileExists(indexFile)) return indexFile;
    }
    return null;
  };

  const nearestConfig = (relativeDirectory: string): LoadedTsconfig | null => {
    if (nearestConfigCache.has(relativeDirectory)) return nearestConfigCache.get(relativeDirectory) ?? null;
    let found: LoadedTsconfig | null = null;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = join(root, relativeDirectory, name);
      if (existsSync(candidate)) {
        found = loadTsconfig(candidate, configCache, new Set());
        if (found) break;
      }
    }
    if (!found && relativeDirectory !== "" && relativeDirectory !== ".") {
      const parent = posix.dirname(relativeDirectory);
      found = nearestConfig(parent === "." ? "" : parent);
    }
    nearestConfigCache.set(relativeDirectory, found);
    return found;
  };

  const resolveWithConfig = (specifier: string, config: LoadedTsconfig): string | null => {
    if (config.paths) {
      for (const candidate of matchTsconfigPaths(specifier, config.paths)) {
        const relativeCandidate = toRelative(candidate);
        const resolved = relativeCandidate ? probe(relativeCandidate) : null;
        if (resolved) return resolved;
      }
    }
    if (config.baseUrl !== undefined) {
      const relativeCandidate = toRelative(resolvePath(config.baseUrl, specifier));
      const resolved = relativeCandidate ? probe(relativeCandidate) : null;
      if (resolved) return resolved;
    }
    for (const reference of config.references) {
      const resolved = resolveWithConfig(specifier, reference);
      if (resolved) return resolved;
    }
    return null;
  };

  return {
    resolve(specifier: string, fromFile: string): string | null {
      const fromDirectory = posix.dirname(fromFile.split("\\").join("/"));
      const key = `${fromDirectory}\u0000${specifier}`;
      if (resolutionCache.has(key)) return resolutionCache.get(key) ?? null;

      let resolved: string | null = null;
      // Bundler suffixes such as "./icon.svg?react" do not change the target file
      // (only for paths: a leading "#" is a package subpath import)
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        specifier = specifier.replace(/[?#].*$/, "");
      }
      if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
        resolved = probe(posix.join(fromDirectory === "." ? "" : fromDirectory, specifier));
      } else if (isAbsolute(specifier)) {
        const relativePath = toRelative(specifier);
        resolved = relativePath ? probe(relativePath) : null;
      } else if (useTsconfigPaths) {
        const config = nearestConfig(fromDirectory === "." ? "" : fromDirectory);
        resolved = config ? resolveWithConfig(specifier, config) : null;
      }

      resolutionCache.set(key, resolved);
      return resolved;
    },
  };
}
