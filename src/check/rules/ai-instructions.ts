import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { globSync } from "../../utils/glob";
import type { AIInstructionFile, AIInstructionsConfig, RegexRule } from "../types";

/**
 * AI instruction file metadata
 */
const AI_INSTRUCTION_FILES: Record<string, { tool: string; priority: number }> = {
  "AGENTS.md": { tool: "Universal (OpenAI Codex, Copilot, Cursor, Jules)", priority: 1 },
  "CLAUDE.md": { tool: "Claude Code", priority: 2 },
  "GEMINI.md": { tool: "Gemini CLI", priority: 3 },
  "CODEX.md": { tool: "OpenAI Codex", priority: 4 },
  ".cursorrules": { tool: "Cursor (legacy)", priority: 5 },
  ".github/copilot-instructions.md": { tool: "GitHub Copilot", priority: 6 },
  ".instructions.md": { tool: "GitHub Copilot Agent", priority: 7 },
};

/**
 * Word pattern that matches words with optional slashes, hyphens, and dots
 */
const WORD_PATTERN = "[\\w/.-]+(?:\\s+[\\w/.-]+)*?";

/**
 * Patterns for extracting rules from natural language
 */
const EXTRACTION_PATTERNS = [
  // "Do not use X" / "Never use X" / "Don't use X"
  {
    pattern: new RegExp(
      `(?:do\\s+not|don['']t|never)\\s+use\\s+(?:the\\s+)?(${WORD_PATTERN})(?:\\s+(?:props?|classes?|attributes?))?\\s*[.,]`,
      "gi"
    ),
    extract: (match: RegExpExecArray) => ({
      type: "forbid" as const,
      subject: match[1].trim(),
    }),
  },
  // "Use X instead of Y"
  {
    pattern: new RegExp(
      `use\\s+(${WORD_PATTERN})\\s+instead\\s+of\\s+(${WORD_PATTERN})(?:\\s+(?:props?|classes?))?\\s*[.,]`,
      "gi"
    ),
    extract: (match: RegExpExecArray) => ({
      type: "prefer" as const,
      preferred: match[1].trim(),
      forbidden: match[2].trim(),
    }),
  },
  // "Always use X" / "Must use X"
  {
    pattern: new RegExp(
      `(?:always|must)\\s+use\\s+(?:the\\s+)?(${WORD_PATTERN})(?:\\s+for|\\s+when|\\s*[.,])`,
      "gi"
    ),
    extract: (match: RegExpExecArray) => ({
      type: "require" as const,
      subject: match[1].trim(),
    }),
  },
  // Code blocks with ❌ bad → ✅ good pattern
  {
    pattern: /[❌✗]\s*`([^`]+)`\s*[→→]\s*[✅✓]\s*`([^`]+)`/g,
    extract: (match: RegExpExecArray) => ({
      type: "prefer" as const,
      forbidden: match[1].trim(),
      preferred: match[2].trim(),
    }),
  },
  // "className" specific pattern (common in React Native)
  {
    pattern:
      /className\s*(?:props?|attributes?)?\s*(?:are|is)?\s*(?:not\s+(?:allowed|supported)|forbidden)/gi,
    extract: () => ({
      type: "forbid" as const,
      subject: "className",
    }),
  },
];

/**
 * Known patterns that can be converted to regex rules
 */
const SUBJECT_TO_REGEX: Record<string, { pattern: string; files: string }> = {
  classname: { pattern: "className\\s*=", files: "src/**/*.tsx" },
  "classname props": { pattern: "className\\s*=", files: "src/**/*.tsx" },
  nativewind: { pattern: "className\\s*=", files: "src/**/*.tsx" },
  tailwind: { pattern: "className\\s*=", files: "src/**/*.tsx" },
  "tailwind classname": { pattern: "className\\s*=", files: "src/**/*.tsx" },
  "nativewind/tailwind classname props": { pattern: "className\\s*=", files: "src/**/*.tsx" },
  "nativewind/tailwind classname": { pattern: "className\\s*=", files: "src/**/*.tsx" },
};

