/**
 * A small, forgiving JavaScript / TypeScript / JSX tokenizer.
 *
 * It exists to find module references (imports, re-exports, dynamic imports,
 * require calls) and top-level declarations reliably without a full parser:
 * comments, string literals, template literals (including nested `${}`),
 * regular expression literals and JSX text are recognised, so text inside them
 * is never mistaken for code. It never throws; malformed input degrades to
 * best-effort tokens.
 *
 * Pure TypeScript with no native code, so it works inside `bun build --compile`.
 */

export type TokenType = "name" | "punct" | "string" | "template" | "regex" | "number" | "jsx";

export interface Token {
  type: TokenType;
  /**
   * name: the identifier; punct: the punctuator; string: the unquoted value;
   * template: the raw text when it has no substitutions ("" otherwise);
   * regex/number: the source text; jsx: "" (a whole JSX element)
   */
  value: string;
  start: number;
  end: number;
  /** Templates only: whether the template contains `${...}` */
  hasSubstitutions?: boolean;
}

export interface TokenizeOptions {
  /** Recognise JSX (default: true). Disable for .ts files, where `<T>x` is a type assertion. */
  jsx?: boolean;
}

/** Keywords after which a `/` starts a regex and a `<` may start JSX */
const EXPRESSION_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "default",
  "extends",
]);

const MAX_NESTING = 1000;

function isIdentifierStart(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    code === 36 || // $
    code === 95 || // _
    code > 127
  );
}

function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || (code >= 48 && code <= 57);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isWhitespace(code: number): boolean {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 11 ||
    code === 12 ||
    code === 0xa0 ||
    code === 0xfeff ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

function decodeEscapes(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, escape: string) => {
    if (escape.startsWith("u{")) return String.fromCodePoint(Number.parseInt(escape.slice(2, -1), 16));
    if (escape.startsWith("u") && escape.length === 5) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (escape.startsWith("x") && escape.length === 3) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (escape === "\n" || escape === "\r\n" || escape === "\r") return "";
    return SIMPLE_ESCAPES[escape] ?? escape;
  });
}

/**
 * Tokenize source code. Never throws.
 */
