/**
 * Copied code, found by tokens: the engine of the duplicate-code rule.
 *
 * Each file is read with Chaperone's JavaScript / TypeScript tokenizer, including what is
 * inside JSX. Identifiers, literals and punctuation are kept as they are, so renaming a
 * variable breaks a copy there; whitespace, line breaks and comments are dropped, so
 * reformatting or re-commenting does not hide one. Code between ignore-start and
 * ignore-end comments is left out.
 *
 * Every window of `minTokens` consecutive tokens is hashed with a rolling hash (Rabin–Karp)
 * and remembered by where it first appeared. When a later window was seen before, the two
 * places are compared token by token and grown for as long as they agree: that is a clone.
 * Files are read in path order, so a block copied into several files is reported once per
 * copy, each against its first appearance (a–b and a–c, never b–c), as jscpd does. The
 * result is deterministic: the same files give the same clones, in the same order.
 */

import { jsxEnabledFor, tokenize, type Comment, type Token } from "../../../utils/js-lexer";
import { createLineIndex, type LineIndex } from "../../../utils/text";
import { createRangeCursor, ignoredRanges, type IgnoreMarkers } from "./ignore-regions";

export interface CloneSource {
  path: string;
  content: string;
}

export interface CloneOptions {
  /** The fewest tokens a clone has */
  minTokens: number;
  /** The fewest lines a clone spans, in either copy */
  minLines: number;
  /** Comments that start and end a region to leave out */
  ignoreMarkers: readonly IgnoreMarkers[];
}

export interface CloneLocation {
  file: string;
  /** 1-based, inclusive */
  startLine: number;
  /** 1-based, inclusive */
  endLine: number;
}

export interface Clone {
  /** The first appearance (earlier path, or earlier in the same file) */
  first: CloneLocation;
  /** The copy */
  second: CloneLocation;
  tokens: number;
}

interface TokenizedFile {
  path: string;
  content: string;
  /** One 32-bit value per token; equal values mean equal tokens */
  values: Int32Array;
  starts: Int32Array;
  ends: Int32Array;
  lines?: LineIndex;
}

/** The murmur3 finalizer: a bijection on 32-bit integers that spreads small ids apart */
function mix(value: number): number {
  let hash = value | 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash | 0;
}

/** Operators that are one token, as in jscpd (the tokenizer emits most as single characters) */
const OPERATORS = new Set([
  ">>>=", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
]);

/**
 * A template literal with `${...}` as its text parts: "`a ${", "} b ${", "} c`". The code
 * inside the substitutions is tokenized already (`inner`, in source order).
 */
function templateParts(template: Token, inner: readonly Token[], content: string): Token[] {
  const parts: Token[] = [];
  const push = (start: number, end: number) =>
    parts.push({ type: "template", value: content.slice(start, end), start, end });
  let partStart = template.start;
  let cursor = template.start + 1;
  let next = 0;
  let inSubstitution = false;

  while (cursor < template.end - 1) {
    if (!inSubstitution) {
      if (content.charCodeAt(cursor) === 92 /* \ */) {
        cursor += 2;
      } else if (content.startsWith("${", cursor)) {
        push(partStart, cursor + 2);
        cursor += 2;
        inSubstitution = true;
      } else {
        cursor++;
      }
      continue;
    }
    while (next < inner.length && inner[next]!.end <= cursor) next++;
    const token = inner[next];
    if (token && token.start <= cursor) {
      cursor = token.end; // skip code, including nested templates and their own code
    } else if (content.charCodeAt(cursor) === 125 /* } */) {
      partStart = cursor;
      cursor++;
      inSubstitution = false;
    } else {
      cursor++;
    }
  }
  push(partStart, template.end);
  return parts;
}

/**
 * The tokens as clones count them, matching jscpd's granularity so `minTokens` means the
 * same in both: adjacent operator characters joined (`===`, `+=`), a template literal's
 * text parts as tokens of their own, and JSX's `</` and `/>` and dotted tag names
 * (`motion.div`) split. `tokens` must be in source order.
 */
