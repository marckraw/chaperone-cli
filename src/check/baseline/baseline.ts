/**
 * Baselines: the violations a project already had when it adopted a rule, recorded so the check
 * fails only on new ones. Pure: reading and writing the file lives in ./file.ts.
 *
 * An entry is a rule id, a file and a fingerprint: a hash of the offending text (the regex match
 * and the source line the result points at) and the message, normalised. Line numbers are never
 * part of it, so a violation that moves stays baselined; one whose line is edited does not.
 * Identical violations in one file share an entry with a count.
 *
 * Rule-level errors (see ../rule-error) are never baselined: they are the rule failing to check.
 */

import { createHash } from "node:crypto";
import { isRuleError } from "../rule-error";
import type { CheckResult, RunnerSummary } from "../types";

export const BASELINE_FILENAME = ".chaperone-baseline.json";
export const BASELINE_VERSION = 1;

export interface BaselineEntry {
  rule: string;
  file: string;
  fingerprint: string;
  /** How many identical violations the entry stands for (omitted when 1) */
  count?: number;
  /** For people reading the file; matching ignores it */
  message: string;
}

export interface Baseline {
  version: typeof BASELINE_VERSION;
  entries: BaselineEntry[];
}

/**
 * The baseline file is not valid. Maps to exit code 2.
 */
export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaselineError";
  }
}

export interface FingerprintedResult {
  result: CheckResult;
  fingerprint: string;
}

/**
 * Whitespace collapsed, so re-indenting a line keeps its fingerprint.
 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whitespace collapsed and line references replaced ("at line 12", "lines 3-10", "src/a.ts:4:2"),
 * so the message survives the violation moving. Every other number is kept: a count that changes
 * ("has 312 lines", "4 components") makes the violation new, whether it got worse or better.
 */
export function normalizeMessage(message: string): string {
  return normalizeText(message)
    .replace(/\b(lines?)\s+\d+(?:\s*[-–]\s*\d+)?/gi, "$1 #")
    .replace(/(\S):\d+(?::\d+)?(?:-\d+)?\b/g, "$1:#");
}

/**
 * The fingerprint of one result: its regex match, the source line it points at (`lineText`, when
 * it has one) and its message. The line matters with the match: two `console.log` calls in a file
 * match the same text, and replacing one must not pass as the other.
 */
export function fingerprintResult(result: CheckResult, lineText?: string): string {
  const parts = [result.context?.matchedText ?? "", lineText ?? "", result.message];
  return createHash("sha256")
    .update([normalizeText(parts[0]!), normalizeText(parts[1]!), normalizeMessage(parts[2]!)].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Fingerprint every result, reading the line each one points at through `readFile` (a path
 * relative to the project root; null when it cannot be read).
 */
export function fingerprintResults(
  results: readonly CheckResult[],
  readFile: (path: string) => string | null
): FingerprintedResult[] {
  const lines = new Map<string, string[] | null>();
  const linesOf = (file: string): string[] | null => {
    if (!lines.has(file)) {
      const content = readFile(file);
      lines.set(file, content === null ? null : content.split(/\r?\n/));
    }
    return lines.get(file)!;
  };

  return results.map((result) => {
    const lineText = result.file && result.line ? linesOf(result.file)?.[result.line - 1] : undefined;
    return { result, fingerprint: fingerprintResult(result, lineText) };
  });
}

function entryKey(entry: Pick<BaselineEntry, "rule" | "file" | "fingerprint">): string {
  return `${entry.rule}\u0000${entry.file}\u0000${entry.fingerprint}`;
}

function countOf(entry: BaselineEntry): number {
  return entry.count ?? 1;
}

function withCount(entry: BaselineEntry, count: number): BaselineEntry {
  const { count: _previous, ...rest } = entry;
  return count === 1 ? rest : { ...rest, count };
}

export interface BaselineMatch {
  /** Results the baseline does not cover: these count, and fail the check */
  fresh: CheckResult[];
  /** Results the baseline covers: reported apart, never counted */
  baselined: CheckResult[];
  /** Entries (or the part of an entry's count) that no longer occur: the baseline can shrink */
  stale: BaselineEntry[];
  /** Entries that did not occur, but whose rule or file was not checked this run */
  unverified: BaselineEntry[];
}

/**
 * Split `results` into fresh and baselined ones, and find the entries that no longer occur.
 * When a file has more identical violations than its entry's count, the first ones (by line)
 * are baselined and the rest are fresh. `isVerifiable` says whether an entry's absence means
 * it was fixed (false: its tool did not run, or its file was outside `--since`). Rule-level errors
 * are always fresh, and while a rule reports one its entries are unverified.
 */
export function matchBaseline(
  fingerprinted: readonly FingerprintedResult[],
  entries: readonly BaselineEntry[],
  isVerifiable: (entry: BaselineEntry) => boolean = () => true
): BaselineMatch {
  const brokenRules = new Set(fingerprinted.filter(({ result }) => isRuleError(result)).map(({ result }) => result.rule));
  const verifiable = (entry: BaselineEntry) => !brokenRules.has(entry.rule) && isVerifiable(entry);

  const remaining = new Map<string, number>();
  for (const entry of entries) {
    const key = entryKey(entry);
    remaining.set(key, (remaining.get(key) ?? 0) + countOf(entry));
  }

  const ordered = [...fingerprinted].sort(
    (a, b) => (a.result.line ?? 0) - (b.result.line ?? 0) || (a.result.column ?? 0) - (b.result.column ?? 0)
  );
  const baselinedSet = new Set<CheckResult>();
  for (const { result, fingerprint } of ordered) {
    if (isRuleError(result)) continue;
    const key = entryKey({ rule: result.rule, file: result.file, fingerprint });
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      baselinedSet.add(result);
    }
  }

  const stale: BaselineEntry[] = [];
  const unverified: BaselineEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const left = remaining.get(key) ?? 0;
    if (left === 0) continue;
    (verifiable(entry) ? stale : unverified).push(withCount(entry, left));
  }

  // Keep the results in their original order
  const fresh = fingerprinted.filter(({ result }) => !baselinedSet.has(result)).map(({ result }) => result);
  const baselined = fingerprinted.filter(({ result }) => baselinedSet.has(result)).map(({ result }) => result);
  return { fresh, baselined, stale, unverified };
}

