import type { CheckResult, CustomRule } from "../types";
import type { FileIndex } from "../../utils/file-index";

/**
 * Debug callback for reporting rule execution
 */
export type DebugCallback = (message: string) => void;

/**
 * Shared, per-run state for rules: one file walk, one content cache.
 */
export interface RuleContext {
  readonly cwd: string;
  /** Every file that survived the global excludes, plus a lazy content cache */
  readonly index: FileIndex;
}

/**
 * Options for running custom rules
 */
export interface RuleRunnerOptions {
  cwd: string;
  include: string[];
  /** Global exclude patterns (already merged with the defaults) */
  exclude: string[];
  onDebug?: DebugCallback;
  /** Shared run state. Created on demand from cwd/exclude when omitted. */
  context?: RuleContext;
}

/**
 * Result from running a custom rule
 */
export interface RuleResult {
  ruleId: string;
  results: CheckResult[];
  /**
   * How many files the rule's own globs selected (after excludes).
   * Undefined for rules that do not scan files (package-fields, command).
   */
  filesChecked?: number;
  /** Non-violation notices about the rule's scope, e.g. a glob that matched no files */
  notices?: string[];
}

/**
 * Interface for rule runners
 */
export interface RuleRunner {
  type: string;
  run(rule: CustomRule, options: RuleRunnerOptions): Promise<RuleResult>;
}
