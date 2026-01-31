import type { AIInstructionFile, ChaperoneConfig, CustomRule } from "../check/types";

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
}

/**
 * Result of the analyze command
 */
export interface AnalyzeResult {
  success: boolean;
  extractedRules: CustomRule[];
  addedRules: CustomRule[];
  skippedRules: CustomRule[];
  skippedInstructions: SkippedInstruction[];
  summary: string;
  aiFiles: AIInstructionFile[];
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
  rules: CustomRule[];
  summary: string;
  skipped?: SkippedInstruction[];
}

/**
 * Progress callback for verbose mode
 */
export type ProgressCallback = (message: string) => void;
