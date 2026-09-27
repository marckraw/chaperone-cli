import { describe, expect, test } from "bun:test";
import { countLines, createLineIndex, nonEmptyMatches, truncate } from "./text";

describe("countLines", () => {
  test("does not count the trailing newline as a line", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("")).toBe(0);
    expect(countLines("\n")).toBe(1);
    expect(countLines("a\r\nb\r\n")).toBe(2);
  });
});

describe("createLineIndex", () => {
  test("maps offsets to lines and columns", () => {
    const content = "ab\ncd\n\nef";
    const index = createLineIndex(content);
    expect(index.lineAt(0)).toBe(1);
    expect(index.lineAt(3)).toBe(2);
    expect(index.columnAt(4)).toBe(2);
    expect(index.lineAt(content.indexOf("e"))).toBe(4);
    expect(index.line(2)).toBe("cd");
    expect(index.line(3)).toBe("");
  });
});

describe("nonEmptyMatches", () => {
  test("skips zero-length matches without looping forever", () => {
    const matches = [...nonEmptyMatches("a TODO b TODO", /TODO|/g)].map((match) => match.index);
    expect(matches).toEqual([2, 9]);
  });

  test("handles unicode surrogate pairs with the u flag", () => {
    expect([...nonEmptyMatches("😀x😀", /x|(?:)/gu)].map((match) => match[0])).toEqual(["x"]);
  });

  test("requires a global regex", () => {
    expect(() => [...nonEmptyMatches("a", /a/)]).toThrow("global");
  });
});

describe("truncate", () => {
  test("shortens long text", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
