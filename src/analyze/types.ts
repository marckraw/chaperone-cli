import type { AIInstructionFile, CustomRule } from "../check/types";
import type { SkippedRule } from "./config-merger";
import type { ExtractRulesOptions } from "./llm-client";

/**
 * Options for the analyze command
 */
export interface AnalyzeOptions {
  cwd: string;
  configPath?: string;
  dryRun?: boolean;
  force?: boolean;
  verbose?: boolean;
  apiKey?: string;
  /** Rule extraction (default: Claude via the Anthropic API); injectable for tests */
  extract?: (files: AIInstructionFile[], options: ExtractRulesOptions) => Promise<ExtractionResponse>;
}

/**
 * Result of the analyze command
 */
export interface AnalyzeResult {
  success: boolean;
  extractedRules: CustomRule[];
  addedRules: CustomRule[];
  /** Valid rules that were not added, with the reason */
  skippedRules: SkippedRule[];
  skippedInstructions: SkippedInstruction[];
  summary: string;
  aiFiles: AIInstructionFile[];
  /** The config file analyze reads and patches */
  configPath?: string;
  /** Whether the config file was written */
  written?: boolean;
}

/**
 * Instruction that could not be converted to a rule
 */
export interface SkippedInstruction {
  text: string;
  reason: string;
}

/**
 * Response from LLM extraction
 */
export interface ExtractionResponse {
  rules: unknown[];
  summary: string;
  skipped?: SkippedInstruction[];
}

/**
 * Progress callback for verbose mode
 */
export type ProgressCallback = (message: string) => void;
