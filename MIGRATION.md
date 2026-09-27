# Migrating to Chaperone 0.8

Chaperone 0.8 is a "trust first" release. Until 0.7 a lot could go wrong silently: an invalid rule was skipped, a crashed tool counted as a pass, a glob that matched nothing passed, and `--format json` started with terminal escape codes. 0.8 makes all of that loud. Most configs keep working, but some will now fail, and some will find violations that were always there.

Run `chaperone check` once after upgrading. Exit code **2** means the configuration needs fixing (the list of problems is printed, all at once); exit code **1** means real violations.

## What changed

- **Config validation.** Every rule, in your config and in every preset, is validated when it loads. Unknown or removed rule types, invalid severities, missing or mistyped fields, invalid regexes and globs are errors (exit 2). Unknown fields are warnings with "did you mean" suggestions.
- **Exit codes.** `0` passed, `1` errors found, `2` configuration, usage or internal error (was `1`). Unknown options and bad `--format` values are usage errors instead of being ignored.
- **Globs and excludes.** Real glob matching (braces everywhere, `**` at any depth, special characters in paths), `.gitignore`-style excludes that are merged with the defaults, and one pruned walk of the tree per run (much faster on big repos).
- **Tool runners fail closed.** A tool that exits with an error but reports nothing parseable is an error, not a pass. Prettier 3 output is read correctly. Skipped tools are always reported with the reason. Runners run concurrently.
- **Regex rules.** `^` and `$` match per line by default (`flags`, default `"m"`), empty matches can no longer hang the check, results include the matched text.
- **Imports.** A real tokenizer replaces the regexes, and import rules resolve tsconfig `paths`/`baseUrl` aliases, directory imports and `.js` → `.ts` specifiers.
- **Visibility.** Rules whose globs match no files, skipped tools and disabled rules appear in every report; `PASSED` is qualified when anything was skipped.
- **Clean machine output.** `--format json` is pure JSON; no ANSI codes when stdout is not a terminal or the format is `json`/`ai`; `--quiet` works in every format.
- **Rule fixes.** public-api accepts directory (barrel) imports, react-component-count skips the parameter list, component-location globs work, file-contract `maxLines` no longer counts a trailing newline, symbol-reference finds more exported functions, `disabled: true` works without `extends`, nested local preset `extends` resolve from the preset's directory.
- **`chaperone analyze`** patches only your own config file (keeps `extends`, never inlines presets) and never writes after a load failure.
- **New:** `check --since <git-ref>`, `CHAPERONE_NO_UPDATE_CHECK=1`.

## What might newly fail, and how to fix it

### 1. Removed rule types (exit 2)

`relationship`, `file-naming`, `file-structure` and `file-suffix-content` were removed in 0.5.0 but were silently skipped until now. They are now errors.

`relationship` → `file-pairing` (companion files) and/or `file-contract` (content):

```jsonc
// before
{
  "id": "pure-files-need-sibling-tests",
  "type": "relationship",
  "severity": "error",
  "when": { "files": "apps/*/src/**/*.pure.ts" },
  "then": [{ "mustHaveCompanion": { "pair": { "from": "\\.pure\\.ts$", "to": ".pure.test.ts" } } }]
}
// after
{
  "id": "pure-files-need-sibling-tests",
  "type": "file-pairing",
  "severity": "error",
  "files": "apps/*/src/**/*.pure.ts",
  "pair": { "from": "\\.pure\\.ts$", "to": ".pure.test.ts" },
  "mustExist": true
}
```

Other `then` actions: `mustNotHaveCompanion` → `file-pairing` with `mustExist: false`; `fileMustContain`/`fileMustNot` → `file-contract` `requiredPatterns`/`forbiddenPatterns`; `maxLines` → `file-contract` `assertions.maxLines`; `mustImport`/`mustNotImport` → `file-contract` `assertions.mustImport`/`mustNotImport`. `companionMustContain`/`companionMustNot`/`companionMaxLines` become a `file-contract` rule whose `files` glob selects the companions.

`file-naming` → `file-pairing`: rename `pattern` to `files` and replace `requireCompanion: { "transform": "$1.test.tsx" }` with `pair: { "from": "\\.tsx$", "to": ".test.tsx" }`.

`file-suffix-content` → `file-contract`: `"files": "src/**/*.presentational.tsx"` (suffix folded into the glob), and `forbiddenPatterns: [{ "pattern": "\\buseEffect", "name": "useEffect" }]` becomes `forbiddenPatterns: ["\\buseEffect"]`.

`file-structure` has no direct replacement: use `file-pairing` (`mustExist: true`) for required companions, `retired-path` for unwanted locations, or a `command` rule that runs a script.

### 2. Invalid severities (exit 2)

`"severity"` must be `"error"` or `"warning"`. A typo such as `"eror"` used to make the rule's violations count as neither errors nor warnings, so the rule could never fail the check. The error message suggests the closest value.