function cloneTokens(tokens: readonly Token[], content: string): Token[] {
  const out: Token[] = [];
  let reorder = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type === "template" && token.hasSubstitutions) {
      let last = index + 1;
      while (last < tokens.length && tokens[last]!.start < token.end) last++;
      out.push(...templateParts(token, tokens.slice(index + 1, last), content));
      reorder = true;
      continue;
    }
    if (token.type === "punct") {
      if (token.value === "</" || token.value === "/>") {
        out.push({ ...token, value: token.value[0]!, end: token.start + 1 });
        out.push({ ...token, value: token.value[1]!, start: token.start + 1 });
        continue;
      }
      let joined = token;
      for (let length = 4; length >= 2; length--) {
        const run = tokens.slice(index, index + length);
        if (run.length !== length) continue;
        const contiguous = run.every(
          (part, at) => part.type === "punct" && part.value.length === 1 && (at === 0 || run[at - 1]!.end === part.start)
        );
        const value = run.map((part) => part.value).join("");
        if (contiguous && OPERATORS.has(value)) {
          joined = { ...token, value, end: run[length - 1]!.end };
          index += length - 1;
          break;
        }
      }
      out.push(joined);
      continue;
    }
    if (token.type === "name" && token.value.includes(".")) {
      let offset = token.start;
      token.value.split(".").forEach((part, at) => {
        if (at > 0) {
          out.push({ type: "punct", value: ".", start: offset, end: offset + 1 });
          offset++;
        }
        if (part) out.push({ type: "name", value: part, start: offset, end: offset + part.length });
        offset += part.length;
      });
      continue;
    }
    out.push(token);
  }
  // A template's later parts sit between the code of its substitutions
  return reorder ? out.sort((a, b) => a.start - b.start) : out;
}

/** The text a token is compared by: its kind and value */
function tokenText(token: Token): string {
  switch (token.type) {
    case "name":
      return `n${token.value}`;
    case "punct":
      return `p${token.value}`;
    case "string":
      return `s${token.value}`;
    case "template":
      return `t${token.value}`;
    case "jsx-text":
      return `x${token.value}`;
    default:
      return `${token.type}:${token.value}`;
  }
}

/**
 * Tokenize every source and give equal tokens equal values. Left-out regions become one
 * value each that matches nothing, so no clone runs across them.
 */
function tokenizeAll(sources: readonly CloneSource[], markers: readonly IgnoreMarkers[]): TokenizedFile[] {
  const ids = new Map<string, number>();
  // Interned ids count up from 0 and gaps count down from -1: mix() is a bijection, so the
  // two never meet
  let gaps = 0;

  return sources.map(({ path, content }) => {
    const comments: Comment[] = [];
    const lexed = tokenize(content, { jsx: jsxEnabledFor(path), jsxContents: true, comments });
    // Templates with ${...} are emitted after the code inside them: restore source order
    if (lexed.some((token, index) => index > 0 && token.start < lexed[index - 1]!.start)) {
      lexed.sort((a, b) => a.start - b.start);
    }
    const tokens = cloneTokens(lexed, content);
    const ignored = createRangeCursor(markers.length > 0 ? ignoredRanges(content, comments, markers) : []);

    const values = new Int32Array(tokens.length);
    const starts = new Int32Array(tokens.length);
    const ends = new Int32Array(tokens.length);
    let count = 0;
    let inGap = false;
    for (const token of tokens) {
      if (ignored(token.start)) {
        if (!inGap) {
          values[count] = mix(--gaps);
          starts[count] = token.start;
          ends[count] = token.start;
          count++;
          inGap = true;
        }
        continue;
      }
      inGap = false;
      const text = tokenText(token);
      let id = ids.get(text);
      if (id === undefined) {
        id = ids.size;
        ids.set(text, id);
      }
      values[count] = mix(id);
      starts[count] = token.start;
      ends[count] = token.end;
      count++;
    }

    return {
      path,
      content,
      values: values.subarray(0, count),
      starts: starts.subarray(0, count),
      ends: ends.subarray(0, count),
    };
  });
}

