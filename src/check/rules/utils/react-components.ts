/**
 * Find top-level React component declarations with the tokenizer.
 *
 * A component is a top-level (not nested) declaration with a PascalCase name whose
 * body renders JSX (or calls createElement):
 * - `function Card(...) { ... }` (also exported, default-exported, async);
 * - `export default function (...) { ... }`;
 * - `class Card extends (React.)Component / PureComponent { ... }`;
 * - `const Card = (...) => ...`, `const Card = function ...`,
 *   `const Card = memo(...)` / `forwardRef(...)` (also `React.` prefixed).
 *
 * Parameter lists are skipped before looking for the body, so destructured
 * props (`function Card({ title })`) are never mistaken for the body.
 */

import { analyzeBrackets, jsxEnabledFor, tokenize, type BracketStructure, type Token } from "../../../utils/js-lexer";
import { createLineIndex, type LineIndex } from "../../../utils/text";

export interface ReactComponentCandidate {
  name: string;
  line: number;
}

const STATEMENT_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "class",
  "export",
  "import",
  "type",
  "interface",
  "enum",
  "declare",
  "if",
  "for",
  "while",
  "return",
  "namespace",
]);

const isName = (token: Token | undefined, value?: string): boolean =>
  token !== undefined && token.type === "name" && (value === undefined || token.value === value);

const isPunct = (token: Token | undefined, value: string): boolean =>
  token !== undefined && token.type === "punct" && token.value === value;

const isPascalCase = (name: string): boolean => /^[A-Z][A-Za-z0-9]*$/.test(name);

/** Whether tokens in [start, end) render JSX or call createElement */
function rendersJsx(tokens: Token[], start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    const token = tokens[index]!;
    if (token.type === "jsx") return true;
    if (isName(token, "createElement") && isPunct(tokens[index + 1], "(")) return true;
  }
  return false;
}

/**
 * Starting after a parameter list's `)`, skip an optional return type annotation and
 * return the index of the body's `{`, or -1 when there is no body (overload, declare).
 */
function findBodyAfterParameters(tokens: Token[], structure: BracketStructure, closeParen: number): number {
  let index = closeParen + 1;
  if (isPunct(tokens[index], ":")) {
    index++;
    let angles = 0;
    for (; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (isPunct(token, "<")) angles++;
      else if (isPunct(token, ">")) angles = Math.max(0, angles - 1);
      else if (isPunct(token, "(") || isPunct(token, "[")) {
        index = Math.max(index, structure.partner[index]!);
      } else if (isPunct(token, "{")) {
        const previous = tokens[index - 1];
        const isTypeLiteral =
          angles > 0 ||
          (previous?.type === "punct" && [":", "|", "&", "<", ",", "(", "=>"].includes(previous.value)) ||
          isName(previous, "keyof");
        if (!isTypeLiteral) return index;
        index = Math.max(index, structure.partner[index]!);
      } else if (isPunct(token, ";") || isPunct(token, "=")) {
        return -1;
      }
    }
    return -1;
  }
  return isPunct(tokens[index], "{") ? index : -1;
}

/**
 * At a `<` that follows a name, find the `>` closing a generic type argument list
 * (`forwardRef<A, B>(`); returns -1 when it is not followed by a call.
 */
function closingTypeArguments(tokens: Token[], structure: BracketStructure, open: number): number {
  const baseDepth = structure.depth[open]!;
  let angles = 0;
  for (let index = open; index < tokens.length; index++) {
    const depth = structure.depth[index]!;
    if (depth < baseDepth) return -1;
    if (depth > baseDepth) continue;
    const token = tokens[index]!;
    if (isPunct(token, "<")) angles++;
    else if (isPunct(token, ">") && --angles === 0) return isPunct(tokens[index + 1], "(") ? index : -1;
    else if (isPunct(token, ";") || isPunct(token, "=") || isPunct(token, "=>")) return -1;
  }
  return -1;
}

/** End (exclusive) of a variable initializer that starts at `start` */
function initializerEnd(tokens: Token[], structure: BracketStructure, start: number, lines: LineIndex): number {
  const baseDepth = structure.depth[start]!;
  let first = start;
  if (isName(tokens[first], "async")) first++;
  if (isPunct(tokens[first], "<")) {
    // Generic arrow type parameters: <T,>(...) => ... (the comma is not a declarator separator)
    let angles = 0;
    for (; first < tokens.length; first++) {
      if (isPunct(tokens[first], "<")) angles++;
      else if (isPunct(tokens[first], ">") && --angles === 0) break;
    }
  }
  for (let index = Math.max(start, first); index < tokens.length; index++) {
    const token = tokens[index]!;
    if (structure.depth[index]! < baseDepth) return index;
    if (structure.depth[index] !== baseDepth) continue;
    // Generic call arguments contain commas that do not end the declarator: forwardRef<A, B>(...)
    if (isPunct(token, "<") && tokens[index - 1]?.type === "name") {
      const close = closingTypeArguments(tokens, structure, index);
      if (close !== -1) {
        index = close;
        continue;
      }
    }
    if (isPunct(token, ";") || isPunct(token, ",")) return index;
    if (index > start && token.type === "name" && STATEMENT_KEYWORDS.has(token.value)) {
      const previous = tokens[index - 1]!;
      if (lines.lineAt(previous.end) !== lines.lineAt(token.start)) return index;
    }
  }
  return tokens.length;
}

