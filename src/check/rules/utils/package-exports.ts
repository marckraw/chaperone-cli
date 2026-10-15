import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import ts from "typescript";
import { createStaticProject, StaticReadError } from "./typescript-static";

function packageManifest(root: string, name: string): string {
  let directory = resolve(root);
  for (;;) {
    const candidate = join(directory, "node_modules", name, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw new StaticReadError(`Installed package "${name}" was not found`, candidate);
    directory = parent;
  }
}

/** Collect export targets without loading any runtime package code. */
function targets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value && typeof value === "object") return Object.values(value).flatMap(targets);
  return [];
}

export function readPackageExportNames(root: string, name: string): Set<string> {
  const manifest = packageManifest(root, name);
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("expected an object");
  } catch (error) {
    throw new StaticReadError(`Cannot read package.json for "${name}": ${error instanceof Error ? error.message : String(error)}`, manifest);
  }
  const packageRoot = dirname(manifest);
  const names = new Set<string>();
  const entries: string[] = [];
  const addName = (subpath: string) => {
    const value = basename(subpath).replace(/\.(?:[cm]?[jt]sx?|json)$/, "");
    if (value !== "." && value !== "default" && !value.includes("*")) names.add(value);
  };
  const exports = pkg["exports"];
  const exportEntries = exports && typeof exports === "object" && !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith(".")) ? Object.entries(exports) : [[".", exports] as const];
  for (const [subpath, value] of exportEntries) {
    if (value === null) continue;
    if (subpath !== "." && !subpath.includes("*")) addName(subpath);
    const paths = targets(value);
    const declarations = paths.filter((path) => /\.d\.[cm]?ts$/.test(path));
    for (const target of declarations.length > 0 ? declarations : paths) {
      if (!/\.[cm]?[jt]sx?$/.test(target)) continue;
      if (target.includes("*")) {
        const star = target.indexOf("*");
        for (const file of new Bun.Glob(target).scanSync({ cwd: packageRoot, onlyFiles: true })) {
          const normalized = file.startsWith("./") ? file : `./${file}`;
          const captured = normalized.slice(star, normalized.length - target.slice(star + 1).length);
          if (subpath.includes("*")) addName(subpath.replaceAll("*", captured));
          entries.push(resolve(packageRoot, file));
        }
      } else if (existsSync(resolve(packageRoot, target))) {
        entries.push(resolve(packageRoot, target));
      }
    }
  }
  // Older packages have only types/typings, or an index declaration next to main.
  for (const fallback of [pkg["types"], pkg["typings"], "index.d.ts"]) {
    if (typeof fallback === "string" && existsSync(resolve(packageRoot, fallback))) entries.push(resolve(packageRoot, fallback));
  }
  if (entries.length > 0) {
    const project = createStaticProject(packageRoot, [...new Set(entries)]);
    for (const source of project.program.getSourceFiles()) {
      project.assertParsed(source);
      // A missing barrel target must not silently produce an incomplete name list.
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
          const module = project.checker.getSymbolAtLocation(statement.moduleSpecifier);
          if (!module) throw new StaticReadError(`Cannot resolve exported module ${statement.moduleSpecifier.getText()}`, source.fileName);
        }
      }
    }
    for (const entry of entries) {
      for (const symbol of project.exportsOf(project.source(entry))) {
        if (!["default", "export=", "__esModule"].includes(symbol.name)) names.add(symbol.name);
      }
    }
  }
  if (names.size === 0) throw new StaticReadError(`No exported names could be read from "${name}" (exports map or type declarations required)`, manifest);
  return names;
}
