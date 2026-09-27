/**
 * Find exported functions with the tokenizer.
 *
 * - function-declaration: `export function f`, `export async function f`,
 *   `export function* f`, `export function f<T>(...)`;
 * - function-variable: `export const f = (...) => ...`, `export const f = async x => ...`,
 *   `export const f = function ...`, including typed variables (`export const f: Fn = ...`),
 *   generic arrows (`<T,>(x: T) => ...`) and parameters with nested parentheses
 *   (`(x = g(1)) => ...`). `let` and `var` are recognised as well.
 *
 * Default exports are not included (their public name is "default").
 */

import { analyzeBrackets, jsxEnabledFor, tokenize, type BracketStructure, type Token } from "../../../utils/js-lexer";
import { createLineIndex } from "../../../utils/text";

export type ExportedFunctionKind = "function-declaration" | "function-variable";

export interface ExportedFunction {
  name: string;
  line: number;
  kind: ExportedFunctionKind;
}

const isName = (token: Token | undefined, value?: string): boolean =>
  token !== undefined && token.type === "name" && (value === undefined || token.value === value);

const isPunct = (token: Token | undefined, value: string): boolean =>
  token !== undefined && token.type === "punct" && token.value === value;

/** Skip a balanced `<...>` starting at `index` (which must be `<`); returns the index after `>` */
function skipAngles(tokens: Token[], index: number): number {
  let depth = 0;
  for (let cursor = index; cursor < tokens.length; cursor++) {
    if (isPunct(tokens[cursor], "<")) depth++;
    else if (isPunct(tokens[cursor], ">") && --depth === 0) return cursor + 1;
    else if (isPunct(tokens[cursor], ";")) return cursor;
  }
  return tokens.length;
}

/** Whether the initializer starting at `start` is a function expression or arrow function */
function initializerIsFunction(tokens: Token[], structure: BracketStructure, start: number): boolean {
  let index = start;
  if (isName(tokens[index], "async")) index++;
  if (isName(tokens[index], "function")) return true;
  if (isPunct(tokens[index], "<")) index = skipAngles(tokens, index);

  // x => ...
  if (isName(tokens[index]) && isPunct(tokens[index + 1], "=>")) return true;

  if (!isPunct(tokens[index], "(")) return false;
  const close = structure.partner[index]!;
  if (close < 0) return false;

  // (params) => ... or (params): ReturnType => ...
  const baseDepth = structure.depth[index]!;
  let angles = 0;
  for (let cursor = close + 1; cursor < tokens.length; cursor++) {
    const depth = structure.depth[cursor]!;
    if (depth < baseDepth) return false;
    if (depth > baseDepth) continue;
    const token = tokens[cursor]!;
    if (isPunct(token, "=>") && angles === 0) return true;
    if (cursor === close + 1 && !isPunct(token, ":")) return false;
    if (isPunct(token, "<")) angles++;
    else if (isPunct(token, ">")) angles = Math.max(0, angles - 1);
    else if (angles === 0 && (isPunct(token, ";") || isPunct(token, ",") || isPunct(token, "="))) return false;
  }
  return false;
}

export function findExportedFunctions(content: string, filePath = "module.ts"): ExportedFunction[] {
  const tokens = tokenize(content, { jsx: jsxEnabledFor(filePath) });
  const structure = analyzeBrackets(tokens);
  const lines = createLineIndex(content);
  const found: ExportedFunction[] = [];

  for (let index = 0; index < tokens.length; index++) {
    if (structure.depth[index] !== 0 || !isName(tokens[index], "export")) continue;
    if (isPunct(tokens[index - 1], ".")) continue;

    let cursor = index + 1;
    if (isName(tokens[cursor], "default") || isName(tokens[cursor], "declare")) continue;

    const line = lines.lineAt(tokens[index]!.start);

    let functionCursor = cursor;
    if (isName(tokens[functionCursor], "async")) functionCursor++;
    if (isName(tokens[functionCursor], "function")) {
      functionCursor++;
      if (isPunct(tokens[functionCursor], "*")) functionCursor++;
      const nameToken = tokens[functionCursor];
      if (isName(nameToken)) {
        found.push({ name: nameToken!.value, line, kind: "function-declaration" });
      }
      continue;
    }

    if (!isName(tokens[cursor], "const") && !isName(tokens[cursor], "let") && !isName(tokens[cursor], "var")) {
      continue;
    }
    const nameToken = tokens[cursor + 1];
    if (!isName(nameToken)) continue;

    // Find the `=` of this declarator, skipping a type annotation (which may contain `<a, b>`)
    cursor += 2;
    const baseDepth = structure.depth[cursor] ?? 0;
    let angles = 0;
    while (cursor < tokens.length) {
      const token = tokens[cursor]!;
      if (structure.depth[cursor] === baseDepth) {
        if (isPunct(token, "<")) angles++;
        else if (isPunct(token, ">")) angles = Math.max(0, angles - 1);
        else if (isPunct(token, "=") || (angles === 0 && (isPunct(token, ";") || isPunct(token, ",")))) break;
      }
      cursor++;
    }
    if (!isPunct(tokens[cursor], "=")) continue;

    if (initializerIsFunction(tokens, structure, cursor + 1)) {
      found.push({ name: nameToken!.value, line, kind: "function-variable" });
    }
  }

  return found;
}
