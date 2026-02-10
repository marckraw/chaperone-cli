/**
 * Unified check result format
 */
export interface CheckResult {
  file: string;
  rule: string; // e.g., "typescript/TS2322", "eslint/no-unused-vars"
  message: string;
  line?: number;
  column?: number;
  severity: "error" | "warning";
  source?: string; // The source of the rule (typescript, eslint, custom, ai-instructions)
  fixable?: boolean;
  suggestion?: string;
  // Additional context for debugging/fixing
  context?: {
    matchedText?: string; // For regex: the text that matched
    surroundingLines?: string[]; // Lines around the error for context
    field?: string; // For package-fields: which field
    expectedValue?: string; // What was expected
    actualValue?: string; // What was found
    componentType?: string; // For component-location: presentational/stateful
    symbol?: string; // For symbol-reference: symbol that should be referenced
    command?: string; // For command: executed command
    exitCode?: number; // For command: actual exit code
    detectedPatterns?: string[]; // What patterns were detected (e.g., hooks found)
  };
}

/**
 * Summary of check results
 */
export interface CheckSummary {
  totalFiles: number;
  totalErrors: number;
  totalWarnings: number;
  duration: number;
  success: boolean;
  results: CheckResult[];
  bySource: Record<string, CheckResult[]>;
}

/**
 * Check options passed from CLI
 */
export interface CheckOptions {
  configPath?: string;
  cwd: string;
  fix?: boolean;
  format: "text" | "json" | "ai";
  quiet?: boolean;
  noWarnings?: boolean;
  include?: string[];
  exclude?: string[];
  debug?: boolean;
}

/**
 * Base interface for all custom rules
 */
export interface BaseRule {
  type: string;
  id: string;
  severity: "error" | "warning";
  exclude?: string[]; // Glob patterns to exclude from this rule (e.g., ["**/*.test.ts", "src/generated/**"])
  disabled?: boolean; // Override a preset rule to disable it
}

/**
 * Optional metadata for AI-generated rules
 */
export interface AIGeneratedMetadata {
  source?: string; // File it was extracted from (e.g., "CLAUDE.md")
  originalText?: string; // The original instruction text
}

/**
 * File naming rule - check for companion files
 */
export interface FileNamingRule extends BaseRule, AIGeneratedMetadata {
  type: "file-naming";
  pattern: string; // Glob for files to check
  requireCompanion?: {
    transform: string; // e.g., "$1.styles.ts"
  };
  message?: string;
}

/**
 * File pairing rule - map each matched file path to a companion path and enforce existence/non-existence
 */
export interface FilePairingRule extends BaseRule, AIGeneratedMetadata {
  type: "file-pairing";
  files: string; // Glob for source files
  pair: {
    from: string; // Regex pattern applied to relative file path
    to: string; // Replacement string
  };
  mustExist?: boolean; // true = companion must exist, false = companion must NOT exist
  requireTransformMatch?: boolean; // true = rule errors when pair.from doesn't match a file path
  message?: string;
}

/**
 * File contract assertions - semantic content checks beyond regex
 */
export interface FileContractAssertions {
  firstLine?: string; // First non-empty, non-comment line must match (string or regex)
  mustExportDefault?: boolean;
  mustExportNamed?: boolean;
  mustNotImport?: string[]; // Module patterns that must not be imported (supports * glob)
  mustImport?: string[]; // Module patterns that must be imported
  maxLines?: number;
  minLines?: number;
  mustHaveJSDoc?: boolean; // Exported functions must have JSDoc
  maxExports?: number;
  mustBeModule?: boolean; // Must have at least one import or export
}

/**
 * File contract rule - enforce required/forbidden content patterns per file with optional filename capture templating
 */
export interface FileContractRule extends BaseRule, AIGeneratedMetadata {
  type: "file-contract";
  files: string; // Glob for files to check
  requiredPatterns?: string[]; // Patterns that must match each file
  requiredAnyPatterns?: string[]; // At least one pattern must match each file
  forbiddenPatterns?: string[]; // Patterns that must not match each file
  captureFromPath?: {
    pattern: string; // Regex pattern applied to file path or basename
    group?: number | string; // Capture group index or named group
    source?: "path" | "basename"; // Defaults to path
  };
  templatedRequiredPatterns?: string[]; // Supports {{capture}} placeholder
  templatedRequiredAnyPatterns?: string[]; // Supports {{capture}} placeholder
  templatedForbiddenPatterns?: string[]; // Supports {{capture}} placeholder
  assertions?: FileContractAssertions; // Semantic content checks
  message?: string;
}

