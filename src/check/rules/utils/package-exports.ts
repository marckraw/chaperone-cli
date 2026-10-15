import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createStaticProject, nodeLocation, StaticReadError } from "./typescript-static";

export interface PackageExportWarning {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface PackageExportNames {
  names: Set<string>;
  warnings: PackageExportWarning[];
}

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

const CODE_PATH = /\.[cm]?[jt]sx?$/;

export function readPackageExportNames(
  ts: typeof import("typescript"), root: string, name: string, includeTypes: boolean
): PackageExportNames {
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
  const typeNames = new Set<string>();
  const componentSubpaths = new Set<string>();
  const warnings: PackageExportWarning[] = [];
  const entries: string[] = [];
  const addSubpath = (subpath: string) => {
    // An exports-map path describes a module, not necessarily a component.
    // Lowercase names are reserved only if discovered as actual identifiers below.
    if (/\.[^/]+$/.test(subpath) && !CODE_PATH.test(subpath)) return;
    const value = basename(subpath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/, "");
    if (/^[A-Z][A-Za-z0-9]*$/.test(value)) componentSubpaths.add(value);
  };
  const exports = pkg["exports"];
  const exportEntries = exports && typeof exports === "object" && !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith(".")) ? Object.entries(exports) : [[".", exports] as const];
  for (const [subpath, value] of exportEntries) {
    if (value === null || (/\.[^/]+$/.test(subpath) && !CODE_PATH.test(subpath))) continue;
    const paths = targets(value).filter((path) => CODE_PATH.test(path));
    if (paths.length === 0) continue; // package.json, styles and assets expose no identifiers.
    if (subpath !== "." && !subpath.includes("*")) addSubpath(subpath);
    const declarations = paths.filter((path) => /\.d\.[cm]?ts$/.test(path));
    for (const target of declarations.length > 0 ? declarations : paths) {
      if (target.includes("*")) {
        const star = target.indexOf("*");
        for (const file of new Bun.Glob(target).scanSync({ cwd: packageRoot, onlyFiles: true })) {
          const normalized = file.startsWith("./") ? file : `./${file}`;
          const captured = normalized.slice(star, normalized.length - target.slice(star + 1).length);
          if (subpath.includes("*")) addSubpath(subpath.replaceAll("*", captured));
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
  let foundExports = false;
  if (entries.length > 0) {
    const project = createStaticProject(ts, packageRoot, [...new Set(entries)]);
    for (const source of project.program.getSourceFiles()) {
      project.assertParsed(source);
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
          const module = project.checker.getSymbolAtLocation(statement.moduleSpecifier);
          if (!module) {
            const specifier = (statement.moduleSpecifier as import("typescript").StringLiteral).text;
            if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#")) {
              const peer = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
              warnings.push({
                ...nodeLocation(statement.moduleSpecifier),
                message: `Cannot resolve re-export from missing peer "${peer}" (${specifier}); continuing with available exports`,
              });
            } else {
              throw new StaticReadError(`Cannot resolve exported module ${statement.moduleSpecifier.getText()}`, source.fileName);
            }
          }
        }
      }
    }
    for (const entry of entries) {
      const source = project.source(entry);
      for (const symbol of project.exportsOf(source)) {
        if (["export=", "__esModule"].includes(symbol.name)) continue;
        const actual = symbol.flags & ts.SymbolFlags.Alias ? project.checker.getAliasedSymbol(symbol) : symbol;
        if (!actual.declarations?.length && !actual.valueDeclaration) continue;
        if (!(actual.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace))) continue;
        foundExports = true;
        if (symbol.name === "default") {
          if (!project.isValueExport(symbol, source)) {
            const declaration = actual.declarations?.[0];
            if (declaration && (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration))) {
              typeNames.add(declaration.name.text);
            }
          }
          continue;
        }
        if (project.isValueExport(symbol, source)) names.add(symbol.name);
        else typeNames.add(symbol.name);
      }
    }
  }
  if (includeTypes) for (const name of typeNames) names.add(name);
  for (const name of componentSubpaths) {
    if (includeTypes || !typeNames.has(name) || names.has(name)) names.add(name);
  }
  if (names.size === 0 && !foundExports && warnings.length === 0) {
    throw new StaticReadError(`No exported names could be read from "${name}" (exports map or type declarations required)`, manifest);
  }
  return { names, warnings };
}
