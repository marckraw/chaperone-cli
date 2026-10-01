/**
 * String literals in JavaScript / TypeScript source, for the repeated-literal rule.
 *
 * A literal is a quoted string, a JSX attribute string (`className="..."`) or a template
 * literal without `${...}` (what one with substitutions holds is not known until it runs).
 * Module specifiers (`from "x"`, `import "x"`, `import("x")`, `require("x")`,
 * `declare module "x"`), directives (`"use client"`) and literals between
 * `chaperone-ignore-start` / `chaperone-ignore-end` comments never count.
 *
 * A context pattern narrows which literals count. It is matched against the code with every
 * comment, every literal's text and all JSX text blanked out, so it only ever finds code.
 * A match that ends with `(`, `[` or `{`, or is followed by one, opens a context that lasts
 * until the matching bracket: every literal inside counts (`cn(...)`, `className={...}`).
 * Any other match counts the literal right after it (`className="..."`).
 */

import { analyzeBrackets, jsxEnabledFor, tokenize, type Comment, type Token } from "../../../utils/js-lexer";
import { regexMatches } from "../../../utils/text";
import { CHAPERONE_IGNORE, createRangeCursor, ignoredRanges } from "./ignore-regions";

export interface LiteralOccurrence {
  /** The literal's text, without its quotes */
  value: string;
  /** Offset of the opening quote */
  offset: number;
}

export interface LiteralScanOptions {
  /** Used to decide whether `<` can start JSX (not in .ts files) */
  path: string;
  /** A global regex: only literals in its contexts count. Omit to count every literal. */
  context?: RegExp;
  /** Whether zero-length context matches count (lookarounds such as `(?<=className=)`) */
  includeEmptyContextMatches?: boolean;
}

export interface LiteralScan {
  literals: LiteralOccurrence[];
  /** How many times the context pattern matched (0 without one) */
  contextMatches: number;
}

const OPENERS = new Set(["(", "[", "{"]);

function isLiteral(token: Token): boolean {
  return token.type === "string" || (token.type === "template" && !token.hasSubstitutions);
}

/** `from "x"`, `import "x"`, `import("x")`, `require("x")`, `declare module "x"` */
function isModuleSpecifier(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous?.type === "name") {
    return previous.value === "from" || previous.value === "import" || previous.value === "module";
  }
  if (previous?.type === "punct" && previous.value === "(") {
    const callee = tokens[index - 2];
    return callee?.type === "name" && (callee.value === "import" || callee.value === "require");
  }
  return false;
}

/** How many leading tokens form the directive prologue (`"use client";`, `'use strict'`) */
function directivePrologueLength(content: string, tokens: readonly Token[]): number {
  let index = 0;
  while (tokens[index]?.type === "string") {
    const next = tokens[index + 1];
    if (next === undefined) return index + 1;
    if (next.type === "punct" && next.value === ";") {
      index += 2;
      continue;
    }
    // ASI: a directive ends at a line break before the next statement
    const onNextLine = content.slice(tokens[index]!.end, next.start).includes("\n");
    if (onNextLine && (next.type === "name" || next.type === "string")) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

/**
 * The code with comments, literal text, regex bodies and JSX text blanked to spaces
 * (line breaks kept), so offsets still line up with `content`.
 */
function codeOnly(content: string, tokens: readonly Token[]): string {
  const chars = new Uint16Array(content.length).fill(32);
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) chars[index] = 10;
  }
  for (const token of tokens) {
    switch (token.type) {
      case "name":
      case "punct":
      case "number":
        for (let index = token.start; index < token.end; index++) chars[index] = content.charCodeAt(index);
        break;
      case "string":
      case "template":
        // Keep the delimiters so a pattern can anchor on them
        chars[token.start] = content.charCodeAt(token.start);
        if (token.end - 1 > token.start) chars[token.end - 1] = content.charCodeAt(token.end - 1);
        break;
      default:
        break;
    }
  }
  let code = "";
  for (let index = 0; index < chars.length; index += 8192) {
    code += String.fromCharCode(...chars.subarray(index, index + 8192));
  }
  return code;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/**
 * Which tokens are inside a context of `pattern`: a Uint8Array with 1 for every token index
 * that counts.
 */
function contextMask(
  content: string,
  tokens: readonly Token[],
  pattern: RegExp,
  includeEmpty: boolean
): { mask: Uint8Array; matches: number } {
  const mask = new Uint8Array(tokens.length);
  const code = codeOnly(content, tokens);
  const { partner } = analyzeBrackets(tokens);
  const tokenAt = new Map<number, number>();
  tokens.forEach((token, index) => {
    if (token.type !== "jsx-text" && !tokenAt.has(token.start)) tokenAt.set(token.start, index);
  });

  // Bracket spans are marked as +1/-1 boundaries over token indexes, then summed
  const depth = new Int32Array(tokens.length + 1);
  let matches = 0;

  for (const match of regexMatches(code, pattern, { includeEmpty })) {
    matches++;
    const end = match.index + match[0].length;
    let opener = -1;
    if (match[0].length > 0 && OPENERS.has(code[end - 1]!)) {
      opener = end - 1;
    } else {
      let at = end;
      while (at < code.length && isSpace(code.charCodeAt(at))) at++;
      if (OPENERS.has(code[at] ?? "")) {
        opener = at;
      } else {
        const index = tokenAt.get(at);
        if (index !== undefined) mask[index] = 1;
        continue;
      }
    }

    const open = tokenAt.get(opener);
    if (open === undefined) continue;
    const close = partner[open]! === -1 ? tokens.length : partner[open]!;
    depth[open + 1]! += 1;
    depth[close]! -= 1;
  }

  let inside = 0;
  for (let index = 0; index < tokens.length; index++) {
    inside += depth[index]!;
    if (inside > 0) mask[index] = 1;
  }
  return { mask, matches };
}

/**
 * The literals in one file that count, in source order.
 */
export function findLiterals(content: string, options: LiteralScanOptions): LiteralScan {
  const comments: Comment[] = [];
  const tokens = tokenize(content, { jsx: jsxEnabledFor(options.path), jsxContents: true, comments });
  const ignored = createRangeCursor(ignoredRanges(content, comments, [CHAPERONE_IGNORE]));
  const prologue = directivePrologueLength(content, tokens);

  let mask: Uint8Array | null = null;
  let contextMatches = 0;
  if (options.context) {
    const result = contextMask(content, tokens, options.context, options.includeEmptyContextMatches ?? true);
    mask = result.mask;
    contextMatches = result.matches;
  }

  const literals: LiteralOccurrence[] = [];
  for (let index = prologue; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!isLiteral(token)) continue;
    if (mask && mask[index] !== 1) continue;
    if (isModuleSpecifier(tokens, index)) continue;
    if (ignored(token.start)) continue;
    literals.push({ value: token.value, offset: token.start });
  }
  return { literals, contextMatches };
}

/**
 * A literal as it is compared: trimmed, whitespace collapsed to single spaces.
 */
export function normalizeLiteral(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The key two literals share when they are the same: the normalized text, or with
 * `ignoreOrder` its distinct whitespace-separated tokens, sorted. `tokens` is how many
 * tokens the key has.
 */
export function literalKey(normalized: string, ignoreOrder: boolean): { key: string; tokens: number } {
  if (normalized === "") return { key: "", tokens: 0 };
  const parts = normalized.split(" ");
  if (!ignoreOrder) return { key: normalized, tokens: parts.length };
  const distinct = [...new Set(parts)].sort();
  return { key: distinct.join(" "), tokens: distinct.length };
}