/**
 * Regex rule - search for forbidden/required patterns
 */
export interface RegexRule extends BaseRule, AIGeneratedMetadata {
  type: "regex";
  pattern: string; // Regex to find
  files: string; // Glob for files
  message: string;
  mustMatch?: boolean; // true = must exist, false = must NOT exist (default)
  reportOnce?: boolean; // true = report only first match per file (useful for file-level rules like "must use .tsx")
}

/**
 * Package fields rule - validate package.json has required fields
 */
export interface PackageFieldsRule extends BaseRule, AIGeneratedMetadata {
  type: "package-fields";
  requiredFields: string[]; // Fields that must exist (supports dot notation: "scripts.build")
  forbiddenFields?: string[]; // Fields that must NOT exist
  fieldPatterns?: Record<string, string>; // Field value must match regex pattern
  message?: string;
}

/**
 * Component location rule - ensure component types are in correct folders
 */
export interface ComponentLocationRule extends BaseRule, AIGeneratedMetadata {
  type: "component-location";
  files: string; // Glob for component files to check
  componentType: "presentational" | "stateful"; // Type of component to check
  requiredLocation: string; // Folder/pattern where these components should be
  mustBeIn: boolean; // true = must be in location, false = must NOT be in location
  message?: string;
}

/**
 * Command rule - run command-based invariant checks
 */
export interface CommandRule extends BaseRule, AIGeneratedMetadata {
  type: "command";
  command: string; // Executable to run (e.g., "node", "npm")
  args?: string[]; // Command arguments
  cwd?: string; // Optional working directory (relative to project root)
  timeoutMs?: number; // Optional command timeout (default: 30000)
  expectedExitCode?: number; // Optional expected exit code (default: 0)
  stdoutPattern?: string; // Optional regex that stdout must match
  stderrPattern?: string; // Optional regex that stderr must match
  message?: string;
}

/**
 * Symbol reference rule - ensure exported symbols are referenced in target files
 */
export interface SymbolReferenceRule extends BaseRule, AIGeneratedMetadata {
  type: "symbol-reference";
  sourceFiles: string; // Glob for source files that define exported symbols
  targetFiles: string; // Glob for files where symbols must be referenced
  symbolKinds?: Array<"function-declaration" | "function-variable">;
  symbolPattern?: string; // Optional regex to filter symbol names
  ignoreSymbols?: string[]; // Symbols to ignore
  message?: string;
}

/**
 * Retired path rule - prevent files in deprecated directories
 */
export interface RetiredPathRule extends BaseRule, AIGeneratedMetadata {
  type: "retired-path";
  paths: Array<{
    pattern: string; // Glob for retired location
    reason?: string; // Why retired
    migratedTo?: string; // Where to put files instead
  }>;
  message?: string;
}

/**
 * File suffix content rule - content rules by file suffix
 */
export interface FileSuffixContentRule extends BaseRule, AIGeneratedMetadata {
  type: "file-suffix-content";
  suffix: string; // e.g., ".presentational.tsx"
  files: string; // Glob scope (e.g., "src/**")
  forbiddenPatterns?: Array<{ pattern: string; name: string }>;
  requiredPatterns?: Array<{ pattern: string; name: string }>;
  message?: string;
}

/**
 * File structure rule - enforce feature folder conventions
 */
export interface FileStructureRule extends BaseRule, AIGeneratedMetadata {
  type: "file-structure";
  parentDirs: string; // Glob for parent dirs (e.g., "src/features/*")
  required: string[]; // Must exist (e.g., ["ui", "index.ts"])
  optional?: string[]; // May exist (e.g., ["lib", "model", "api"])
  strict?: boolean; // If true, unlisted entries = violation
  message?: string;
}

/**
 * Forbidden import rule - restrict imports to specific files
 */
export interface ForbiddenImportRule extends BaseRule, AIGeneratedMetadata {
  type: "forbidden-import";
  files: string; // Glob for files to scan
  restrictions: Array<{
    source: string; // Regex matching import source
    allowedIn: string[]; // Globs for files where this import IS allowed
    message?: string;
  }>;
  checkPatterns?: Array<{
    pattern: string; // Regex matching code usage (e.g., "\\binvoke\\(")
    allowedIn: string[];
    message?: string;
  }>;
  includeTypeImports?: boolean; // default: false (type imports are safe)
  message?: string;
}

/**
 * Import boundary rule - enforce architectural layer boundaries
 */