export function tokenize(code: string, options: TokenizeOptions = {}): Token[] {
  const jsx = options.jsx ?? true;
  const tokens: Token[] = [];
  const length = code.length;
  let pos = 0;
  let nesting = 0;

  if (code.charCodeAt(0) === 0xfeff) pos = 1;
  if (code.startsWith("#!", pos)) {
    const end = code.indexOf("\n", pos);
    pos = end === -1 ? length : end;
  }

  const push = (type: TokenType, value: string, start: number, end: number): void => {
    tokens.push({ type, value, start, end });
  };

  /** Whether the next token may start an expression (so `/` is a regex and `<` may be JSX) */
  const expressionAllowed = (): boolean => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    switch (previous.type) {
      case "name":
        return EXPRESSION_KEYWORDS.has(previous.value);
      case "punct":
        return !(
          previous.value === ")" ||
          previous.value === "]" ||
          previous.value === "}" ||
          previous.value === "++" ||
          previous.value === "--"
        );
      default:
        return false;
    }
  };

  const skipTrivia = (): void => {
    while (pos < length) {
      const code0 = code.charCodeAt(pos);
      if (isWhitespace(code0)) {
        pos++;
        continue;
      }
      if (code0 === 47 /* / */) {
        const next = code.charCodeAt(pos + 1);
        if (next === 47) {
          const end = code.indexOf("\n", pos + 2);
          pos = end === -1 ? length : end;
          continue;
        }
        if (next === 42) {
          const end = code.indexOf("*/", pos + 2);
          pos = end === -1 ? length : end + 2;
          continue;
        }
      }
      break;
    }
  };

  const readString = (quote: number): void => {
    const start = pos;
    pos++;
    let hasEscape = false;
    while (pos < length) {
      const current = code.charCodeAt(pos);
      if (current === quote) {
        const raw = code.slice(start + 1, pos);
        pos++;
        push("string", hasEscape ? decodeEscapes(raw) : raw, start, pos);
        return;
      }
      if (current === 92 /* \ */) {
        hasEscape = true;
        pos += 2;
        continue;
      }
      if (current === 10 || current === 13) {
        break; // unterminated: recover at the end of the line
      }
      pos++;
    }
    const raw = code.slice(start + 1, pos);
    push("string", hasEscape ? decodeEscapes(raw) : raw, start, pos);
  };

  const readTemplate = (): void => {
    const start = pos;
    pos++;
    let hasSubstitutions = false;
    while (pos < length) {
      const current = code.charCodeAt(pos);
      if (current === 92 /* \ */) {
        pos += 2;
        continue;
      }
      if (current === 96 /* ` */) {
        pos++;
        tokens.push({
          type: "template",
          value: hasSubstitutions ? "" : code.slice(start + 1, pos - 1),
          start,
          end: pos,
          hasSubstitutions,
        });
        return;
      }
      if (current === 36 /* $ */ && code.charCodeAt(pos + 1) === 123 /* { */) {
        hasSubstitutions = true;
        pos += 2;
        lexCode(true);
        continue;
      }
      pos++;
    }
    tokens.push({ type: "template", value: "", start, end: pos, hasSubstitutions: true });
  };

  /** Try to read a regex literal at `/`. Returns false when it cannot be one. */
  const readRegex = (): boolean => {
    const start = pos;
    let index = pos + 1;
    let inClass = false;
    while (index < length) {
      const current = code.charCodeAt(index);
      if (current === 10 || current === 13) return false;
      if (current === 92 /* \ */) {
        index += 2;
        continue;
      }
      if (inClass) {
        if (current === 93 /* ] */) inClass = false;
      } else if (current === 91 /* [ */) {
        inClass = true;
      } else if (current === 47 /* / */) {
        break;
      }
      index++;
    }
    if (index >= length) return false;
    index++;
    while (index < length && isIdentifierPart(code.charCodeAt(index))) index++;
    push("regex", code.slice(start, index), start, index);
    pos = index;
    return true;
  };

  /** `type Name =` or `type Name<...> =` right before the current `<`: a type, not JSX */
  const inTypeAliasHead = (): boolean => {
    let index = tokens.length - 1;
    if (tokens[index]?.value !== "=") return false;
    index--;
    if (tokens[index]?.value === ">") {
      let depth = 0;
      for (; index >= 0; index--) {
        const value = tokens[index]!.value;
        if (value === ">") depth++;
        else if (value === "<" && --depth === 0) break;
      }
      index--;
    }
    return tokens[index]?.type === "name" && tokens[index - 1]?.type === "name" && tokens[index - 1]!.value === "type";
  };

  /** At `<` in expression position: an element or fragment, or a generic `<T,>` / `<T extends X>` */
  const looksLikeJsx = (): boolean => {
    const next = code.charCodeAt(pos + 1);
    if (next === 62 /* > */) return true;
    if (!isIdentifierStart(next)) return false;
    if (inTypeAliasHead()) return false;

    let index = pos + 1;
    while (index < length && /[\w$.:-]/.test(code[index]!)) index++;
    const name = code.slice(pos + 1, index);
    while (index < length && isWhitespace(code.charCodeAt(index))) index++;
    const after = code[index];

    if (after === ",") return false; // <T,>(x) => ...
    if (code.startsWith("extends", index) && !/[\w$=]/.test(code[index + 7] ?? "")) return false;
    if (after === ">" && name.length === 1 && /[A-Z]/.test(name)) {
      // <T>(x: T) => ... in a type position
      let probe = index + 1;
      while (probe < length && isWhitespace(code.charCodeAt(probe))) probe++;
      if (code[probe] === "(") return false;
    }
    return true;
  };

  const skipJsxTrivia = (): void => {
    skipTrivia();
  };

  const readJsxChildren = (): void => {
    while (pos < length) {
      const current = code.charCodeAt(pos);
      if (current === 123 /* { */) {
        pos++;
        lexCode(true);
        continue;
      }
      if (current === 60 /* < */) {
        if (code.charCodeAt(pos + 1) === 47 /* / */) {
          const end = code.indexOf(">", pos);
          pos = end === -1 ? length : end + 1;
          return;
        }
        readJsxElement();
        continue;
      }
      pos++;
    }
  };

  function readJsxElement(): void {
    if (++nesting > MAX_NESTING) {
      pos = length;
      return;
    }
    pos++; // <
    skipJsxTrivia();
    if (code[pos] === ">") {
      pos++;
      readJsxChildren();
      nesting--;
      return;
    }

    while (pos < length && /[\w$.:-]/.test(code[pos]!)) pos++;
    skipJsxTrivia();

    // Type arguments on an element: <Select<Option> value={...} />
    if (code[pos] === "<") {
      let depth = 0;
      for (; pos < length; pos++) {
        if (code[pos] === "<") depth++;
        else if (code[pos] === ">" && --depth === 0) {
          pos++;
          break;
        }
      }
    }

    while (pos < length) {
      skipJsxTrivia();
      const current = code[pos];
      if (current === "/" && code[pos + 1] === ">") {
        pos += 2;
        nesting--;
        return;
      }
      if (current === ">") {
        pos++;
        readJsxChildren();
        nesting--;
        return;
      }
      if (current === "{") {
        pos++;
        lexCode(true);
        continue;
      }
      if (current === '"' || current === "'") {
        const end = code.indexOf(current, pos + 1);
        pos = end === -1 ? length : end + 1;
        continue;
      }
      if (current === "<") {
        readJsxElement();
        continue;
      }
      if (current === "=") {
        pos++;
        continue;
      }
      const nameStart = pos;
      while (pos < length && !/[\s=/>{}"'<]/.test(code[pos]!)) pos++;
      if (pos === nameStart) pos++;
    }
    nesting--;
  }

  /**
   * Tokenize code. With `untilClosingBrace`, stop after the `}` that closes an
   * enclosing `${` or JSX `{` (it is consumed, not emitted).
   */
  function lexCode(untilClosingBrace: boolean): void {
    if (++nesting > MAX_NESTING) {
      pos = length;
      return;
    }
    let braceDepth = 0;

    while (pos < length) {
      skipTrivia();
      if (pos >= length) break;

      const start = pos;
      const current = code.charCodeAt(pos);

      if (isIdentifierStart(current)) {
        pos++;
        while (pos < length && isIdentifierPart(code.charCodeAt(pos))) pos++;
        push("name", code.slice(start, pos), start, pos);
        continue;
      }

      if (isDigit(current) || (current === 46 /* . */ && isDigit(code.charCodeAt(pos + 1)))) {
        pos++;
        while (pos < length) {
          const next = code.charCodeAt(pos);
          const previous = code.charCodeAt(pos - 1);
          if (isIdentifierPart(next) || next === 46) {
            pos++;
          } else if ((next === 43 || next === 45) && (previous === 101 || previous === 69)) {
            pos++; // exponent sign: 1e-5
          } else {
            break;
          }
        }
        push("number", code.slice(start, pos), start, pos);
        continue;
      }

      if (current === 34 /* " */ || current === 39 /* ' */) {
        readString(current);
        continue;
      }

      if (current === 96 /* ` */) {
        readTemplate();
        continue;
      }

      if (current === 123 /* { */) {
        braceDepth++;
        pos++;
        push("punct", "{", start, pos);
        continue;
      }

      if (current === 125 /* } */) {
        pos++;
        if (untilClosingBrace && braceDepth === 0) {
          nesting--;
          return;
        }
        braceDepth = Math.max(0, braceDepth - 1);
        push("punct", "}", start, pos);
        continue;
      }

      if (current === 47 /* / */) {
        if (expressionAllowed() && readRegex()) continue;
        pos++;
        push("punct", "/", start, pos);
        continue;
      }

      if (current === 60 /* < */ && jsx && expressionAllowed() && looksLikeJsx()) {
        readJsxElement();
        push("jsx", "", start, pos);
        continue;
      }

      if (current === 35 /* # */ && isIdentifierStart(code.charCodeAt(pos + 1))) {
        pos++;
        while (pos < length && isIdentifierPart(code.charCodeAt(pos))) pos++;
        push("name", code.slice(start, pos), start, pos);
        continue;
      }

      const two = code.slice(pos, pos + 2);
      if (two === "=>" || two === "++" || two === "--" || (two === "?." && !isDigit(code.charCodeAt(pos + 2)))) {
        pos += 2;
        push("punct", two, start, pos);
        continue;
      }
      if (code.startsWith("...", pos)) {
        pos += 3;
        push("punct", "...", start, pos);
        continue;
      }

      pos++;
      push("punct", code[start]!, start, pos);
    }

    nesting--;
  }

  lexCode(false);
  return tokens;
}

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

export interface BracketStructure {
  /** For each bracket token, the index of its partner (or -1) */
  partner: Int32Array;
  /** Bracket nesting depth before each token (0 = top level) */
  depth: Int32Array;
}

/**
 * Pair up (), [] and {} tokens and record the nesting depth of every token.
 */
export function analyzeBrackets(tokens: readonly Token[]): BracketStructure {
  const partner = new Int32Array(tokens.length).fill(-1);
  const depth = new Int32Array(tokens.length);
  const stack: number[] = [];

  tokens.forEach((token, index) => {
    depth[index] = stack.length;
    if (token.type !== "punct") return;
    if (OPENERS[token.value]) {
      stack.push(index);
      return;
    }
    if (token.value === ")" || token.value === "]" || token.value === "}") {
      const top = stack[stack.length - 1];
      if (top !== undefined && OPENERS[tokens[top]!.value] === token.value) {
        stack.pop();
        partner[top] = index;
        partner[index] = top;
      }
    }
  });

  return { partner, depth };
}

/**
 * Whether JSX should be recognised for a file path (not for .ts/.mts/.cts, where
 * `<Type>value` is a type assertion).
 */
export function jsxEnabledFor(filePath: string): boolean {
  return !/\.(?:d\.)?[mc]?ts$/i.test(filePath);
}
