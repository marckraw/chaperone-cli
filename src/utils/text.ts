/**
 * Text helpers: fast offset → line/column lookups and safe regex iteration.
 */

export interface LineIndex {
  /** 1-based line number of a character offset */
  lineAt(offset: number): number;
  /** 1-based column of a character offset */
  columnAt(offset: number): number;
  /** Text of a 1-based line (without the line break) */
  line(lineNumber: number): string;
  readonly lineCount: number;
}

export function createLineIndex(content: string): LineIndex {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  const lineAt = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (starts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };

  return {
    lineAt,
    columnAt: (offset) => offset - starts[lineAt(offset) - 1]! + 1,
    line: (lineNumber) => {
      const start = starts[lineNumber - 1];
      if (start === undefined) return "";
      const end = starts[lineNumber] ?? content.length + 1;
      return content.slice(start, end - 1).replace(/\r$/, "");
    },
    lineCount: starts.length,
  };
}

/**
 * Number of lines in a file: a trailing newline does not start a new line,
 * and an empty file has zero lines.
 */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10 && index < content.length - 1) {
      lines++;
    }
  }
  return lines;
}

/**
 * Iterate the non-empty matches of a global regex.
 * Zero-length matches are skipped (and never cause an infinite loop).
 */
export function* nonEmptyMatches(content: string, regex: RegExp): Generator<RegExpExecArray> {
  if (!regex.global) {
    throw new Error("nonEmptyMatches requires a global regex");
  }
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match[0] === "") {
      regex.lastIndex = advanceIndex(content, regex.lastIndex, regex.unicode || regex.flags.includes("v"));
      continue;
    }
    yield match;
  }
}

function advanceIndex(content: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= content.length) return index + 1;
  const code = content.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = content.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return index + 2;
  }
  return index + 1;
}

/**
 * Shorten long text for display.
 */
export function truncate(text: string, maxLength = 200): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
