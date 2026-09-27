/**
 * Find module references in source files with the tokenizer from utils/js-lexer:
 * static imports (incl. `import type` and inline `import { type X }`), side-effect
 * imports, re-exports (`export * from`, `export * as ns from`, `export { x } from`,
 * `export type { X } from`), dynamic `import("x")`, `require("x")` and TypeScript
 * `import x = require("x")`. Commented-out code and text inside strings, template
 * literals, regexes and JSX is ignored.
 */

import { jsxEnabledFor, tokenize, type Token } from "../../../utils/js-lexer";
import { createLineIndex } from "../../../utils/text";

export type ImportKind = "import" | "side-effect" | "re-export" | "dynamic" | "require";

export interface ImportEntry {
  source: string; // Import specifier (e.g., "@tauri-apps/api", "./utils")
  line: number; // Line number
  isTypeImport: boolean; // `import type`, `export type`, or every specifier marked `type`
  isDynamic: boolean; // import() expression
  isRequire: boolean; // require() call or `import x = require()`
  kind: ImportKind;
}

export interface ExtractOptions {
  includeTypeImports?: boolean; // default: true
  includeDynamicImports?: boolean; // default: true
  includeRequire?: boolean; // default: true
  /** Path of the file, used to pick JSX mode and to extract <script> blocks */
  filePath?: string;
}

const isName = (token: Token | undefined, value?: string): boolean =>
  token !== undefined && token.type === "name" && (value === undefined || token.value === value);

const isPunct = (token: Token | undefined, value: string): boolean =>
  token !== undefined && token.type === "punct" && token.value === value;

/** A string literal, or a template literal without substitutions */
const staticString = (token: Token | undefined): string | null => {
  if (!token) return null;
  if (token.type === "string") return token.value;
  if (token.type === "template" && !token.hasSubstitutions) return token.value;
  return null;
};

const TYPE_CONTEXT_KEYWORDS = new Set(["typeof", "keyof", "as", "satisfies", "extends", "infer"]);
const PROMISE_MEMBERS = new Set(["then", "catch", "finally"]);

/**
 * Whether `import("x")` at `index` is a TypeScript type (`typeof import("x")`,
 * `import("x").Type`, `value as import("x").T`) rather than a runtime import.
 */
function isTypePositionImport(tokens: Token[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous?.type === "name" && TYPE_CONTEXT_KEYWORDS.has(previous.value)) return true;
  if (isPunct(previous, "|") || isPunct(previous, "&")) return true;

  // Find the closing parenthesis of import( ... )
  let depth = 0;
  let close = -1;
  for (let cursor = index + 1; cursor < tokens.length; cursor++) {
    if (isPunct(tokens[cursor], "(")) depth++;
    else if (isPunct(tokens[cursor], ")") && --depth === 0) {
      close = cursor;
      break;
    }
  }
  if (close === -1) return false;

  // import("x").Member: only Promise methods make sense on a runtime import()
  const member = tokens[close + 2];
  return isPunct(tokens[close + 1], ".") && isName(member) && !PROMISE_MEMBERS.has(member!.value);
}

/** `type X`, `type X as Y` inside braces (but not a binding named "type") */
function isInlineTypeSpecifier(specifier: Token[]): boolean {
  if (!isName(specifier[0], "type") || specifier.length < 2) return false;
  return !(isName(specifier[1], "as") && specifier.length === 3);
}

interface ClauseScan {
  /** Index of the token after the scanned clause */
  end: number;
  source: string | null;
  specifiers: Token[][];
  hasValueBinding: boolean;
}

/**
 * Scan an import/export clause starting at `start` up to `from "x"`.
 */
function scanClause(tokens: Token[], start: number): ClauseScan {
  const specifiers: Token[][] = [];
  let hasValueBinding = false;
  let current: Token[] | null = null;
  let afterAs = false;

  for (let index = start; index < tokens.length && index < start + 5000; index++) {
    const token = tokens[index]!;

    if (current) {
      if (isPunct(token, "}")) {
        if (current.length > 0) specifiers.push(current);
        current = null;
      } else if (isPunct(token, ",")) {
        if (current.length > 0) specifiers.push(current);
        current = [];
      } else {
        current.push(token);
      }
      continue;
    }

    if (isName(token, "from")) {
      const source = staticString(tokens[index + 1]);
      if (source !== null) {
        return { end: index + 2, source, specifiers, hasValueBinding };
      }
    }
    if (isPunct(token, "{")) {
      current = [];
      continue;
    }
    if (isPunct(token, "*")) {
      hasValueBinding = true;
      continue;
    }
    if (isName(token, "as")) {
      afterAs = true;
      continue;
    }
    if (token.type === "name") {
      if (!afterAs) hasValueBinding = true;
      afterAs = false;
      continue;
    }
    if (isPunct(token, ",")) continue;
    // Anything else ends the clause: not an import/export-from statement
    return { end: index, source: null, specifiers, hasValueBinding };
  }

  return { end: tokens.length, source: null, specifiers, hasValueBinding };
}

/**
 * Keep only <script> blocks (and Astro frontmatter) of component files, and only
 * import/export lines of MDX, blanking everything else while preserving offsets.
 */
