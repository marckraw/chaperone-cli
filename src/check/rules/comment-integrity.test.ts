import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../../testing/fixtures";
import type { CommentIntegrityRule } from "../types";
import { findCommentProblems, runCommentIntegrityRule } from "./comment-integrity";

afterEach(cleanupProjects);

const lines = (content: string, file = "a.ts") =>
  findCommentProblems(content, file).map((problem) => problem.line);

describe("findCommentProblems", () => {
  test("passes documented code, plain comments and comment-like text in literals", () => {
    const content = [
      "/** A server event, by name. */",
      "export type Events = {",
      "  /**",
      "   * Someone posted a message. `/auth/*` is public.",
      "   */",
      '  "message.posted": { id: string };',
      "};",
      'const glob = "apps/web/src/**";',
      "const t = `",
      " * a markdown list in a template",
      "`;",
      "const re = /\\/\\*|[/*]/g;",
      "const area = width",
      "  *height;",
      "function* gen() {}",
    ].join("\n");
    expect(findCommentProblems(content, "a.ts")).toEqual([]);
  });

  test("names the first line of a comment whose /** a merge dropped, once", () => {
    const content = [
      "export type Events = {",
      "  /**",
      "   * A member set a channel's Meet room.",
      "   */",
      '  "channel.meet-room-set": { channelId: string };',
      "   * Someone added a reaction to a message.",
      "   */",
      '  "reaction.changed": { messageId: string };',
      "};",
    ].join("\n");
    expect(findCommentProblems(content, "server-events.ts")).toEqual([
      {
        line: 6,
        message: "a comment's line with no comment open: a merge may have dropped the /** above it",
      },
    ]);
  });

  test("names a comment opening inside another, when a merge dropped the first one's */", () => {
    const content = [
      "/**",
      ' * "All files", a quiet row.',
      'export const allFilesLink = "mt-1";',
      "/**",
      " * The mark for unread mentions.",
      " */",
      'export const mentionMark = "size-5";',
    ].join("\n");
    const problems = findCommentProblems(content, "sidebar.styles.ts");
    expect(problems.map((problem) => problem.line)).toEqual([4]);
    expect(problems[0]!.message).toContain("inside the comment from line 1");
  });

  test("names a comment that never closes", () => {
    expect(lines("const a = 1;\n/**\n * Lost.\n")).toEqual([2]);
  });

  test("reads JSX: text, self-closing tags and comments in braces", () => {
    const content = [
      "export const Row = () => (",
      '  <p className="x">',
      "    It's here <Dot size=\"md\" /> {/* a note */}",
      "  </p>",
      ");",
      "/**",
      " * The next one.",
      " */",
      "export const Next = () => <Other value={x} />;",
    ].join("\n");
    expect(lines(content, "row.tsx")).toEqual([]);
  });
});

describe("runCommentIntegrityRule", () => {
  test("reports each broken comment at its file and line", async () => {
    const RULE: CommentIntegrityRule = {
      type: "comment-integrity",
      id: "comments",
      severity: "error",
      files: "src/**/*.{ts,tsx}",
    };
    const cwd = makeProject({
      "src/ok.ts": "/** Fine. */\nexport const ok = 1;\n",
      "src/broken.ts": "export const a = 1;\n * lost opener\n */\nexport const b = 2;\n",
    });
    const result = await runCommentIntegrityRule(RULE, { cwd, include: [], exclude: [] });
    expect(result.filesChecked).toBe(2);
    expect(result.results.map(({ file, line, rule }) => ({ file, line, rule }))).toEqual([
      { file: "src/broken.ts", line: 2, rule: "comment-integrity/comments" },
    ]);
  });
});
