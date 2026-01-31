import type { CheckResult, CustomRule } from "../types";

/**
 * Options for running custom rules
 */
export interface RuleRunnerOptions {
  cwd: string;
  include: string[];
  exclude: string[];
}

/**
 * Result from running a custom rule
 */
export interface RuleResult {
  ruleId: string;
  results: CheckResult[];
}

/**
 * Interface for rule runners
 */
export interface RuleRunner {
  type: string;
  run(rule: CustomRule, options: RuleRunnerOptions): Promise<RuleResult>;
}
