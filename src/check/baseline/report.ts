/**
 * What `chaperone baseline` prints. Pure.
 */

import { describeEntry, totalCount, type BaselineEntry, type BaselineUpdate } from "./baseline";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function listEntries(entries: readonly BaselineEntry[], marker: string): string[] {
  return entries.map((entry) => `  ${marker} ${describeEntry(entry)}`);
}

export interface BaselineUpdateContext {
  /** Where the previous baseline came from: the working tree, or HEAD when the file was missing */
  previousFrom?: "working-tree" | "head";
}

/**
 * Every change the update makes, entry by entry, and what it refused to do. A new baseline lists
 * every entry it records, so its first diff is not the only place they show.
 */
export function formatBaselineUpdate(update: BaselineUpdate, file: string, context: BaselineUpdateContext = {}): string {
  const lines: string[] = [];
  const entries = update.baseline.entries;
  const size = `${plural(entries.length, "entry", "entries")} (${plural(totalCount(entries), "violation", "violations")})`;

  if (update.created) {
    lines.push(`Created ${file}: ${size}.`);
    if (entries.length === 0) {
      lines.push("Nothing is baselined: every violation fails the check.");
      return lines.join("\n");
    }
    lines.push(...listEntries(entries, "+"));
    lines.push("");
    lines.push(`Commit it. "chaperone check" now fails only on violations that are not in it, and "chaperone baseline" only shrinks it.`);
    return lines.join("\n");
  }

  if (context.previousFrom === "head") {
    lines.push(`${file} is missing from the working tree: starting from the one committed at HEAD, which can only shrink.`);
    lines.push("");
  }

  if (update.removed.length > 0) {
    lines.push(`Removed ${plural(update.removed.length, "entry that no longer occurs", "entries that no longer occur")}:`);
    lines.push(...listEntries(update.removed, "-"));
    lines.push("");
  }

  if (update.added.length > 0) {
    lines.push(`Added ${plural(update.added.length, "entry", "entries")} (--allow-growth):`);
    lines.push(...listEntries(update.added, "+"));
    lines.push("");
  }

  if (update.refused.length > 0) {
    lines.push(
      `Not added: ${plural(totalCount(update.refused), "violation is", "violations are")} not in the baseline, and the baseline only shrinks:`
    );
    lines.push(...listEntries(update.refused, "!"));
    lines.push(`Fix ${totalCount(update.refused) === 1 ? "it" : "them"}, or run "chaperone baseline --allow-growth" to record ${totalCount(update.refused) === 1 ? "it" : "them"} on purpose.`);
    lines.push("");
  }

  if (update.unverified.length > 0) {
    lines.push(
      `Kept ${plural(update.unverified.length, "entry", "entries")} that could not be verified: the tool or file was not checked in this run.`
    );
    lines.push("");
  }

  if (update.changed) {
    lines.push(`Updated ${file}: ${size}.`);
  } else if (context.previousFrom === "head") {
    lines.push(`Restored ${file} from HEAD: ${size}.`);
  } else {
    lines.push(`${file} is up to date: ${size}.`);
  }
  return lines.join("\n");
}
