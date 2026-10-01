---
"chaperone": minor
---

Two rule types for copies, so checks that projects scripted or ran jscpd for are config alone:

- `repeated-literal` fails when the same string literal (whitespace normalized) appears more than `maxOccurrences` times (default 2) across the matched files: a Tailwind class string's third copy, say. `literalPattern` and `minTokens` pick the literals, `contextPattern` and `contextFiles` say where they count (`className=`, `cn(...)`, `*.styles.ts`), `ignoreOrder` treats the same tokens in any order as one literal, and `allow: [{ literal, reason }]` keeps a copy on purpose. Each repeat is reported once, with every place.
- `duplicate-code` fails on a copied block of at least `minTokens` tokens (default 100) and `minLines` lines (default 5), found natively with a rolling hash, with no dependency. Tokens are counted as jscpd 5 counts them, comments and whitespace are dropped, and `allow: [{ files: [a, b], reason }]` keeps a pair on purpose. Each copy is reported once, with both places and their line ranges.

Both report an allow entry that no longer excuses anything, honour `chaperone-ignore-start` / `chaperone-ignore-end` comments (and jscpd's markers for `duplicate-code`), validate their fields with suggestions, and list every place under "Locations" in the text and ai formats. MIGRATION.md maps `.jscpd.json` and class-string scripts to them, and the README has a recipe for keeping a design system's boundary with `regex`, `repeated-literal` and `duplicate-code` together.
