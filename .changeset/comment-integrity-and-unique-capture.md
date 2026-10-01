---
"chaperone": minor
---

Two rule types for what merges break:

- `comment-integrity` finds block comments a merge resolution broke in JavaScript and TypeScript files: a doc comment that lost its `/**`, one that lost its `*/` (so the next comment opens inside it), and a comment that never closes. Strings, templates, regexes and JSX text are read as such.
- `unique-capture` fails when two files capture the same key from their paths, such as two migrations both numbered `0016` after two branches merged.
