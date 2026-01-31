import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AIInstructionFile } from "../check/types";
import { extractionResponseSchema } from "./schemas";
import type { ExtractionResponse } from "./schemas";
import { SYSTEM_PROMPT, createUserPrompt } from "./prompts";

export interface ExtractRulesOptions {
  apiKey?: string;
  verbose?: boolean;
  onProgress?: (message: string) => void;
}

/**
 * Extract rules from AI instruction files using Claude
 */
export async function extractRulesFromInstructions(
  files: AIInstructionFile[],
  options: ExtractRulesOptions = {}
): Promise<ExtractionResponse> {
  const apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required. Set it as an environment variable or pass it via --api-key option."
    );
  }

  if (files.length === 0) {
    return {
      rules: [],
      summary: "No AI instruction files found to analyze.",
      skipped: [],
    };
  }

  options.onProgress?.(`Analyzing ${files.length} AI instruction file(s)...`);

  const anthropic = createAnthropic({ apiKey });

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: extractionResponseSchema,
    system: SYSTEM_PROMPT,
    prompt: createUserPrompt(files),
    temperature: 0.1,
  });

  return object;
}

/**
 * Validate that extracted rules have valid regex patterns
 */
export function validateExtractedRules(
  response: ExtractionResponse,
  onProgress?: (message: string) => void
): ExtractionResponse {
  const validRules: ExtractionResponse["rules"] = [];
  const invalidRules: Array<{ rule: (typeof response.rules)[0]; error: string }> = [];

  for (const rule of response.rules) {
    if ("pattern" in rule && rule.pattern) {
      try {
        new RegExp(rule.pattern);
        validRules.push(rule);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        invalidRules.push({ rule, error: message });
        onProgress?.(`Warning: Invalid regex in rule "${rule.id}": ${message}`);
      }
    } else {
      validRules.push(rule);
    }
  }

  const skipped = response.skipped ?? [];

  for (const { rule, error } of invalidRules) {
    skipped.push({
      text: "originalText" in rule ? rule.originalText : rule.id,
      reason: `Invalid regex pattern: ${error}`,
    });
  }

  return {
    rules: validRules,
    summary: response.summary,
    skipped: skipped.length > 0 ? skipped : undefined,
  };
}