/**
 * One entry per distinct violation, counting identical ones. Rule-level errors are left out.
 */
export function entriesFor(fingerprinted: readonly FingerprintedResult[]): BaselineEntry[] {
  const byKey = new Map<string, BaselineEntry>();
  for (const { result, fingerprint } of fingerprinted) {
    if (isRuleError(result)) continue;
    const entry: BaselineEntry = { rule: result.rule, file: result.file, fingerprint, message: result.message };
    const key = entryKey(entry);
    const existing = byKey.get(key);
    byKey.set(key, existing ? withCount(existing, countOf(existing) + 1) : entry);
  }
  return sortEntries([...byKey.values()]);
}

/**
 * Merge entries with the same key, adding up their counts.
 */
function mergeEntries(entries: readonly BaselineEntry[]): BaselineEntry[] {
  const byKey = new Map<string, BaselineEntry>();
  for (const entry of entries) {
    const key = entryKey(entry);
    const existing = byKey.get(key);
    byKey.set(key, existing ? withCount(existing, countOf(existing) + countOf(entry)) : entry);
  }
  return sortEntries([...byKey.values()]);
}

export function sortEntries(entries: BaselineEntry[]): BaselineEntry[] {
  return entries.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.fingerprint.localeCompare(b.fingerprint)
  );
}

export interface BaselineUpdate {
  baseline: Baseline;
  /** True when there was no baseline before: every current violation was recorded */
  created: boolean;
  /** Entries removed because they no longer occur */
  removed: BaselineEntry[];
  /** Entries added (only with allowGrowth, or when the baseline is created) */
  added: BaselineEntry[];
  /** Fresh violations that were not added, because the baseline only shrinks */
  refused: BaselineEntry[];
  /** Entries kept although they did not occur, because their rule or file was not checked */
  unverified: BaselineEntry[];
  /** Results the updated baseline does not cover */
  fresh: CheckResult[];
  /** Whether the file's content changes */
  changed: boolean;
}

/**
 * The next baseline. With no previous one, every current violation is recorded. Otherwise the
 * entries that no longer occur are removed and nothing is added, unless `allowGrowth`.
 */