function scriptRegions(content: string, filePath: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");

  if (/\.mdx$/i.test(filePath)) {
    return content
      .split("\n")
      .map((line) => (/^\s*(?:import|export)\b/.test(line) ? line : blank(line)))
      .join("\n");
  }

  if (!/\.(vue|svelte|astro|html?)$/i.test(filePath)) {
    return content;
  }

  const keep: Array<[number, number]> = [];
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (frontmatter && /\.astro$/i.test(filePath)) {
    const start = frontmatter.index + frontmatter[0].indexOf(frontmatter[1]!);
    keep.push([start, start + frontmatter[1]!.length]);
  }
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(content)) !== null) {
    const start = match.index + match[0].indexOf(">") + 1;
    keep.push([start, start + match[1]!.length]);
  }

  let output = "";
  let cursor = 0;
  for (const [start, end] of keep.sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    output += blank(content.slice(cursor, start)) + content.slice(start, end);
    cursor = end;
  }
  return output + blank(content.slice(cursor));
}

/**
 * Extract every module reference from a source file.
 */
export function extractImports(content: string, options?: ExtractOptions): ImportEntry[] {
  const includeTypeImports = options?.includeTypeImports ?? true;
  const includeDynamicImports = options?.includeDynamicImports ?? true;
  const includeRequire = options?.includeRequire ?? true;
  const filePath = options?.filePath ?? "file.tsx";

  const source = scriptRegions(content, filePath);
  const tokens = tokenize(source, { jsx: jsxEnabledFor(filePath) && !/\.(vue|svelte|astro|html?|mdx)$/i.test(filePath) });
  const lines = createLineIndex(source);
  const entries: ImportEntry[] = [];
  const consumedRequires = new Set<number>();

  const add = (token: Token, specifier: string, kind: ImportKind, isTypeImport: boolean) => {
    entries.push({
      source: specifier,
      line: lines.lineAt(token.start),
      isTypeImport,
      isDynamic: kind === "dynamic",
      isRequire: kind === "require",
      kind,
    });
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type !== "name") continue;

    const previous = tokens[index - 1];
    if (isPunct(previous, ".") || isPunct(previous, "?.")) continue; // obj.import, obj.require

    if (token.value === "import") {
      const next = tokens[index + 1];

      // import("x"), or a TypeScript import type: typeof import("x"), import("x").T
      if (isPunct(next, "(")) {
        const specifier = staticString(tokens[index + 2]);
        if (specifier !== null) add(token, specifier, "dynamic", isTypePositionImport(tokens, index));
        continue;
      }

      // import.meta, { import: ... }
      if (isPunct(next, ".") || isPunct(next, ":")) continue;

      // import "x"
      const sideEffect = staticString(next);
      if (next?.type === "string" && sideEffect !== null) {
        add(token, sideEffect, "side-effect", false);
        index++;
        continue;
      }

      let cursor = index + 1;
      let typeOnly = false;
      if (isName(tokens[cursor], "type")) {
        const after = tokens[cursor + 1];
        const typeIsBinding =
          (isName(after, "from") && staticString(tokens[cursor + 2]) !== null) ||
          isPunct(after, ",") ||
          isPunct(after, "=");
        if (!typeIsBinding) {
          typeOnly = true;
          cursor++;
        }
      }

      // import x = require("y")
      if (isName(tokens[cursor]) && isPunct(tokens[cursor + 1], "=")) {
        const requireToken = tokens[cursor + 2];
        const specifier = staticString(tokens[cursor + 4]);
        if (isName(requireToken, "require") && isPunct(tokens[cursor + 3], "(") && specifier !== null) {
          consumedRequires.add(cursor + 2);
          entries.push({
            source: specifier,
            line: lines.lineAt(token.start),
            isTypeImport: typeOnly,
            isDynamic: false,
            isRequire: true,
            kind: "require",
          });
        }
        continue;
      }

      const clause = scanClause(tokens, cursor);
      if (clause.source !== null) {
        const allInlineTypes =
          !clause.hasValueBinding &&
          clause.specifiers.length > 0 &&
          clause.specifiers.every(isInlineTypeSpecifier);
        add(token, clause.source, "import", typeOnly || allInlineTypes);
        index = clause.end - 1;
      }
      continue;
    }

    if (token.value === "export") {
      let cursor = index + 1;
      let typeOnly = false;
      if (isName(tokens[cursor], "type") && (isPunct(tokens[cursor + 1], "{") || isPunct(tokens[cursor + 1], "*"))) {
        typeOnly = true;
        cursor++;
      }

      if (isPunct(tokens[cursor], "*")) {
        cursor++;
        if (isName(tokens[cursor], "as")) cursor += 2; // export * as ns from "x"
        const specifier = isName(tokens[cursor], "from") ? staticString(tokens[cursor + 1]) : null;
        if (specifier !== null) {
          add(token, specifier, "re-export", typeOnly);
          index = cursor + 1;
        }
        continue;
      }

      if (isPunct(tokens[cursor], "{")) {
        const clause = scanClause(tokens, cursor);
        if (clause.source !== null) {
          const allInlineTypes =
            clause.specifiers.length > 0 && clause.specifiers.every(isInlineTypeSpecifier);
          add(token, clause.source, "re-export", typeOnly || allInlineTypes);
          index = clause.end - 1;
        }
      }
      continue;
    }

    if (token.value === "require" && !consumedRequires.has(index)) {
      if (isName(previous, "function")) continue;
      const specifier = staticString(tokens[index + 2]);
      if (isPunct(tokens[index + 1], "(") && specifier !== null && isPunct(tokens[index + 3], ")")) {
        add(token, specifier, "require", false);
      }
    }
  }

  return entries.filter(
    (entry) =>
      (includeTypeImports || !entry.isTypeImport) &&
      (includeDynamicImports || !entry.isDynamic) &&
      (includeRequire || !entry.isRequire)
  );
}