export interface ImportBoundaryRule extends BaseRule, AIGeneratedMetadata {
  type: "import-boundary";
  layers: Record<
    string,
    {
      files: string; // Glob for layer files
      allowImportsFrom: string[]; // Layer names allowed to import from
    }
  >;
  includeTypeImports?: boolean; // default: true
  includeDynamicImports?: boolean; // default: true
  message?: string;
}

/**
 * Public API rule - enforce barrel file imports
 */
export interface PublicApiRule extends BaseRule, AIGeneratedMetadata {
  type: "public-api";
  modules: string; // Glob for module roots (e.g., "src/features/*")
  files: string; // Glob for files to check
  barrelFile?: string; // Default: "index.ts"
  allowSameModule?: boolean; // Default: true
  message?: string;
}

/**
 * Relationship rule actions
 */
export type RelationshipAction =
  | { mustHaveCompanion: { suffix?: string; pair?: { from: string; to: string } } }
  | { mustNotHaveCompanion: { suffix?: string; pair?: { from: string; to: string } } }
  | { mustImport: { companion?: boolean; modules?: string[] } }
  | { mustNotImport: { modules: string[] } }
  | { companionMustContain: { patterns: string[] } }
  | { companionMustNot: { patterns: string[] } }
  | { fileMustContain: { patterns: string[] } }
  | { fileMustNot: { patterns: string[] } }
  | { companionMaxLines: number }
  | { maxLines: number };

/**
 * Relationship rule - composite "if A then B" rules
 */
export interface RelationshipRule extends BaseRule, AIGeneratedMetadata {
  type: "relationship";
  when: { files: string };
  then: RelationshipAction[];
  message?: string;
}

/**
 * Union of all custom rule types
 */
export type CustomRule =
  | FileNamingRule
  | FilePairingRule
  | FileContractRule
  | RegexRule
  | PackageFieldsRule
  | ComponentLocationRule
  | CommandRule
  | SymbolReferenceRule
  | RetiredPathRule
  | FileSuffixContentRule
  | FileStructureRule
  | ForbiddenImportRule
  | ImportBoundaryRule
  | PublicApiRule
  | RelationshipRule;

/**
 * @deprecated Use RegexRule with source metadata instead
 */
export type AIInstructionsRule = RegexRule;

/**
 * Tool runner configuration
 */
export interface ToolConfig {
  enabled: boolean;
  extensions?: string[];
  args?: string[];
}

/**
 * AI instructions configuration
 */
export interface AIInstructionsConfig {
  autoDetect: boolean;
  files: string[];
  extractRules: boolean;
}

/**
 * Rules configuration in .chaperone.json
 */
export interface RulesConfig {
  typescript?: ToolConfig;
  eslint?: ToolConfig;
  prettier?: ToolConfig;
  custom?: CustomRule[];
}

/**
 * Project detection info (from init command)
 */
export interface ProjectConfig {
  typescript?: {
    detected: boolean;
    configPath?: string;
    settings?: Record<string, unknown>;
  };
  eslint?: {
    detected: boolean;
    configPath?: string;
    configFormat?: string;
  };
  prettier?: {
    detected: boolean;
    configPath?: string;
  };
  packageManager?: {
    name: string;
    lockfile?: string;
  };
}

/**
 * Full chaperone configuration
 */
export interface ChaperoneConfig {
  version: string;
  extends?: string[]; // Preset specifiers (e.g., "chaperone/react-layered", "./local-preset.json")
  project?: ProjectConfig;
  rules?: RulesConfig;
  include?: string[];
  exclude?: string[];
  integrations?: {
    respectEslintIgnore?: boolean;
    respectPrettierIgnore?: boolean;
    useTypescriptPaths?: boolean;
  };
  aiInstructions?: AIInstructionsConfig;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ChaperoneConfig = {
  version: "1.0.0",
  rules: {
    typescript: { enabled: true },
    eslint: { enabled: true, extensions: [".ts", ".tsx", ".js", ".jsx"] },
    prettier: { enabled: true },
    custom: [],
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", "build", ".git"],
  aiInstructions: {
    autoDetect: true,
    files: [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "CODEX.md",
      ".cursorrules",
      ".cursor/rules/*.mdc",
      ".github/copilot-instructions.md",
      ".instructions.md",
    ],
    extractRules: true,
  },
};

/**
 * AI instruction file info
 */
export interface AIInstructionFile {
  path: string;
  name: string;
  tool: string; // e.g., "Claude Code", "GitHub Copilot", etc.
  content: string;
}