/** Whether an initializer [start, end) is a function or a memo/forwardRef wrapper */
function isFunctionLike(tokens: Token[], structure: BracketStructure, start: number, end: number): boolean {
  let index = start;
  if (isName(tokens[index], "async")) index++;
  if (isName(tokens[index], "function")) return true;

  // memo(...), forwardRef<T>(...), React.memo(...), observer(...) is not assumed
  let callee = index;
  if (isName(tokens[callee], "React") && isPunct(tokens[callee + 1], ".")) callee += 2;
  if (isName(tokens[callee], "memo") || isName(tokens[callee], "forwardRef")) return true;

  // An arrow function at the initializer's own depth
  const baseDepth = structure.depth[start]!;
  for (let cursor = start; cursor < end; cursor++) {
    if (structure.depth[cursor] === baseDepth && isPunct(tokens[cursor], "=>")) return true;
  }
  return false;
}

/**
 * Top-level React components declared in `content`, ordered by line.
 */
export function findReactComponents(content: string, filePath = "component.tsx"): ReactComponentCandidate[] {
  const tokens = tokenize(content, { jsx: jsxEnabledFor(filePath) });
  const structure = analyzeBrackets(tokens);
  const lines = createLineIndex(content);
  const found = new Map<string, ReactComponentCandidate>();

  const add = (name: string, startToken: Token) => {
    if (!found.has(name)) {
      found.set(name, { name, line: lines.lineAt(startToken.start) });
    }
  };

  for (let index = 0; index < tokens.length; index++) {
    if (structure.depth[index] !== 0) continue;
    const start = tokens[index]!;
    if (start.type !== "name") continue;
    if (isPunct(tokens[index - 1], ".")) continue;

    let cursor = index;
    let isDefault = false;
    if (isName(tokens[cursor], "export")) {
      cursor++;
      if (isName(tokens[cursor], "default")) {
        isDefault = true;
        cursor++;
      }
    } else if (start.value !== "function" && start.value !== "async" && start.value !== "class" &&
      start.value !== "const" && start.value !== "let" && start.value !== "var") {
      continue;
    }
    if (isName(tokens[cursor], "declare")) continue;

    // function declarations
    let functionCursor = cursor;
    if (isName(tokens[functionCursor], "async")) functionCursor++;
    if (isName(tokens[functionCursor], "function")) {
      functionCursor++;
      if (isPunct(tokens[functionCursor], "*")) functionCursor++;
      let name: string | null = null;
      if (isName(tokens[functionCursor])) {
        name = tokens[functionCursor]!.value;
        functionCursor++;
      } else if (isDefault) {
        name = "default export";
      }
      if (!name || (name !== "default export" && !isPascalCase(name))) {
        index = cursor;
        continue;
      }
      // Skip type parameters: function Card<T>(...)
      if (isPunct(tokens[functionCursor], "<")) {
        let angles = 0;
        for (; functionCursor < tokens.length; functionCursor++) {
          if (isPunct(tokens[functionCursor], "<")) angles++;
          else if (isPunct(tokens[functionCursor], ">") && --angles === 0) {
            functionCursor++;
            break;
          }
        }
      }
      if (!isPunct(tokens[functionCursor], "(")) continue;
      const closeParen = structure.partner[functionCursor]!;
      if (closeParen < 0) continue;
      const bodyStart = findBodyAfterParameters(tokens, structure, closeParen);
      if (bodyStart < 0) continue;
      const bodyEnd = structure.partner[bodyStart]!;
      if (bodyEnd > bodyStart && rendersJsx(tokens, bodyStart, bodyEnd)) {
        add(name, start);
      }
      index = bodyEnd > index ? bodyEnd : index;
      continue;
    }

    // class declarations
    if (isName(tokens[cursor], "class")) {
      let classCursor = cursor + 1;
      let name = isDefault ? "default export" : null;
      if (isName(tokens[classCursor]) && !isName(tokens[classCursor], "extends")) {
        name = tokens[classCursor]!.value;
        classCursor++;
      }
      if (!name || !isName(tokens[classCursor], "extends")) continue;
      classCursor++;
      if (isName(tokens[classCursor], "React") && isPunct(tokens[classCursor + 1], ".")) classCursor += 2;
      if (!isName(tokens[classCursor], "Component") && !isName(tokens[classCursor], "PureComponent")) continue;
      let bodyStart = classCursor + 1;
      while (bodyStart < tokens.length && !isPunct(tokens[bodyStart], "{")) bodyStart++;
      const bodyEnd = structure.partner[bodyStart] ?? -1;
      if (bodyEnd > bodyStart && rendersJsx(tokens, bodyStart, bodyEnd)) {
        add(name, start);
      }
      continue;
    }

    // const Card = ...
    if (isName(tokens[cursor], "const") || isName(tokens[cursor], "let") || isName(tokens[cursor], "var")) {
      const nameToken = tokens[cursor + 1];
      if (!isName(nameToken) || !isPascalCase(nameToken!.value)) continue;
      let equals = cursor + 2;
      if (isPunct(tokens[equals], ":")) {
        // Skip a type annotation up to the `=` at this depth
        const baseDepth = structure.depth[equals]!;
        while (equals < tokens.length && !(isPunct(tokens[equals], "=") && structure.depth[equals] === baseDepth)) {
          equals++;
        }
      }
      if (!isPunct(tokens[equals], "=")) continue;
      const initStart = equals + 1;
      const initEnd = initializerEnd(tokens, structure, initStart, lines);
      if (isFunctionLike(tokens, structure, initStart, initEnd) && rendersJsx(tokens, initStart, initEnd)) {
        add(nameToken!.value, start);
      }
    }
  }

  return [...found.values()].sort((left, right) => left.line - right.line);
}
