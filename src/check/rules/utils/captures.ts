/**
 * Path captures with a case transform: `fan-stack` captured from `fan-stack.sb.ts` becomes
 * `FanStack`, so a rule can require it in a folder name. Used by file-contract (captureFromPath)
 * and file-pairing (pair.transform).
 */

import type { CaseTransform } from "../../types";

export const CASE_TRANSFORMS = ["pascal", "camel", "kebab", "snake"] as const satisfies readonly CaseTransform[];

/**
 * The words of an identifier in any case: `fan-stack`, `fan_stack`, `fanStack`, `FanStack` and
 * `FAN_STACK` are all ["fan", "stack"]. An acronym is one word: `HTMLParser` is ["html", "parser"].
 */
export function splitWords(value: string): string[] {
  return value
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function transformCase(value: string, transform: CaseTransform): string {
  const words = splitWords(value);
  switch (transform) {
    case "pascal":
      return words.map(capitalize).join("");
    case "camel":
      return words.map((word, index) => (index === 0 ? word : capitalize(word))).join("");
    case "kebab":
      return words.join("-");
    case "snake":
      return words.join("_");
  }
}

/** Which capture groups a transform applies to: all of them, or the ones it names. */
export type GroupTransforms = CaseTransform | Readonly<Record<string, CaseTransform>>;

function transformFor(transforms: GroupTransforms, group: string): CaseTransform | undefined {
  return typeof transforms === "string" ? transforms : transforms[group];
}

/**
 * The capture group numbers and names a regex has, for validating the groups a transform names.
 */
export function captureGroupsOf(regex: RegExp): { count: number; names: string[] } {
  const match = new RegExp(`${regex.source}|`, regex.flags.replace(/[gy]/g, "")).exec("")!;
  return { count: match.length - 1, names: Object.keys(match.groups ?? {}) };
}

/**
 * `value.replace(regex, replacement)` with each capture group transformed before it is
 * substituted. The replacement uses the same syntax as String.prototype.replace: `$1`, `$<name>`,
 * `$&`, `` $` ``, `$'` and `$$`. `$&` and the surrounding text are never transformed.
 */
export function replaceWithTransforms(
  value: string,
  regex: RegExp,
  replacement: string,
  transforms: GroupTransforms
): string {
  return value.replace(regex, (...args: unknown[]) => {
    const hasGroups = typeof args[args.length - 1] === "object" && args[args.length - 1] !== undefined;
    const named = (hasGroups ? args[args.length - 1] : undefined) as Record<string, string | undefined> | undefined;
    const tail = hasGroups ? 3 : 2;
    const matched = args[0] as string;
    const offset = args[args.length - tail] as number;
    const groups = args.slice(1, args.length - tail) as Array<string | undefined>;

    const numbered = (index: number): string => {
      const captured = groups[index - 1] ?? "";
      const transform = transformFor(transforms, String(index));
      return transform ? transformCase(captured, transform) : captured;
    };

    return replacement.replace(/\$(\$|&|`|'|<([^>]*)>|(\d\d?))/g, (token, symbol: string, name?: string, digits?: string) => {
      if (symbol === "$") return "$";
      if (symbol === "&") return matched;
      if (symbol === "`") return value.slice(0, offset);
      if (symbol === "'") return value.slice(offset + matched.length);
      if (name !== undefined) {
        if (!named) return token;
        const captured = named[name] ?? "";
        const transform = transformFor(transforms, name);
        return transform ? transformCase(captured, transform) : captured;
      }
      // Like String.prototype.replace: "$12" is group 12 when there is one, else group 1 and a "2"
      const index = Number(digits);
      if (digits!.length === 2 && index >= 1 && index <= groups.length) return numbered(index);
      const first = Number(digits![0]);
      if (first >= 1 && first <= groups.length) return numbered(first) + digits!.slice(1);
      return token;
    });
  });
}
