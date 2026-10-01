import { z } from "zod";
import { RULE_SCHEMAS, type RuleType } from "../check/config-schema";

/**
 * Rule types `chaperone analyze` asks the model to produce.
 *
 * The list is deliberately restricted to rules that can be derived from prose
 * instructions. Structural rules (import-boundary, public-api, forbidden-import,
 * retired-path, react-component-count, directive-export-pattern), merge checks
 * (comment-integrity, unique-capture) and copy limits (repeated-literal, duplicate-code) need
 * knowledge of the codebase and are written by hand. Every extracted rule is validated again with the
 * full config schema before it is added.
 */
export const ANALYZE_RULE_TYPES = [
  "regex",
  "file-pairing",
  "file-contract",
  "package-fields",
  "component-location",
  "command",
  "symbol-reference",
] as const satisfies readonly RuleType[];

/**
 * Union of the rule types analyze can extract: the same shapes `chaperone check`
 * validates, minus fields a model should not set.
 */
export const customRuleSchema = z.discriminatedUnion("type", [
  RULE_SCHEMAS.regex.omit({ disabled: true, forbidden: true }),
  RULE_SCHEMAS["file-pairing"].omit({ disabled: true }),
  RULE_SCHEMAS["file-contract"].omit({ disabled: true }),
  RULE_SCHEMAS["package-fields"].omit({ disabled: true }),
  RULE_SCHEMAS["component-location"].omit({ disabled: true }),
  RULE_SCHEMAS.command.omit({ disabled: true }),
  RULE_SCHEMAS["symbol-reference"].omit({ disabled: true }),
]);

/**
 * Schema for skipped instructions
 */
export const skippedInstructionSchema = z.object({
  text: z.string().describe("The original instruction text"),
  reason: z.string().describe("Why this instruction could not be converted to a rule"),
});

/**
 * LLM extraction response schema
 */
export const extractionResponseSchema = z.object({
  rules: z
    .array(customRuleSchema)
    .describe("Array of extracted rules that can be enforced programmatically"),
  summary: z
    .string()
    .describe("Brief summary of what was extracted and any notable patterns found"),
  skipped: z
    .array(skippedInstructionSchema)
    .optional()
    .describe("Instructions that could not be converted to enforceable rules"),
});

/**
 * Type exports for use in other modules
 */
export type CustomRule = z.infer<typeof customRuleSchema>;
export type SkippedInstruction = z.infer<typeof skippedInstructionSchema>;
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;
