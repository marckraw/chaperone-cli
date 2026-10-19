---
"chaperone": minor
---

Baselines: legacy violations go in a committed `.chaperone-baseline.json` that only shrinks, so a project that adopts a rule fails only on what is new.

- `chaperone baseline` runs the check and records each violation by rule id, file and a fingerprint: a hash of the offending text (the regex match and the source line) and the message, normalised, with line references left out, so a violation that moves stays baselined. Counts in messages are kept: a count that changes is a new violation. Identical violations in a file share an entry with a `count`. A new baseline prints every entry it records.
- `chaperone check` applies the baseline when it exists: only violations it does not cover count, fail the check and set the exit code. Every format separates the new ones from the baselined ones (`Baselined:` in text and ai output, a `baseline` object in JSON with `baselined`, `stale` and `unverified`), and reports entries that no longer occur as stale. `--no-baseline` reports everything.
- The baseline only shrinks: run again, `chaperone baseline` removes stale entries and adds nothing, lists the new violations and exits 1 if one is an error. `--allow-growth` adds them and prints every entry it added. When the file is missing from the working tree but committed, it starts from the version at `HEAD`.
- An entry whose tool was skipped, whose file could not be read, or a custom rule's entry in a file outside `--since`, is kept as "not verified" rather than reported stale. An invalid baseline file is exit code 2 (`"error": "invalid-baseline"` with `check --format json`).
- Rule-level errors (an invalid pattern, a crash, a file the rule could not parse, a tool that could not run) carry `ruleError: true`. They are never baselined, the rule's entries count as not verified while one is reported, and `chaperone baseline` exits 2 without writing. `ruleError()` and `isRuleError()` are exported for rule types.
