/**
 * unique-capture: files whose paths capture the same key.
 *
 * Numbered files that two branches add at once collide after the merge: two migrations numbered
 * 0016, two ADRs numbered 0007. Each branch was fine on its own, and the folder can still look
 * fine. This rule captures a key from every matching path and reports each key more than one file
 * shares.
 */

import { basename } from "node:path";
import type { CheckResult, UniqueCaptureRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { findingMessage } from "./utils/findings";
import { getRuleContext } from "./utils/rule-context";

/** The files sharing each key: only keys with more than one file, in path order. */
export function findDuplicateCaptures(
  files: readonly string[],
  capture: UniqueCaptureRule["capture"]
): Map<string, string[]> {
  const pattern = new RegExp(capture.pattern);
  const group = capture.group ?? 1;
  const byKey = new Map<string, string[]>();
  for (const file of [...files].sort()) {
    const subject = capture.source === "basename" ? basename(file) : file;
    const key = pattern.exec(subject)?.[group];
    if (key === undefined) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), file]);
  }
  for (const [key, sharing] of byKey) {
    if (sharing.length < 2) byKey.delete(key);
  }
  return byKey;
}

export async function runUniqueCaptureRule(
  rule: UniqueCaptureRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const files = context.index.glob(rule.files, rule.exclude ?? []);
  const inScope = new Set(context.inScope(files));
  const results: CheckResult[] = [];

  // Each shared key is reported once, at its first file, with every file that shares it.
  // Under --since, a key is reported when one of its files changed.
  for (const [key, sharing] of findDuplicateCaptures(files, rule.capture)) {
    if (!sharing.some((file) => inScope.has(file))) continue;
    results.push({
      file: sharing[0]!,
      rule: `unique-capture/${rule.id}`,
      message: findingMessage(rule.message, `${sharing.length} files share the key "${key}"`),
      severity: rule.severity,
      source: "custom",
      suggestion: "Give all but one of the files a key of their own (a numbered migration: generate it again after the other branch's)",
      context: {
        matchedText: key,
        expectedValue: "one file per key",
        actualValue: `${sharing.length} files`,
        locations: sharing,
      },
    });
  }

  return { ruleId: rule.id, results, filesChecked: files.length };
}

export function isUniqueCaptureRule(rule: unknown): rule is UniqueCaptureRule {
  return (
    typeof rule === "object" && rule !== null && (rule as UniqueCaptureRule).type === "unique-capture"
  );
}
