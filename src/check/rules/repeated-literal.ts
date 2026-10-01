import { compileGlob } from "../../utils/glob";
import { createLineIndex, matchesEmptyString, truncate, type LineIndex } from "../../utils/text";
import type { CheckResult, RepeatedLiteralRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { findingMessage } from "./utils/findings";
import { findLiterals, literalKey, normalizeLiteral } from "./utils/literals";
import { getRuleContext } from "./utils/rule-context";

export const REPEATED_LITERAL_DEFAULTS = { minTokens: 1, maxOccurrences: 2 } as const;

interface Place {
  file: string;
  offset: number;
}

interface Group {
  /** The literal as first seen, normalized */
  literal: string;
  places: Place[];
}

function invalid(rule: RepeatedLiteralRule, field: string, pattern: string, error: unknown): RuleResult {
  return {
    ruleId: rule.id,
    results: [
      {
        file: ".chaperone.json",
        rule: `repeated-literal/${rule.id}`,
        message: `Invalid ${field} /${pattern}/: ${error instanceof Error ? error.message : String(error)}`,
        severity: "error",
        source: "custom",
      },
    ],
  };
}

/**
 * Run a repeated-literal rule: a string literal (normalized) that matches the rule's filters
 * may appear at most `maxOccurrences` times across the matched files. Each literal over the
 * limit is reported once, with every place it appears.
 */
export async function runRepeatedLiteralRule(
  rule: RepeatedLiteralRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const context = getRuleContext(options);
  const { index } = context;
  const files = index.glob(rule.files, rule.exclude ?? []);
  const minTokens = rule.minTokens ?? REPEATED_LITERAL_DEFAULTS.minTokens;
  const maxOccurrences = rule.maxOccurrences ?? REPEATED_LITERAL_DEFAULTS.maxOccurrences;
  const ignoreOrder = rule.ignoreOrder ?? false;
  const ruleName = `repeated-literal/${rule.id}`;

  // Validated at load time; guard programmatic callers
  let literalPattern: RegExp | undefined;
  let contextPattern: RegExp | undefined;
  try {
    literalPattern = rule.literalPattern === undefined ? undefined : new RegExp(`^(?:${rule.literalPattern})$`);
  } catch (error) {
    return invalid(rule, "literalPattern", rule.literalPattern ?? "", error);
  }
  try {
    contextPattern = rule.contextPattern === undefined ? undefined : new RegExp(rule.contextPattern, "mg");
  } catch (error) {
    return invalid(rule, "contextPattern", rule.contextPattern ?? "", error);
  }
  const includeEmptyContextMatches = contextPattern ? !matchesEmptyString(contextPattern) : true;
  const contextFiles = (rule.contextFiles ?? []).map((pattern) => compileGlob(pattern));

  const groups = new Map<string, Group>();
  let contextMatches = 0;
  let contextFileCount = 0;

  for (const file of files) {
    const content = index.read(file);
    if (content === null) continue;

    const wholeFile = contextFiles.some((matches) => matches(file));
    if (wholeFile) contextFileCount++;
    const scan = findLiterals(content, {
      path: file,
      context: wholeFile ? undefined : contextPattern,
      includeEmptyContextMatches,
    });
    contextMatches += scan.contextMatches;

    for (const { value, offset } of scan.literals) {
      const literal = normalizeLiteral(value);
      const { key, tokens } = literalKey(literal, ignoreOrder);
      if (tokens < minTokens) continue;
      if (literalPattern && !literalPattern.test(literal)) continue;

      const group = groups.get(key);
      if (group) group.places.push({ file, offset });
      else groups.set(key, { literal, places: [{ file, offset }] });
    }
  }

  const allowed = new Map<string, number>();
  const used = new Set<number>();
  (rule.allow ?? []).forEach((entry, position) => {
    const { key } = literalKey(normalizeLiteral(entry.literal), ignoreOrder);
    if (!allowed.has(key)) allowed.set(key, position);
  });

  const lineIndexes = new Map<string, LineIndex>();
  const where = ({ file, offset }: Place) => {
    let lines = lineIndexes.get(file);
    if (!lines) {
      lines = createLineIndex(index.read(file) ?? "");
      lineIndexes.set(file, lines);
    }
    return { file, line: lines.lineAt(offset), column: lines.columnAt(offset) };
  };

  // Under --since, report a repeat when one of its copies is in a changed file
  const inScope = new Set(context.inScope(files));
  const repeats = [...groups.entries()]
    .filter(([key, group]) => {
      if (group.places.length <= maxOccurrences) return false;
      const allowedAt = allowed.get(key);
      if (allowedAt === undefined) return true;
      used.add(allowedAt);
      return false;
    })
    .map(([, group]) => group)
    .filter((group) => group.places.some((place) => inScope.has(place.file)))
    .sort(
      (a, b) =>
        b.places.length - a.places.length || (a.literal < b.literal ? -1 : a.literal > b.literal ? 1 : 0)
    );

  const results: CheckResult[] = repeats.map((group) => {
    const places = group.places.map(where);
    const first = places[0]!;
    const shown = truncate(group.literal, 120);
    return {
      file: first.file,
      line: first.line,
      column: first.column,
      rule: ruleName,
      message: findingMessage(rule.message, `"${shown}" appears ${places.length} times, at most ${maxOccurrences} allowed`),
      severity: rule.severity,
      source: "custom",
      suggestion:
        "Extract it into one shared place (a constant, a component or a variant of one), or add it to the rule's allow list with a reason.",
      context: {
        matchedText: truncate(group.literal),
        expectedValue: `at most ${maxOccurrences} occurrences`,
        actualValue: `${places.length} occurrences`,
        locations: places.map((place) => `${place.file}:${place.line}:${place.column}`),
      },
    };
  });

  // An allow entry that excuses nothing is reported, so the list cannot outlive its reasons
  (rule.allow ?? []).forEach((entry, position) => {
    if (used.has(position)) return;
    const { key } = literalKey(normalizeLiteral(entry.literal), ignoreOrder);
    if (allowed.get(key) !== position) return; // a duplicate entry: validation warns about it
    const count = groups.get(key)?.places.length ?? 0;
    results.push({
      file: ".chaperone.json",
      rule: ruleName,
      message: `allow entry "${truncate(normalizeLiteral(entry.literal), 120)}" no longer excuses anything: it is counted ${count} time(s), within the limit of ${maxOccurrences}. Remove it from the allow list.`,
      severity: rule.severity,
      source: "custom",
      context: { expectedValue: `more than ${maxOccurrences} occurrences`, actualValue: `${count}` },
    });
  });

  const notices: string[] = [];
  if (contextPattern && files.length > contextFileCount && contextMatches === 0) {
    notices.push(
      `"contextPattern" /${rule.contextPattern}/ matched nowhere in ${files.length - contextFileCount} file(s), so no literal there was counted`
    );
  }

  return { ruleId: rule.id, results, filesChecked: files.length, notices };
}

/**
 * Check if a rule is a RepeatedLiteralRule
 */
export function isRepeatedLiteralRule(rule: unknown): rule is RepeatedLiteralRule {
  return typeof rule === "object" && rule !== null && (rule as RepeatedLiteralRule).type === "repeated-literal";
}
