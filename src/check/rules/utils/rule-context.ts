import { createFileIndex } from "../../../utils/file-index";
import type { RuleContext, RuleRunnerOptions } from "../types";

/**
 * Create the shared per-run rule context: a single pruned walk of `cwd`.
 */
export function createRuleContext(cwd: string, exclude: readonly string[]): RuleContext {
  return {
    cwd,
    index: createFileIndex(cwd, { exclude }),
  };
}

/**
 * The context passed in by the orchestrator, or a fresh one for standalone calls.
 */
export function getRuleContext(options: RuleRunnerOptions): RuleContext {
  return options.context ?? createRuleContext(options.cwd, options.exclude);
}