/**
 * Extract enforceable rules from AI instruction content
 */
function extractRules(
  file: AIInstructionFile,
  lineContent: string,
  lineNumber: number
): RegexRule[] {
  const rules: RegexRule[] = [];

  for (const { pattern, extract } of EXTRACTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(lineContent)) !== null) {
      const extracted = extract(match);

      if (extracted.type === "forbid") {
        const subject = extracted.subject.toLowerCase();
        const regexInfo = SUBJECT_TO_REGEX[subject];

        if (regexInfo) {
          rules.push({
            type: "regex",
            id: `ai-${file.name}-${lineNumber}-forbid-${subject.replace(/\s+/g, "-")}`,
            source: file.path,
            pattern: regexInfo.pattern,
            files: regexInfo.files,
            message: `AI instruction from ${file.name}: "${lineContent.trim()}"`,
            mustMatch: false,
            severity: "error",
            originalText: lineContent.trim(),
          });
        }
      } else if (extracted.type === "prefer") {
        const forbidden = extracted.forbidden.toLowerCase();
        const regexInfo = SUBJECT_TO_REGEX[forbidden];

        if (regexInfo) {
          rules.push({
            type: "regex",
            id: `ai-${file.name}-${lineNumber}-prefer-${forbidden.replace(/\s+/g, "-")}`,
            source: file.path,
            pattern: regexInfo.pattern,
            files: regexInfo.files,
            message: `AI instruction from ${file.name}: Use ${extracted.preferred} instead of ${extracted.forbidden}`,
            mustMatch: false,
            severity: "error",
            originalText: lineContent.trim(),
          });
        }
      }
    }
  }

  return rules;
}

/**
 * Detect and load AI instruction files
 */
export function detectAIInstructionFiles(
  cwd: string,
  config?: AIInstructionsConfig
): AIInstructionFile[] {
  const files: AIInstructionFile[] = [];
  const patterns = config?.files ?? Object.keys(AI_INSTRUCTION_FILES);

  for (const pattern of patterns) {
    // Handle glob patterns
    if (pattern.includes("*")) {
      const matches = globSync(pattern, { cwd });
      for (const match of matches) {
        const fullPath = join(cwd, match);
        const name = basename(match);
        const tool = AI_INSTRUCTION_FILES[name]?.tool ?? "Unknown";

        try {
          const content = readFileSync(fullPath, "utf-8");
          files.push({ path: match, name, tool, content });
        } catch {
          // Skip files that can't be read
        }
      }
    } else {
      const fullPath = join(cwd, pattern);
      if (existsSync(fullPath)) {
        const name = basename(pattern);
        const meta = AI_INSTRUCTION_FILES[pattern] ?? AI_INSTRUCTION_FILES[name];
        const tool = meta?.tool ?? "Unknown";

        try {
          const content = readFileSync(fullPath, "utf-8");
          files.push({ path: pattern, name, tool, content });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  return files;
}

/**
 * Parse AI instruction files and extract enforceable rules (legacy auto-extraction)
 *
 * Note: For better rule extraction, use the `chaperone analyze` command which
 * uses Claude to intelligently extract rules from AI instruction files.
 */
export function parseAIInstructions(files: AIInstructionFile[]): RegexRule[] {
  const rules: RegexRule[] = [];

  for (const file of files) {
    const lines = file.content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip empty lines and headers
      if (!line || !line.trim() || line.startsWith("#")) {
        continue;
      }

      const lineRules = extractRules(file, line, i + 1);
      rules.push(...lineRules);
    }
  }

  // Deduplicate rules by pattern
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = `${rule.pattern}:${rule.files}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Check if a rule was AI-generated (has source metadata)
 */
export function isAIGeneratedRule(rule: unknown): boolean {
  return (
    typeof rule === "object" &&
    rule !== null &&
    typeof (rule as RegexRule).source === "string"
  );
}
