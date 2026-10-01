import { compileGlob } from "../../utils/glob";
import type { CheckResult, DuplicateCodeRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { findClones, type Clone, type CloneLocation } from "./utils/clones";
import { findingMessage } from "./utils/findings";
import { CHAPERONE_IGNORE, JSCPD_IGNORE } from "./utils/ignore-regions";
import { getRuleContext } from "./utils/rule-context";

export const DUPLICATE_CODE_DEFAULTS = { minTokens: 100, minLines: 5 } as const;

function place(location: CloneLocation): string {
  return `${location.file}:${location.startLine}-${location.endLine}`;
}

/**
 * Run a duplicate-code rule: no block of `minTokens` tokens (spanning `minLines` lines)
 * may appear twice across the matched files, unless the rule allows that pair of files.
 * Each copy is reported once, against the first place the block appears.
 */
export async function runDuplicateCodeRule(rule: DuplicateCodeRule, options: RuleRunnerOptions): Promise<RuleResult> {
  const context = getRuleContext(options);
  const { index } = context;
  const files = index.glob(rule.files, rule.exclude ?? []);
  const minTokens = rule.minTokens ?? DUPLICATE_CODE_DEFAULTS.minTokens;
  const minLines = rule.minLines ?? DUPLICATE_CODE_DEFAULTS.minLines;
  const ruleName = `duplicate-code/${rule.id}`;

  const sources = files.flatMap((file) => {
    const content = index.read(file);
    return content === null ? [] : [{ path: file, content }];
  });
  const clones = findClones(sources, { minTokens, minLines, ignoreMarkers: [CHAPERONE_IGNORE, JSCPD_IGNORE] });

  const allow = (rule.allow ?? []).map((entry) => ({
    first: compileGlob(entry.files[0]),
    second: compileGlob(entry.files[1]),
  }));
  const used = new Set<number>();
  const allowedBy = (clone: Clone): number =>
    allow.findIndex(
      ({ first, second }) =>
        (first(clone.first.file) && second(clone.second.file)) || (second(clone.first.file) && first(clone.second.file))
    );

  // Under --since, report a copy when either of its files changed
  const inScope = new Set(context.inScope(files));
  const reported = clones
    .filter((clone) => {
      const position = allowedBy(clone);
      if (position === -1) return true;
      used.add(position);
      return false;
    })
    .filter((clone) => inScope.has(clone.first.file) || inScope.has(clone.second.file))
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        (place(a.second) < place(b.second) ? -1 : place(a.second) > place(b.second) ? 1 : 0) ||
        (place(a.first) < place(b.first) ? -1 : place(a.first) > place(b.first) ? 1 : 0)
    );

  const results: CheckResult[] = reported.map((clone) => {
    const lines = clone.second.endLine - clone.second.startLine + 1;
    return {
      file: clone.second.file,
      line: clone.second.startLine,
      rule: ruleName,
      message: findingMessage(
        rule.message,
        `lines ${clone.second.startLine}-${clone.second.endLine} repeat ${place(clone.first)}, ${clone.tokens} tokens`
      ),
      severity: rule.severity,
      source: "custom",
      suggestion:
        "Make the copies one shared function, hook or component. If they must stay apart, add the two files to the rule's allow list with a reason, or wrap one copy in chaperone-ignore-start / chaperone-ignore-end comments that say why.",
      context: {
        expectedValue: `no copied block of ${minTokens}+ tokens`,
        actualValue: `${clone.tokens} tokens over ${lines} lines`,
        locations: [place(clone.first), place(clone.second)],
      },
    };
  });

  // An allow entry that excuses nothing is reported, so the list cannot outlive its reasons
  (rule.allow ?? []).forEach((entry, position) => {
    if (used.has(position)) return;
    results.push({
      file: ".chaperone.json",
      rule: ruleName,
      message: `allow entry for ${entry.files[0]} and ${entry.files[1]} no longer matches a copy. Remove it from the allow list.`,
      severity: rule.severity,
      source: "custom",
      context: { expectedValue: "a copy between the two files", actualValue: "none" },
    });
  });

  return { ruleId: rule.id, results, filesChecked: files.length };
}

/**
 * Check if a rule is a DuplicateCodeRule
 */
export function isDuplicateCodeRule(rule: unknown): rule is DuplicateCodeRule {
  return typeof rule === "object" && rule !== null && (rule as DuplicateCodeRule).type === "duplicate-code";
}
