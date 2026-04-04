import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, ReactComponentCountRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

interface ReactComponentCandidate {
  name: string;
  line: number;
}

const NAMED_FUNCTION_COMPONENT_REGEX =
  /^(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9]*)\s*\(/gm;
const ANONYMOUS_DEFAULT_FUNCTION_COMPONENT_REGEX =
  /^export\s+default\s+(?:async\s+)?function\s*\(/gm;
const NAMED_CLASS_COMPONENT_REGEX =
  /^(?:export\s+default\s+|export\s+)?class\s+([A-Z][A-Za-z0-9]*)\s+extends\s+(?:React\.)?(?:PureComponent|Component)\b/gm;
const ANONYMOUS_DEFAULT_CLASS_COMPONENT_REGEX =
  /^export\s+default\s+class\s+extends\s+(?:React\.)?(?:PureComponent|Component)\b/gm;
const VARIABLE_COMPONENT_REGEX =
  /^(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9]*)\b/gm;

function getLineNumber(content: string, index: number): number {
  let line = 1;

  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") {
      line += 1;
    }
  }

  return line;
}

function isEscaped(content: string, index: number): boolean {
  let backslashCount = 0;

  for (let i = index - 1; i >= 0 && content[i] === "\\"; i--) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function findMatchingBrace(content: string, openBraceIndex: number): number | null {
  let braceDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openBraceIndex; index < content.length; index++) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (character === "'" && !isEscaped(content, index)) {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (character === "\"" && !isEscaped(content, index)) {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateString) {
      if (character === "`" && !isEscaped(content, index)) {
        inTemplateString = false;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === "'") {
      inSingleQuote = true;
      continue;
    }

    if (character === "\"") {
      inDoubleQuote = true;
      continue;
    }

    if (character === "`") {
      inTemplateString = true;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        return index;
      }
    }
  }

  return null;
}

function extractDeclarationBlock(content: string, startIndex: number): string | null {
  const openBraceIndex = content.indexOf("{", startIndex);
  if (openBraceIndex === -1) {
    return null;
  }

  const closeBraceIndex = findMatchingBrace(content, openBraceIndex);
  if (closeBraceIndex === null) {
    return null;
  }

  return content.slice(startIndex, closeBraceIndex + 1);
}

