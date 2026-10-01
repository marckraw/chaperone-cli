/**
 * Regions of a file that rules skip, between an "ignore-start" and an "ignore-end" comment:
 *
 *   // chaperone-ignore-start: the two readers merge in MAR-123
 *   ...
 *   // chaperone-ignore-end
 *
 * Only comments count, so a marker inside a string never opens a region.
 */

import type { Comment } from "../../../utils/js-lexer";

export interface IgnoreMarkers {
  start: string;
  end: string;
}

export const CHAPERONE_IGNORE: IgnoreMarkers = { start: "chaperone-ignore-start", end: "chaperone-ignore-end" };

/** jscpd's own markers, honoured by duplicate-code so a jscpd setup moves over unchanged */
export const JSCPD_IGNORE: IgnoreMarkers = { start: "jscpd:ignore-start", end: "jscpd:ignore-end" };

/** A half-open offset range [start, end) */
export type OffsetRange = readonly [start: number, end: number];

/**
 * The ranges between start and end markers, in order. A start with no end runs to the end
 * of the file; an end with no start, and a start inside an open region, are ignored.
 */
export function ignoredRanges(
  content: string,
  comments: readonly Comment[],
  markers: readonly IgnoreMarkers[]
): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  let openedAt = -1;

  for (const comment of comments) {
    const text = content.slice(comment.start, comment.end);
    if (openedAt === -1) {
      if (markers.some((marker) => text.includes(marker.start))) openedAt = comment.end;
    } else if (markers.some((marker) => text.includes(marker.end))) {
      ranges.push([openedAt, comment.start]);
      openedAt = -1;
    }
  }
  if (openedAt !== -1) ranges.push([openedAt, content.length]);
  return ranges;
}

/**
 * A test for offsets visited in ascending order: whether each lies in one of `ranges`
 * (sorted, as {@link ignoredRanges} returns them). Linear over a whole file.
 */
export function createRangeCursor(ranges: readonly OffsetRange[]): (offset: number) => boolean {
  let index = 0;
  return (offset) => {
    while (index < ranges.length && ranges[index]![1] <= offset) index++;
    const range = ranges[index];
    return range !== undefined && range[0] <= offset;
  };
}