export function updateBaseline(
  previous: Baseline | null,
  fingerprinted: readonly FingerprintedResult[],
  options: { allowGrowth?: boolean; isVerifiable?: (entry: BaselineEntry) => boolean } = {}
): BaselineUpdate {
  if (previous === null) {
    const entries = entriesFor(fingerprinted);
    return {
      baseline: { version: BASELINE_VERSION, entries },
      created: true,
      removed: [],
      added: entries,
      refused: [],
      unverified: [],
      fresh: [],
      changed: true,
    };
  }

  const match = matchBaseline(fingerprinted, previous.entries, options.isVerifiable);
  const staleCounts = new Map(match.stale.map((entry) => [entryKey(entry), countOf(entry)]));
  const kept: BaselineEntry[] = [];
  for (const entry of mergeEntries(previous.entries)) {
    const count = countOf(entry) - (staleCounts.get(entryKey(entry)) ?? 0);
    if (count > 0) kept.push(withCount(entry, count));
  }

  const fresh = new Set(match.fresh);
  const growth = entriesFor(fingerprinted.filter(({ result }) => fresh.has(result)));
  const entries = options.allowGrowth ? mergeEntries([...kept, ...growth]) : kept;
  const baseline: Baseline = { version: BASELINE_VERSION, entries };
  return {
    baseline,
    created: false,
    removed: match.stale,
    added: options.allowGrowth ? growth : [],
    refused: options.allowGrowth ? [] : growth,
    unverified: match.unverified,
    fresh: options.allowGrowth ? [] : match.fresh,
    changed: serializeBaseline(baseline) !== serializeBaseline(previous),
  };
}

/**
 * The file's content: sorted entries, so it diffs well in review.
 */
export function serializeBaseline(baseline: Baseline): string {
  const entries = sortEntries(baseline.entries.map((entry) => withCount(entry, countOf(entry))));
  return `${JSON.stringify({ version: baseline.version, entries }, null, 2)}\n`;
}

/**
 * Parse the file's content.
 *
 * @throws {BaselineError} when it is not a valid baseline
 */
export function parseBaseline(text: string, source = BASELINE_FILENAME): Baseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new BaselineError(`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new BaselineError(`${source} must be an object with "version" and "entries"`);
  }
  const { version, entries } = data as { version?: unknown; entries?: unknown };
  if (version !== BASELINE_VERSION) {
    throw new BaselineError(`${source} has version ${JSON.stringify(version)}; this Chaperone reads version ${BASELINE_VERSION}`);
  }
  if (!Array.isArray(entries)) {
    throw new BaselineError(`${source} must have an "entries" array`);
  }
  return {
    version: BASELINE_VERSION,
    entries: entries.map((entry, index) => parseEntry(entry, `${source} › entries[${index}]`)),
  };
}

function parseEntry(value: unknown, where: string): BaselineEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BaselineError(`${where} must be an object`);
  }
  const entry = value as Record<string, unknown>;
  for (const field of ["rule", "file", "fingerprint"] as const) {
    if (typeof entry[field] !== "string") {
      throw new BaselineError(`${where} needs a string "${field}"`);
    }
  }
  const count = entry["count"];
  if (count !== undefined && !(typeof count === "number" && Number.isInteger(count) && count >= 1)) {
    throw new BaselineError(`${where} has "count" ${JSON.stringify(count)}; it must be a whole number of at least 1`);
  }
  const parsed: BaselineEntry = {
    rule: entry["rule"] as string,
    file: entry["file"] as string,
    fingerprint: entry["fingerprint"] as string,
    message: typeof entry["message"] === "string" ? entry["message"] : "",
  };
  return count === undefined || count === 1 ? parsed : { ...parsed, count: count as number };
}

/**
 * Whether an entry's absence from a run means it was fixed. Not when its tool was skipped or
 * could not run, not when its file (or a directory above it) could not be read, and not, with
 * `--since`, for a custom rule's entry in a file that was not checked (the tools still check the
 * whole project).
 */
export function verifiableIn(run: {
  runners?: readonly RunnerSummary[];
  changedFiles?: ReadonlySet<string>;
  /** Files, and directories ending in "/", that could not be read */
  unreadable?: readonly string[];
}): (entry: BaselineEntry) => boolean {
  const unreadable = run.unreadable ?? [];
  const runners = run.runners ?? [];
  const tools = new Set(runners.map((runner) => runner.name));
  const notRun = new Set(
    runners.filter((runner) => runner.status === "skipped" || runner.status === "error").map((runner) => runner.name)
  );
  return (entry) => {
    const source = entry.rule.split("/")[0] ?? "";
    if (notRun.has(source)) return false;
    if (unreadable.some((path) => (path.endsWith("/") ? entry.file.startsWith(path) : entry.file === path))) return false;
    if (run.changedFiles && entry.file && !tools.has(source) && !run.changedFiles.has(entry.file)) return false;
    return true;
  };
}

/**
 * "rule  file  message (×2)", one line for listings.
 */
export function describeEntry(entry: BaselineEntry): string {
  const count = countOf(entry) > 1 ? ` (×${countOf(entry)})` : "";
  return `${entry.rule}  ${entry.file || "(project)"}  ${entry.message}${count}`;
}

/**
 * Total violations a list of entries stands for.
 */
export function totalCount(entries: readonly BaselineEntry[]): number {
  return entries.reduce((sum, entry) => sum + countOf(entry), 0);
}
