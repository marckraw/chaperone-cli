/**
 * Rule-level errors: results that say a rule (or tool) could not check, not that the code breaks
 * it. They fail the check like any error, but a baseline never records them, and while one is
 * reported the rule's baseline entries are unverified rather than stale.
 */

import type { CheckResult } from "./types";

/** `result`, marked as the rule failing to check */
export function ruleError<T extends CheckResult>(result: T): T & { ruleError: true } {
  return { ...result, ruleError: true };
}

export function isRuleError(result: CheckResult): boolean {
  return result.ruleError === true;
}