### 3. Missing or mistyped fields (exit 2)

Rules that miss a required field used to crash (`undefined is not an object (evaluating '$.match')`) or quietly do nothing. The error now names the rule id and the field, e.g. `rules.custom[3].files (rule "no-console"): missing required field "files"`.

Required fields worth double-checking:

- every rule: `type`, `id`, `severity`;
- `regex`: `files`, `pattern`, `message`;
- `component-location`: `files`, `componentType`, `requiredLocation`, `mustBeIn` (a missing `mustBeIn` used to mean "must NOT be in");
- `file-contract`: `files` plus at least one pattern list or `assertions`;
- `forbidden-import`: `files` plus at least one `restrictions` or `checkPatterns` entry;
- `import-boundary`: every layer needs `files` and `allowImportsFrom`, and may only reference defined layers.

Overriding a preset rule replaces it entirely. If you override a preset rule to change only its severity, copy the whole rule; to switch it off, use `{ "id": "preset/…", "disabled": true }`.

### 4. `forbidden` on regex rules (warning)

`"forbidden": true` still works as an alias of `"mustMatch": false`, with a deprecation warning. Replace it with `"mustMatch": false` (or just remove it, since that is the default). `"forbidden": true` together with `"mustMatch": true` is an error.

### 5. Regex rules match `^` and `$` per line

Regex rules now run with the `m` flag by default, so `^\s*export\s+default\b` finds a default export on any line, not only on line 1. This can surface **new violations** for forbidden patterns that use `^` or `$`.

If a rule relied on `^` meaning "start of file" (typically a `mustMatch: true` header check), set `"flags": ""`. To keep per-line anchors and add other flags, include `m`: `"flags": "im"`. Also: a pattern that can match an empty string (for example `TODO|`) used to hang the check; it now only reports non-empty matches, and validation warns about it. Lookahead-only patterns such as `(?=console\.log)` (which also used to hang) now report normally.

### 6. Excludes are merged with the defaults and follow `.gitignore` rules

- `node_modules` and `.git` (any depth) plus `/dist` and `/build` (project root) are always excluded. Your `exclude` no longer replaces them, so `"exclude": ["data"]` no longer makes Chaperone walk `node_modules`.
- A slash-less pattern matches that name **at any depth**: `"exclude": ["dist"]` now also excludes `packages/x/dist`, and no longer excludes `distribution/` (a prefix match before). Anchor it with a slash to mean only the root: `"/dist"`.
- `**/x` patterns now match at the root too: `"exclude": ["**/*.md"]` now excludes `AGENTS.md`. Globs with braces now work in `exclude` and `allowedIn`: `"**/*.test.{ts,tsx}"` used to match nothing.
- To check something an exclude covers, re-include the directory itself with `!`: `"exclude": ["build", "!src/build"]`. As in `.gitignore`, files below an excluded directory cannot be re-included one by one.

Some rules may now see fewer files (things you excluded now really are excluded) or more files (brace globs in `files` that used to fail now match).

### 7. Import boundaries and public APIs see aliased imports

`import-boundary` and `public-api` used to look only at relative imports. They now resolve tsconfig `paths`/`baseUrl` aliases (`@/features/auth`), directory imports and `.js` specifiers, so violations hidden behind `@/…` imports **now surface**. Type-only imports (`import type`, `import { type X }`, `export type { X } from`, `typeof import("x")`) are recognised; import-boundary checks them by default (`includeTypeImports: true`), forbidden-import does not.

If a boundary rule now floods with violations you cannot fix yet, lower its `severity` to `"warning"` while you migrate, or (temporarily) set `"integrations": { "useTypescriptPaths": false }` to stop resolving aliases. public-api no longer flags correct barrel imports such as `import { login } from "../features/auth"`; with a custom `barrelFile`, only that file counts as the public API (`index.*` is no longer accepted implicitly).

### 8. Other behaviour you may notice

