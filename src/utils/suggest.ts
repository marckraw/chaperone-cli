/**
 * "Did you mean …?" suggestions for misspelled names.
 */

/**
 * Levenshtein edit distance between two strings.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * The closest candidate to `input`, or null when nothing is close enough.
 * Case differences are ignored when comparing ("mustmatch" suggests "mustMatch").
 */
export function closestMatch(input: string, candidates: readonly string[]): string | null {
  const needle = input.toLowerCase();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const hay = candidate.toLowerCase();
    let distance = editDistance(needle, hay);
    if (distance > 0 && (hay.startsWith(needle) || needle.startsWith(hay))) {
      distance = Math.min(distance, 1);
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  const threshold = Math.max(2, Math.floor(needle.length / 3));
  return best !== null && bestDistance <= threshold ? best : null;
}

/**
 * Format a suggestion suffix: ` (did you mean "x"?)` or "".
 */
export function didYouMean(input: string, candidates: readonly string[]): string {
  const match = closestMatch(input, candidates);
  return match ? ` (did you mean "${match}"?)` : "";
}
