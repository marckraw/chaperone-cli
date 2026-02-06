import { z } from "zod";

/**
 * AI-generated metadata (optional on all rules)
 */
const aiGeneratedMetadataSchema = z.object({
  source: z.string().optional().describe("Source file the rule was extracted from (e.g., 'CLAUDE.md')"),
  originalText: z.string().optional().describe("The original instruction text from the AI file"),
});

/**
 * Base rule schema
 */
const baseRuleSchema = z.object({
  id: z.string().describe("Unique kebab-case identifier for the rule"),
  severity: z.enum(["error", "warning"]).default("error").describe("Severity level"),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Glob patterns to exclude from this rule (e.g., ['**/*.test.ts', 'src/generated/**'])"),
}).merge(aiGeneratedMetadataSchema);

/**
 * File naming rule - check for companion files
 */
export const fileNamingRuleSchema = baseRuleSchema.extend({
  type: z.literal("file-naming"),
  pattern: z.string().describe("Glob pattern for files to check, e.g., 'src/**/*.tsx'"),
  requireCompanion: z
    .object({
      transform: z
        .string()
        .describe("Transform pattern for companion file, e.g., '$1.styles.ts' or '$1.test.ts'"),
    })
    .optional()
    .describe("Require a companion file for each match"),
  message: z.string().optional().describe("Custom error message"),
});

/**
 * Regex rule - search for forbidden/required patterns
 */
export const regexRuleSchema = baseRuleSchema.extend({
  type: z.literal("regex"),
  pattern: z.string().describe("Regex pattern to search for (properly escaped)"),
  files: z.string().describe("Glob pattern for files to check, e.g., 'src/**/*.ts'"),
  message: z.string().describe("Error message explaining the violation"),
  mustMatch: z
    .boolean()
    .default(false)
    .describe("If true, pattern must exist; if false, pattern must NOT exist"),
  reportOnce: z
    .boolean()
    .optional()
    .describe("If true, only report the first match per file (useful for file-level rules like 'must use .tsx extension')"),
});

/**
 * Package fields rule - validate package.json has required fields
 */
export const packageFieldsRuleSchema = baseRuleSchema.extend({
  type: z.literal("package-fields"),
  requiredFields: z
    .array(z.string())
    .describe("Fields that must exist in package.json (supports dot notation like 'scripts.build')"),
  forbiddenFields: z
    .array(z.string())
    .optional()
    .describe("Fields that must NOT exist in package.json"),
  fieldPatterns: z
    .record(z.string(), z.string())
    .optional()
    .describe("Field values must match these regex patterns"),
  message: z.string().optional().describe("Custom error message"),
});

/**
 * Component location rule - ensure component types are in correct folders
 */
export const componentLocationRuleSchema = baseRuleSchema.extend({
  type: z.literal("component-location"),
  files: z.string().describe("Glob pattern for component files to check, e.g., 'src/**/*.tsx'"),
  componentType: z
    .enum(["presentational", "stateful"])
    .describe("Type of component: 'presentational' (pure, no hooks/state) or 'stateful' (has hooks/state)"),
  requiredLocation: z
    .string()
    .describe("Folder/pattern where these components should be, e.g., 'src/components/ui/'"),
  mustBeIn: z
    .boolean()
    .describe("If true, components must be in location; if false, must NOT be in location"),
  message: z.string().optional().describe("Custom error message"),
});

/**
 * Command rule - run command-based invariant checks
 */
export const commandRuleSchema = baseRuleSchema.extend({
  type: z.literal("command"),
  command: z.string().describe("Executable to run, e.g., 'npm' or 'node'"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  cwd: z.string().optional().describe("Optional working directory relative to project root"),
  timeoutMs: z.number().int().positive().optional().describe("Optional command timeout in milliseconds"),
  expectedExitCode: z.number().int().optional().describe("Expected process exit code (default: 0)"),
  stdoutPattern: z.string().optional().describe("Optional regex that stdout must match"),
  stderrPattern: z.string().optional().describe("Optional regex that stderr must match"),
  message: z.string().optional().describe("Custom error message"),
});

/**
 * Symbol reference rule - ensure exported symbols are referenced in target files
 */
export const symbolReferenceRuleSchema = baseRuleSchema.extend({
  type: z.literal("symbol-reference"),
  sourceFiles: z.string().describe("Glob pattern for source files with exported symbols"),
  targetFiles: z.string().describe("Glob pattern for files where symbols must be referenced"),
  symbolKinds: z
    .array(z.enum(["function-declaration", "function-variable"]))
    .optional()
    .describe("Kinds of exported symbols to enforce"),
  symbolPattern: z
    .string()
    .optional()
    .describe("Optional regex filter applied to symbol names before checking"),
  ignoreSymbols: z.array(z.string()).optional().describe("Symbol names to ignore"),
  message: z.string().optional().describe("Custom error message"),
});

/**
 * Union of all custom rule types
 */
export const customRuleSchema = z.discriminatedUnion("type", [
  fileNamingRuleSchema,
  regexRuleSchema,
  packageFieldsRuleSchema,
  componentLocationRuleSchema,
  commandRuleSchema,
  symbolReferenceRuleSchema,
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
export type FileNamingRule = z.infer<typeof fileNamingRuleSchema>;
export type RegexRule = z.infer<typeof regexRuleSchema>;
export type PackageFieldsRule = z.infer<typeof packageFieldsRuleSchema>;
export type ComponentLocationRule = z.infer<typeof componentLocationRuleSchema>;
export type CommandRule = z.infer<typeof commandRuleSchema>;
export type SymbolReferenceRule = z.infer<typeof symbolReferenceRuleSchema>;
export type CustomRule = z.infer<typeof customRuleSchema>;
export type SkippedInstruction = z.infer<typeof skippedInstructionSchema>;
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;