- **Tool runners fail closed.** A broken ESLint config (exit 2), `tsc` error TS18003 ("No inputs were found in config file") or a Prettier syntax error now fails the check with the tool's output. Unformatted files reported by Prettier 3 (on stderr) now appear as warnings. Fix the tool configuration, or set `rules.<tool>.enabled: false`.
- **Rules that matched no files** are reported, and `PASSED` becomes `PASSED, but not everything was checked: …`. Check the glob for typos; the exit code is unchanged.
- **`disabled: true` works without `extends`.** Rules you had disabled in a config without `extends` were still running before. A disabled entry whose id nothing defines produces a warning.
- **Nested local presets**: a `./b.json` inside `presets/a.json` now resolves to `presets/b.json` (it used to resolve from the project root).
- **file-contract `maxLines`/`minLines`** count lines, not line breaks: a 3-line file with a trailing newline has 3 lines (it used to count 4). `mustImport`/`mustNotImport` now see side-effect imports, re-exports, dynamic imports and `require()`, and ignore commented-out imports.
- **react-component-count** now counts components with destructured props (`function Card({ title })`) and multi-line `forwardRef<A, B>()` wrappers, which it used to miss: expect new violations in files with several components.
- **component-location**: `requiredLocation: "src/components/ui"` (no trailing slash) means that directory only, no longer any path starting with it (`src/components/ui-kit`); `**` globs work.
- **symbol-reference** recognises more exported functions (`export const f: Fn = …`, generic arrows, nested parentheses in parameters, `let`/`var`): new "not referenced" violations may appear.
- **Exit code 2** replaces `1` for configuration and usage errors. Scripts that tested `$? -eq 1` for "chaperone failed" should treat any non-zero code as failure.
- **Unknown CLI options** (`chaperone check --formatt json`) are errors (exit 2) instead of being ignored.
- **`--format json`** starts with `{`, and adds `status` (`passed`, `passed-with-gaps`, `failed`), `gaps`, `runners`, `rules`, `disabledRules`, `diagnostics` and `since`. Configuration errors are reported as `{ "success": false, "error": "invalid-config", "diagnostics": [...] }` with exit code 2.
- **`chaperone analyze`** only edits your own config file and refuses to run when the config does not load.
- **`chaperone init`** no longer writes `integrations` (`respectEslintIgnore`/`respectPrettierIgnore` never did anything) or the default excludes.

## Upgrade checklist

1. Install 0.8 and run `chaperone check --format json > /tmp/chaperone.json; echo $?`.
2. Exit code 2: fix every listed error (removed types, severities, missing fields), then rerun.
3. Read the configuration warnings (unknown fields, `forbidden`, empty-matching patterns) and fix them.
4. Look at "matched no files" rules and skipped tools; fix globs, or accept them knowingly.
5. Review new violations (regex `^`/`$`, aliased imports, component counts, symbol references). Fix the code, or adjust rules deliberately.
6. Update CI scripts that relied on exit code 1 for configuration errors.

## Prompt for AI agents

Paste this into a coding agent working in a repository that uses Chaperone:

```text
This repository uses Chaperone (a CLI that checks repo conventions from .chaperone.json).
Chaperone 0.8 now validates its configuration and reports problems it used to hide.
Upgrade our configuration so `chaperone check` runs cleanly and honestly. Do not delete
rules or loosen them just to make the check pass.

1. Run `chaperone --version` (must be 0.8.0 or later), then
   `chaperone check --format json > /tmp/chaperone.json; echo "exit=$?"`.
   Exit code 2 = the configuration is invalid (nothing was checked);
   1 = real violations; 0 = passed.
2. If the exit code is 2, read `.diagnostics` in /tmp/chaperone.json (or the stderr
   output) and fix every error in .chaperone.json and in any local preset it extends:
   - Rule types `relationship`, `file-naming`, `file-structure`, `file-suffix-content`
     were removed. Rewrite them: companion files -> `file-pairing` with
     `files`, `pair: { from, to }`, `mustExist`; content checks -> `file-contract` with
     `requiredPatterns` / `forbiddenPatterns` / `assertions` (maxLines, mustImport,
     mustNotImport). Keep the same `id` and intent.
   - `severity` must be "error" or "warning".
   - Add missing required fields named in the error (regex needs files, pattern,
     message; component-location needs mustBeIn; import-boundary layers need files
     and allowImportsFrom).
   - An override of a preset rule replaces the whole rule: copy all its fields, or
     use `{ "id": "...", "disabled": true }` to switch it off.
3. Fix warnings: replace `"forbidden": true` with `"mustMatch": false` (or drop it),
   fix unknown fields (follow the "did you mean" hint), and rewrite regex patterns
   that can match an empty string.
4. Regex rules now match ^ and $ per line (default flags "m"). For rules that relied
   on ^ meaning "start of file" (usually mustMatch: true header checks), add
   `"flags": ""`.
5. Excludes are now merged with the defaults (node_modules, .git, /dist, /build) and
   follow .gitignore rules: a bare name matches at any depth, a leading "/" anchors
   to the project root, "!" re-includes. Remove entries that only repeated the
   defaults, and check that nothing we want checked is excluded.
6. Look at `.rules[] | select(.status == "no-files")` and `.runners[] |
   select(.status != "passed")` in the JSON. Fix globs that match nothing (usually
   typos or moved directories); explain any tool that is skipped on purpose.
7. Run `chaperone check --format ai` and fix the reported violations in the code.
   import-boundary and public-api now resolve tsconfig aliases such as "@/...", so
   boundary violations hidden behind aliases will appear: fix the imports, do not
   weaken the layers. If a rule truly cannot be satisfied yet, set its severity to
   "warning" and say so in your summary.
8. Update scripts or CI steps that treated exit code 1 as "chaperone failed to run":
   exit code 2 now means configuration/usage errors.
9. Finish with `chaperone check` exiting 0 and report what you changed, which
   warnings remain, and anything reported as skipped or "matched no files".
```