const BASE_A = 0x01000193;
const BASE_B = 0x5bd1e995;
/** Window keys combine a 32-bit and a 21-bit hash into one safe integer */
const HIGH = 2 ** 21;
/** Positions are stored as file * 2^32 + token index */
const FILE_STRIDE = 2 ** 32;

function power(base: number, exponent: number): number {
  let result = 1;
  for (let index = 0; index < exponent; index++) result = Math.imul(result, base);
  return result;
}

function windowHashes(values: Int32Array, from: number, length: number): [number, number] {
  let a = 0;
  let b = 0;
  for (let index = from; index < from + length; index++) {
    a = (Math.imul(a, BASE_A) + values[index]!) | 0;
    b = (Math.imul(b, BASE_B) + values[index]!) | 0;
  }
  return [a, b];
}

function sameTokens(first: Int32Array, from: number, second: Int32Array, at: number, length: number): boolean {
  for (let index = 0; index < length; index++) {
    if (first[from + index] !== second[at + index]) return false;
  }
  return true;
}

function locate(file: TokenizedFile, from: number, to: number): CloneLocation {
  file.lines ??= createLineIndex(file.content);
  return {
    file: file.path,
    startLine: file.lines.lineAt(file.starts[from]!),
    endLine: file.lines.lineAt(Math.max(file.starts[to]!, file.ends[to]! - 1)),
  };
}

/**
 * Every clone of at least `minTokens` tokens and `minLines` lines across `sources`.
 * Sources are read in the order given; pass them sorted by path for stable results.
 */
export function findClones(sources: readonly CloneSource[], options: CloneOptions): Clone[] {
  const window = Math.max(1, Math.floor(options.minTokens));
  const files = tokenizeAll(sources, options.ignoreMarkers);
  const firstSeen = new Map<number, number>();
  const clones: Clone[] = [];
  const dropA = power(BASE_A, window - 1);
  const dropB = power(BASE_B, window - 1);

  files.forEach((file, fileIndex) => {
    const { values } = file;
    const last = values.length - window;
    if (last < 0) return;

    let [hashA, hashB] = windowHashes(values, 0, window);
    let position = 0;
    while (position <= last) {
      const key = (hashA >>> 0) * HIGH + ((hashB >>> 0) % HIGH);
      const seen = firstSeen.get(key);
      let jumpTo = -1;

      if (seen === undefined) {
        firstSeen.set(key, fileIndex * FILE_STRIDE + position);
      } else {
        const otherIndex = Math.floor(seen / FILE_STRIDE);
        const otherAt = seen % FILE_STRIDE;
        const other = files[otherIndex]!;
        const sameFile = otherIndex === fileIndex;
        const overlaps = sameFile && otherAt + window > position;

        if (!overlaps && sameTokens(other.values, otherAt, values, position, window)) {
          let length = window;
          while (
            position + length < values.length &&
            otherAt + length < other.values.length &&
            other.values[otherAt + length] === values[position + length] &&
            !(sameFile && otherAt + length >= position)
          ) {
            length++;
          }

          const first = locate(other, otherAt, otherAt + length - 1);
          const second = locate(file, position, position + length - 1);
          const lines = Math.max(first.endLine - first.startLine, second.endLine - second.startLine) + 1;
          if (lines >= options.minLines) {
            clones.push({ first, second, tokens: length });
          }
          // Carry on after the copy: no stretch of a file is reported as a copy twice, and a
          // long repeating run (a table of zeros) gives a few reports, not one per offset
          jumpTo = position + length;
        }
      }

      if (jumpTo !== -1) {
        position = jumpTo;
        if (position <= last) [hashA, hashB] = windowHashes(values, position, window);
        continue;
      }
      if (position < last) {
        const outgoing = values[position]!;
        const incoming = values[position + window]!;
        hashA = (Math.imul((hashA - Math.imul(outgoing, dropA)) | 0, BASE_A) + incoming) | 0;
        hashB = (Math.imul((hashB - Math.imul(outgoing, dropB)) | 0, BASE_B) + incoming) | 0;
      }
      position++;
    }
  });

  return clones;
}
