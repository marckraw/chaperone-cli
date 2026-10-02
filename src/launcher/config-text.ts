/**
 * Writing the pin into a config file's text, keeping everything else as it was written
 * (formatting, key order, indentation). Pure.
 */

import { isDeepStrictEqual } from "node:util";
import { isMisspelledPinKey, PIN_FIELD } from "./pin";

interface Member {
  key: string;
  keyStart: number;
  valueEnd: number;
}

interface TopLevel {
  open: number;
  close: number;
  members: Member[];
}

const isSpace = (character: string | undefined) =>
  character === " " || character === "\t" || character === "\n" || character === "\r" || character === "﻿";

function skipSpace(text: string, index: number): number {
  while (index < text.length && isSpace(text[index])) index++;
  return index;
}

/** Index just past the string starting at `index` (a `"`). */
function skipString(text: string, index: number): number {
  let position = index + 1;
  while (position < text.length && text[position] !== '"') {
    position += text[position] === "\\" ? 2 : 1;
  }
  return position + 1;
}

/** Index just past the JSON value starting at `index`. */
function skipValue(text: string, index: number): number {
  const first = text[index];
  if (first === '"') return skipString(text, index);
  if (first === "{" || first === "[") {
    let depth = 0;
    let position = index;
    while (position < text.length) {
      const character = text[position]!;
      if (character === '"') {
        position = skipString(text, position);
        continue;
      }
      if (character === "{" || character === "[") depth++;
      if (character === "}" || character === "]") {
        depth--;
        if (depth === 0) return position + 1;
      }
      position++;
    }
    return position;
  }
  let position = index;
  while (position < text.length && !isSpace(text[position]) && !",}]".includes(text[position]!)) position++;
  return position;
}

/** The top-level object's members, with their positions. Assumes `text` is valid JSON. */
function scanTopLevel(text: string): TopLevel | null {
  const open = skipSpace(text, 0);
  if (text[open] !== "{") return null;
  const members: Member[] = [];
  let index = open + 1;

  for (;;) {
    index = skipSpace(text, index);
    if (text[index] === "}") return { open, close: index, members };
    if (text[index] !== '"') return null;

    const keyStart = index;
    const keyEnd = skipString(text, index);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    index = skipSpace(text, keyEnd);
    if (text[index] !== ":") return null;
    index = skipSpace(text, index + 1);
    const valueEnd = skipValue(text, index);
    members.push({ key, keyStart, valueEnd });

    index = skipSpace(text, valueEnd);
    if (text[index] === ",") index++;
    else if (text[index] !== "}") return null;
  }
}

/** The indentation used for top-level keys, for the fallback rewrite. */
function detectIndent(text: string): string {
  const match = /\{\s*?\n([ \t]+)"/.exec(text);
  return match ? match[1]! : "  ";
}

export interface PinEdit {
  text: string;
  /** The version pinned before, if any (as written) */
  previous: unknown;
  /** A misspelled key that was replaced (`chaperone_version`, ...) */
  replacedKey: string | null;
}

/**
 * Set `"chaperoneVersion": "<version>"` in a config file's text.
 *
 * An existing pin (or a misspelled one) is replaced in place; otherwise the pin becomes the first
 * key (after `$schema`). The result is parsed again and compared with the intended config; if a
 * text edit could not produce it, the file is rewritten from the parsed config instead.
 *
 * @throws {SyntaxError} when `text` is not valid JSON
 * @throws {Error} when the config is not a JSON object
 */
export function setPinInConfigText(text: string, version: string): PinEdit {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("the config is not a JSON object");
  }
  const config = parsed as Record<string, unknown>;
  const replacedKey = PIN_FIELD in config ? null : (Object.keys(config).find(isMisspelledPinKey) ?? null);
  const previous = config[PIN_FIELD] ?? (replacedKey ? config[replacedKey] : undefined);

  const expected: Record<string, unknown> = { [PIN_FIELD]: version };
  for (const [key, value] of Object.entries(config)) {
    if (key !== PIN_FIELD && key !== replacedKey) expected[key] = value;
  }

  const property = `"${PIN_FIELD}": ${JSON.stringify(version)}`;
  const scan = scanTopLevel(text);
  let edited: string | null = null;

  if (scan) {
    const existing =
      scan.members.find((member) => member.key === PIN_FIELD) ??
      scan.members.find((member) => member.key === replacedKey);
    if (existing) {
      edited = text.slice(0, existing.keyStart) + property + text.slice(existing.valueEnd);
    } else if (scan.members.length === 0) {
      edited = `${text.slice(0, scan.open + 1)}\n  ${property}\n${text.slice(scan.close)}`;
    } else {
      const first = scan.members[0]!;
      const lead = text.slice(scan.open + 1, first.keyStart);
      const at = first.key === "$schema" ? 1 : 0;
      const target = scan.members[at];
      if (target) {
        edited = `${text.slice(0, target.keyStart)}${property},${lead}${text.slice(target.keyStart)}`;
      } else {
        edited = `${text.slice(0, first.valueEnd)},${lead}${property}${text.slice(first.valueEnd)}`;
      }
    }
  }

  let result: string;
  try {
    result = edited !== null && isDeepStrictEqual(JSON.parse(edited), expected) ? edited : rewrite();
  } catch {
    result = rewrite();
  }
  return { text: result, previous, replacedKey };

  function rewrite(): string {
    const ordered: Record<string, unknown> =
      "$schema" in expected ? { $schema: expected["$schema"], ...expected } : expected;
    return `${JSON.stringify(ordered, null, detectIndent(text))}\n`;
  }
}
