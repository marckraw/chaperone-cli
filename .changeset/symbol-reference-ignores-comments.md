---
"chaperone": patch
---

`symbol-reference` no longer counts a name in a comment as a reference: a `*.pure.test.ts` that says `// TODO: test countWords` and never calls it now fails the rule, as it should. Names in code and in strings still count. The tokenizer can report the comments it skips (`tokenize(code, { comments })`).
