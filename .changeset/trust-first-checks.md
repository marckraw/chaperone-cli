---
"chaperone": minor
---

Trust-first release: Chaperone now fails loudly instead of silently. See MIGRATION.md before upgrading.

- Every rule and preset is validated at load time: unknown or removed rule types (`relationship`, `file-naming`, `file-structure`, `file-suffix-content`, with migration advice), invalid severities, missing or mistyped fields, and invalid regexes or globs stop the run with exit code 2; unknown fields are warnings with "did you mean" suggestions. `forbidden` on regex rules is a deprecated alias of `mustMatch: false`.
- Exit codes are 0 (passed), 1 (errors found) and 2 (configuration, usage or internal error); unknown options and bad `--format` values exit 2.
- Globs use Bun.Glob with braces everywhere; excludes follow .gitignore rules and are merged with the defaults; the tree is walked once per run with excluded directories pruned, which makes large repositories several times faster.
- TypeScript, ESLint and Prettier runners fail closed, report why they were skipped, read Prettier 3 output, detect eslint.config.ts/.mts/.cts, and run concurrently.
- Regex rules match `^`/`$` per line by default (new `flags` field) and no longer hang on empty matches.
- Imports are read with a TS/JSX-aware tokenizer, and import-boundary/public-api resolve tsconfig `paths`/`baseUrl` aliases, directory imports and `.js` → `.ts` specifiers.
- Reports show skipped tools, rules whose globs matched no files and disabled rules in every format; the ai format includes result context and caps results per rule; `--format json` is clean JSON and `--quiet` applies to every format.
- Fixes for public-api barrel imports, react-component-count, component-location globs, file-contract line counts, symbol-reference detection, `disabled: true` without `extends` and nested preset paths.
- `chaperone analyze` only patches your own config file and never writes after a load failure.
- New: `chaperone check --since <git-ref>` and `CHAPERONE_NO_UPDATE_CHECK=1`.