function extractVariableStatement(content: string, startIndex: number): string {
  let braceDepth = 0;
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = startIndex; index < content.length; index++) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (character === "'" && !isEscaped(content, index)) {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (character === "\"" && !isEscaped(content, index)) {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateString) {
      if (character === "`" && !isEscaped(content, index)) {
        inTemplateString = false;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (character === "'") {
      inSingleQuote = true;
      continue;
    }

    if (character === "\"") {
      inDoubleQuote = true;
      continue;
    }

    if (character === "`") {
      inTemplateString = true;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenthesisDepth += 1;
      continue;
    }

    if (character === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }

    if (character === "[") {
      bracketDepth += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (
      character === ";"
      && braceDepth === 0
      && parenthesisDepth === 0
      && bracketDepth === 0
    ) {
      return content.slice(startIndex, index + 1);
    }
  }

  return content.slice(startIndex);
}

function hasReactRenderMarker(source: string): boolean {
  return (
    /return\s*\(?\s*(?:<|React\.createElement\s*\()/s.test(source)
    || /=>\s*\(?\s*(?:<|React\.createElement\s*\()/s.test(source)
    || /<\s*(?:[A-Z][A-Za-z0-9]*|[a-z][A-Za-z0-9-]*|>)/.test(source)
  );
}

function isVariableComponentStatement(statement: string): boolean {
  const isFunctionLikeAssignment =
    /=\s*(?:async\s*)?(?:function\b|\([^=]*?\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/s.test(
      statement
    )
    || /=\s*(?:React\.)?(?:memo|forwardRef)\s*(?:<[^()]*>)?\s*\(/s.test(statement);

  if (!isFunctionLikeAssignment) {
    return false;
  }

  return hasReactRenderMarker(statement);
}

function collectFunctionAndClassComponents(
  content: string,
  regex: RegExp,
  nameResolver: (match: RegExpExecArray) => string | null
): ReactComponentCandidate[] {
  const candidates: ReactComponentCandidate[] = [];
  let match: RegExpExecArray | null = null;
  regex.lastIndex = 0;

  while ((match = regex.exec(content)) !== null) {
    const name = nameResolver(match);
    if (!name) {
      continue;
    }

    const declaration = extractDeclarationBlock(content, match.index);
    if (!declaration || !hasReactRenderMarker(declaration)) {
      continue;
    }

    candidates.push({
      name,
      line: getLineNumber(content, match.index),
    });
  }

  return candidates;
}

function collectVariableComponents(content: string): ReactComponentCandidate[] {
  const candidates: ReactComponentCandidate[] = [];
  let match: RegExpExecArray | null = null;
  VARIABLE_COMPONENT_REGEX.lastIndex = 0;

  while ((match = VARIABLE_COMPONENT_REGEX.exec(content)) !== null) {
    const name = match[1];
    if (!name) {
      continue;
    }

    const statement = extractVariableStatement(content, match.index);
    if (!isVariableComponentStatement(statement)) {
      continue;
    }

    candidates.push({
      name,
      line: getLineNumber(content, match.index),
    });
  }

  return candidates;
}

function collectReactComponents(content: string): ReactComponentCandidate[] {
  const uniqueByName = new Map<string, ReactComponentCandidate>();
  const candidates = [
    ...collectFunctionAndClassComponents(
      content,
      NAMED_FUNCTION_COMPONENT_REGEX,
      (match) => match[1] ?? null
    ),
    ...collectFunctionAndClassComponents(
      content,
      ANONYMOUS_DEFAULT_FUNCTION_COMPONENT_REGEX,
      () => "default export"
    ),
    ...collectFunctionAndClassComponents(
      content,
      NAMED_CLASS_COMPONENT_REGEX,
      (match) => match[1] ?? null
    ),
    ...collectFunctionAndClassComponents(
      content,
      ANONYMOUS_DEFAULT_CLASS_COMPONENT_REGEX,
      () => "default export"
    ),
    ...collectVariableComponents(content),
  ];

  for (const candidate of candidates) {
    if (!uniqueByName.has(candidate.name)) {
      uniqueByName.set(candidate.name, candidate);
    }
  }

  return Array.from(uniqueByName.values()).sort((left, right) => left.line - right.line);
}

/**
 * Run react-component-count rule to limit how many React components live in a file.
 */
export async function runReactComponentCountRule(
  rule: ReactComponentCountRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const results: CheckResult[] = [];
  const maxComponents = rule.maxComponents ?? 1;
  const ignoreNames = new Set(rule.ignoreNames ?? []);

  if (maxComponents < 1) {
    return {
      ruleId: rule.id,
      results: [
        {
          file: ".chaperone.json",
          rule: `react-component-count/${rule.id}`,
          message: `react-component-count rule '${rule.id}' must set maxComponents to at least 1`,
          severity: "error",
          source: "custom",
        },
      ],
    };
  }

  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content = "";
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const components = collectReactComponents(content).filter(
      (candidate) => !ignoreNames.has(candidate.name)
    );

    if (components.length <= maxComponents) {
      continue;
    }

    const componentNames = components.map((candidate) => candidate.name);
    const firstExtraComponent = components[maxComponents] ?? components[components.length - 1];

    results.push({
      file,
      line: firstExtraComponent?.line,
      rule: `react-component-count/${rule.id}`,
      message:
        rule.message
        || `File defines ${components.length} React components (${componentNames.join(", ")}), maximum allowed is ${maxComponents}`,
      severity: rule.severity,
      source: "custom",
      suggestion: `Move ${componentNames.slice(maxComponents).join(", ")} into separate files`,
      context: {
        expectedValue: `<= ${maxComponents} React component`,
        actualValue: `${components.length}: ${componentNames.join(", ")}`,
        detectedPatterns: componentNames,
      },
    });
  }

  return {
    ruleId: rule.id,
    results,
  };
}

/**
 * Check if a rule is a ReactComponentCountRule.
 */
export function isReactComponentCountRule(
  rule: unknown
): rule is ReactComponentCountRule {
  return (
    typeof rule === "object"
    && rule !== null
    && (rule as ReactComponentCountRule).type === "react-component-count"
  );
}
