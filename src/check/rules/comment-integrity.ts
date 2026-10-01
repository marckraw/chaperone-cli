/**
 * comment-integrity: block comments a merge broke, in JavaScript and TypeScript files.
 *
 * A conflict between two changes that each add a documented declaration next to the other's is
 * easy to resolve into a broken comment: the resolution keeps both sides' text but loses one `/**`
 * or one `*\/`. Without its opener the rest of the comment is code, and the compiler stops at a
 * syntax error far from the cause. Without the first comment's `*\/` it is worse: the second
 * comment opens inside the first, the two read as one, and whatever lay between them disappears
 * into it with no error at all. This rule names each case at its line.
 */

import type { CheckResult, CommentIntegrityRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { type Comment, jsxEnabledFor, tokenize } from "../../utils/js-lexer";
import { createLineIndex } from "../../utils/text";
import { findingMessage } from "./utils/findings";
import { getRuleContext } from "./utils/rule-context";

export interface CommentProblem {
  line: number;
  message: string;
  /** A comment that opens inside another: the line where the outer one opened */
  openedAt?: number;
}

/** A line that reads like a comment's middle or end: `* text`, `*`, or `*\/`. */
const COMMENT_LINE = /^[ \t]*\*(?:[ \t]|\/|$)/;

/**
 * Every broken comment in a file's text. Strings, template literals, regular expressions and JSX
 * text may hold `/*` or a line starting with `*` without it meaning anything.
 */
export function findCommentProblems(content: string, filePath: string): CommentProblem[] {
  const comments: Comment[] = [];
  const tokens = tokenize(content, { jsx: jsxEnabledFor(filePath), comments });
  const lines = createLineIndex(content);
  const problems: CommentProblem[] = [];

  for (const comment of comments) {
    if (!comment.block) continue;
    if (!comment.closed) {
      problems.push({
        line: lines.lineAt(comment.start),
        message: "a comment that never closes: a merge may have dropped its */",
      });
      continue;
    }
    // A line inside the comment that opens another one: the first comment's */ was lost.
    const text = content.slice(comment.start, comment.end);
    let offset = text.indexOf("\n");
    while (offset !== -1) {
      const rest = text.slice(offset + 1);
      if (/^[ \t]*\/\*/.test(rest)) {
        const openedAt = lines.lineAt(comment.start);
        problems.push({
          line: lines.lineAt(comment.start + offset + 1),
          message: `a comment opens inside the comment from line ${openedAt}: a merge may have dropped that one's */`,
          openedAt,
        });
      }
      offset = text.indexOf("\n", offset + 1);
    }
  }

  // Lines that read like a comment's middle but sit in code: its /** was lost. One problem per run.
  const covered = [
    ...comments.map(({ start, end }) => [start, end] as const),
    ...tokens
      .filter((token) => token.type !== "name" && token.type !== "punct" && token.type !== "number")
      .map(({ start, end }) => [start, end] as const),
  ].sort((a, b) => a[0] - b[0]);
  const isCovered = (offset: number): boolean => {
    let low = 0;
    let high = covered.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const [start, end] = covered[middle]!;
      if (offset < start) high = middle - 1;
      else if (offset >= end) low = middle + 1;
      else return true;
    }
    return false;
  };

  let lineStart = 0;
  let line = 1;
  let previousWasOrphan = false;
  while (lineStart <= content.length) {
    const lineEnd = content.indexOf("\n", lineStart);
    const text = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
    const star = text.indexOf("*");
    const orphan = COMMENT_LINE.test(text) && !isCovered(lineStart + star);
    if (orphan && !previousWasOrphan) {
      problems.push({
        line,
        message: "a comment's line with no comment open: a merge may have dropped the /** above it",
      });
    }
    previousWasOrphan = orphan;
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
    line += 1;
  }

  return problems.sort((a, b) => a.line - b.line);
}

export async function runCommentIntegrityRule(
  rule: CommentIntegrityRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const files = context.index.glob(rule.files, rule.exclude ?? []);
  const results: CheckResult[] = [];

  for (const file of context.inScope(files)) {
    const content = context.index.read(file);
    if (content === null) continue;
    for (const problem of findCommentProblems(content, file)) {
      results.push({
        file,
        line: problem.line,
        rule: `comment-integrity/${rule.id}`,
        message: findingMessage(rule.message, problem.message),
        severity: rule.severity,
        source: "custom",
        suggestion: "Compare the comment with both sides of the merge and restore the lost /** or */",
        ...(problem.openedAt === undefined
          ? {}
          : { context: { locations: [`${file}:${problem.openedAt}`, `${file}:${problem.line}`] } }),
      });
    }
  }

  return { ruleId: rule.id, results, filesChecked: files.length };
}

export function isCommentIntegrityRule(rule: unknown): rule is CommentIntegrityRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as CommentIntegrityRule).type === "comment-integrity"
  );
}
