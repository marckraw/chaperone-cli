import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AIInstructionFile } from "../check/types";
import { extractionResponseSchema } from "./schemas";
import type { ExtractionResponse } from "./types";
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
