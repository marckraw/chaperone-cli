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
 * Union of all custom rule types
 */
export type CustomRule = FileNamingRule | RegexRule | PackageFieldsRule | ComponentLocationRule;

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
