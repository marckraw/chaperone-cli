# Migrating to Chaperone 0.10

0.10 lets every repository pin the Chaperone it runs. Until now `chaperone` was one binary shared by every repository on a machine: upgrading it changed every repository's checks at once, so some repositories wrapped it in a script that downloads a fixed version. Now one field in `.chaperone.json` does that, and the `chaperone` you install runs whatever version each repository pins.

The checks themselves do not change: a config that passes on 0.9 passes on 0.10. Coming from 0.8 or older? Read [Coming from 0.8.x](#coming-from-08x-what-09-changed) and [Coming from 0.7.x](#coming-from-07x-what-08-changed) too: their changes apply to you as well.

## What's new in 0.10

- **`"chaperoneVersion": "0.10.0"`** in `.chaperone.json` pins the version. An exact version (`v0.10.0` is read as `0.10.0`); a range, `latest` or a misspelled field name is an error (exit 2) with a suggestion.
- **The installed `chaperone` is a launcher.** When the pin names another version, it downloads that release once, checks it against the release's `SHA256SUMS.txt`, caches it in `~/.cache/chaperone/<version>/` and runs it with the same arguments, stdio and environment, passing its exit code (and signals) through. It works offline once a version is cached, and it never runs another version in its place: when the pinned one is unavailable, the run fails with exit code 2 and says what to do.
- **`chaperone pin [version]`** writes the field; **`chaperone cache`** lists and clears downloaded versions; **`chaperone --version`** names the version that runs here and the launcher's.
- **`install.sh --version pinned`** (or `CHAPERONE_VERSION=pinned`) installs the version a repository pins: one line in CI.
- **`chaperone init`** pins new configs to the version that wrote them.

See [Pinning a version](./README.md#pinning-a-version) for everything else (the cache, the environment variables, what happens offline).

## Upgrading to 0.10

1. **Install the launcher once:** `curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=0.10.0 sh`. This is the last upgrade that changes what every repository runs: a repository that pins keeps its version from now on. Until a repository pins, it runs 0.10.0.
2. **Pin each repository:** `chaperone pin` pins 0.10.0; `chaperone pin 0.9.0` keeps the version a repository runs today, to upgrade it later on its own. Commit `.chaperone.json`.
3. **Install the pinned version in CI:** replace `CHAPERONE_VERSION: v0.9.0` (or a hard-coded download) with `curl -fsSL .../install.sh | CHAPERONE_VERSION=pinned sh`. The field is then the only place the version lives.
4. **Delete wrapper scripts,** once the pinned version demonstrably runs in their place (next section).

Upgrading a repository later is `chaperone pin <version>`: the launcher downloads the version, and the diff is one line that CI checks.

## Replacing a wrapper script

Some repositories already pin Chaperone with a script. accent.'s `scripts/chaperone.mjs` is the model: a `VERSION` constant, a download of the release binary into `node_modules/.cache`, a check against `SHA256SUMS.txt`, and `pnpm chaperone` running `node scripts/chaperone.mjs check`. The launcher does all of that, so the script can go, but only after proving that `chaperone` runs the same version the script did. Replace the mechanism first, at the script's version, and upgrade afterwards, so each step can be checked on its own:

1. Read the version the script pins (accent.'s: `const VERSION = "0.8.0"`), and pin the same one: `chaperone pin 0.8.0`.
2. Prove the same version runs:
   - `node scripts/chaperone.mjs --version` and `chaperone --version` must name the same version (`chaperone v0.8.0`, and `chaperone v0.8.0 (pinned in .chaperone.json, launched by v0.10.0)`).
   - `node scripts/chaperone.mjs check --format json > /tmp/script.json; echo $?` and `chaperone check --format json > /tmp/pinned.json; echo $?` must exit with the same code and report the same results: `diff <(jq -S '.results' /tmp/script.json) <(jq -S '.results' /tmp/pinned.json)` prints nothing.
   (Versions before 0.10 report `unknown field "chaperoneVersion" is ignored` among the configuration warnings; that warning is the only expected difference, in `.diagnostics`.)
3. Point everything at `chaperone`: package.json scripts (`"chaperone": "chaperone check"`), git hooks and CI (`CHAPERONE_VERSION=pinned`). Then delete the script and its cache (`node_modules/.cache/chaperone`).
4. Now upgrade: `chaperone pin 0.10.0`, run `chaperone check`, and fix what newly fails (for 0.8 → 0.10, see [Coming from 0.8.x](#coming-from-08x-what-09-changed)).

## What might newly fail in 0.10

- **Nothing in the checks.** Existing rules report exactly what they reported on 0.9.
- A config with an invalid `chaperoneVersion`, a misspelled one (`chaperone_version`), or one in a preset fails with exit code 2. None of these could exist before 0.10, so only a pin you add can trigger them.
- A pin of a version before 0.10 runs that version, which warns `unknown field "chaperoneVersion" is ignored`. Warnings never change the exit code.
- `chaperone --version` adds a note in parentheses, and in a pinned repository its first version is the pinned one: `chaperone v0.9.0 (pinned in .chaperone.json, launched by v0.10.0)`. The output still starts with `chaperone v<version>`.
- `chaperone help` runs in the pinned version, so a repository pinned to 0.9 shows 0.9's help (without `pin` and `cache`, which work anyway).
- A repository that pins a version the machine has not cached yet needs the network on its first run. Offline, the run fails with exit code 2 instead of running another version.

## Coming from 0.8.x: what 0.9 changed

Skip this part if you are on 0.9 already. 0.9 added four rule types and two fixes. A config that passes on 0.8 keeps working; one fix can turn up violations that were always there (below).

### What's new in 0.9

Four rule types for what review lets through, each one a few lines of config instead of a script:

| Rule type | Fails on | Replaces |
|-----------|----------|----------|
| `comment-integrity` | block comments a merge broke: a doc comment that lost its `/**` or its `*/`, a comment that never closes | a script that scans for comment lines outside comments |
| `unique-capture` | two files that capture the same key from their paths, such as two migrations numbered `0016` | a script that checks migration or ADR numbering |
| `repeated-literal` | a string literal's copies over a limit, such as a Tailwind class string's third copy | a script that counts class strings |
| `duplicate-code` | a copied block of `minTokens` tokens or more, found natively (no jscpd) | jscpd and a wrapper for its allowlist |

They report alike: each finding once, with every place it involves under "Locations" (`context.locations` in `--format json`), and an `allow` list (where there is one) whose entries need a reason and are reported once they excuse nothing. See [Custom Rule Types](./README.md#custom-rule-types) and the [Recipes](./README.md#recipes).

Two fixes:

- **The whole report through a pipe.** The compiled binary could lose everything past the first 64 KB of a report when the reader was slower than the write (`chaperone check --format json | jq` read half a document). The report is now written in full.
- **symbol-reference: a name in a comment is not a reference.** A test that only mentions an export in a comment used to satisfy rules such as "every pure function is tested". Comments in the target files are now ignored; strings still count (`describe("formatPrice", …)`).

### What might newly fail after 0.9

- **symbol-reference rules** can report new "not referenced" violations: an export that a target file only named in a comment (often a test's header comment) was never really referenced. Reference it for real, usually by calling it in the test. Do not add a string or a comment to satisfy the rule. On one 2,000-file project the upgrade found none, so expect few.
- Nothing else changes for existing rules: the four new types run only where a config adds them.

## Moving checks into Chaperone

Optional, and worth it: a check that is config runs in the same pass as the others, honours `--since`, reports in every format, and its config is validated. Replace a script only once the rule finds what the script finds (see [Prove parity before deleting a script](#prove-parity-before-deleting-a-script)).

### From jscpd to `duplicate-code`

| `.jscpd.json` | `duplicate-code` rule |
|---------------|-----------------------|
| `path` + `pattern` (+ `format`) | `files`: one glob, e.g. `"{apps/*/src,packages/ui/src}/**/*.{ts,tsx}"` |
| `ignore` | `exclude` (`.gitignore`-style, merged with the global `exclude`) |
| `minTokens` | `minTokens` (default 100 instead of jscpd's 50). Tokens are counted the way jscpd 5 counts them, so keep your value. |
| `minLines` | `minLines` (default 5, as in jscpd) |
| a wrapper script's allowlist | `allow: [{ "files": ["a", "b"], "reason": "..." }]`; an entry that no longer matches a copy is reported |
| `// jscpd:ignore-start` ... `// jscpd:ignore-end` | keep them, or write `chaperone-ignore-start` / `chaperone-ignore-end` |
| `threshold` | no equivalent: every copy outside `allow` fails already |
| `mode`, `reporters`, `output`, `exitCode` | not needed: comments are always dropped, and Chaperone reports and exits |

Expect the same copies (on one 1,200-file TypeScript project, the same pairs, line ranges and token counts). The known differences each find more: a copy between a `.ts` and a `.tsx` file counts, re-indented JSX is still a copy, and a copy spanning exactly `minLines` lines counts (jscpd 5 wants one more). A copy's last line is the line of its last token, where jscpd sometimes reports the next one.

### From a class-string script to `repeated-literal`

A script that counts copies of class strings in `className`, `cn(...)` and `cva(...)`:

```json
{
  "id": "repeated-classes",
  "type": "repeated-literal",
  "severity": "error",
  "files": "{apps,packages}/*/src/**/*.{ts,tsx}",
  "exclude": ["**/*.test.{ts,tsx}", "**/*.stories.tsx"],
  "contextPattern": "\\bclassName\\s*=|(?:^|[^\\w$.])(?:cn|cva)\\s*\\(",
  "contextFiles": ["**/*.styles.ts"],
  "ignoreOrder": true,
  "minTokens": 4,
  "maxOccurrences": 2,
  "allow": [{ "literal": "flex h-full min-h-0 flex-col", "reason": "A column that fills its pane: layout, not a look" }]
}
```

`attributes` and `functions` become one `contextPattern` (an attribute name followed by `=`, a function name followed by `(`), class files become `contextFiles`, "the same utilities in any order" is `ignoreOrder`, and `allowlist: [{ classes, reason }]` becomes `allow: [{ literal, reason }]`. Once parity holds (below), delete the script and its `command` rule.

### From a doc-comment script to `comment-integrity`

```json
{
  "id": "merge-broken-comments",
  "type": "comment-integrity",
  "severity": "error",
  "files": "{apps,packages,scripts}/**/*.{ts,tsx,mts,js,mjs,jsx}"
}
```

Point `files` at what the script walked, and exclude what it skipped (build output, generated files). It reports the same three problems at the same lines: a comment line with no comment open (once per run of lines), a comment opening inside another (with the outer comment's line), and a comment that never closes.

### From a migration-numbering script to `unique-capture`

```json
{
  "id": "migration-numbers",
  "type": "unique-capture",
  "severity": "error",
  "files": "db/migrations/*.sql",
  "capture": { "pattern": "^(\\d{4})_[a-z0-9_]+\\.sql$", "source": "basename" }
}
```

Copy the script's file-name pattern into `capture.pattern`, with the number as the first group: files the pattern doesn't match are ignored, as a script that skips them would. `unique-capture` only replaces the duplicate-number check. A script that also checks a migration journal (order, dates), a snapshot chain, migrations that run no SQL, or merged migrations that changed keeps doing so: shrink the script to those checks, or keep it whole.

### Prove parity before deleting a script

1. Run the script and the new rule on the current tree, and compare what they report: the same files, lines and groups. Differences need an explanation (the rule's docs list the known ones), not a shrug.
2. Break the tree on purpose, in a scratch copy or a branch you throw away: paste a component into a second file, add a third copy of a class string, delete a doc comment's `/**`, copy a migration under the same number. Run both again: each must report the break.
3. Carry over the script's allowlist entry by entry, with its reason. An entry the rule reports as unused was stale in the script too: remove it, don't keep it quiet.
4. Only then delete the script, its `command` rule and any dependency it alone needed (jscpd).

## Coming from 0.7.x: what 0.8 changed

Skip this part if you are on 0.8 already. From 0.7.x (or older), everything below applies on top of 0.9's and 0.10's changes.

Chaperone 0.8 is a "trust first" release. Until 0.7 a lot could go wrong silently: an invalid rule was skipped, a crashed tool counted as a pass, a glob that matched nothing passed, and `--format json` started with terminal escape codes. 0.8 makes all of that loud. Most configs keep working, but some will now fail, and some will find violations that were always there.

Run `chaperone check` once after upgrading. Exit code **2** means the configuration needs fixing (the list of problems is printed, all at once); exit code **1** means real violations.

### What changed in 0.8

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

### What might newly fail after 0.8, and how to fix it

#### 1. Removed rule types (exit 2)

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

#### 2. Invalid severities (exit 2)

`"severity"` must be `"error"` or `"warning"`. A typo such as `"eror"` used to make the rule's violations count as neither errors nor warnings, so the rule could never fail the check. The error message suggests the closest value.

#### 3. Missing or mistyped fields (exit 2)

Rules that miss a required field used to crash (`undefined is not an object (evaluating '$.match')`) or quietly do nothing. The error now names the rule id and the field, e.g. `rules.custom[3].files (rule "no-console"): missing required field "files"`.

Required fields worth double-checking:

- every rule: `type`, `id`, `severity`;
- `regex`: `files`, `pattern`, `message`;
- `component-location`: `files`, `componentType`, `requiredLocation`, `mustBeIn` (a missing `mustBeIn` used to mean "must NOT be in");
- `file-contract`: `files` plus at least one pattern list or `assertions`;
- `forbidden-import`: `files` plus at least one `restrictions` or `checkPatterns` entry;
- `import-boundary`: every layer needs `files` and `allowImportsFrom`, and may only reference defined layers.

Overriding a preset rule replaces it entirely. If you override a preset rule to change only its severity, copy the whole rule; to switch it off, use `{ "id": "preset/…", "disabled": true }`.

#### 4. `forbidden` on regex rules (warning)

`"forbidden": true` still works as an alias of `"mustMatch": false`, with a deprecation warning. Replace it with `"mustMatch": false` (or just remove it, since that is the default). `"forbidden": true` together with `"mustMatch": true` is an error.

#### 5. Regex rules match `^` and `$` per line

Regex rules now run with the `m` flag by default, so `^\s*export\s+default\b` finds a default export on any line, not only on line 1. This can surface **new violations** for forbidden patterns that use `^` or `$`.

If a rule relied on `^` meaning "start of file" (typically a `mustMatch: true` header check), set `"flags": ""`. To keep per-line anchors and add other flags, include `m`: `"flags": "im"`. Also: a pattern that can match an empty string (for example `TODO|`) used to hang the check; it now only reports non-empty matches, and validation warns about it. Lookahead-only patterns such as `(?=console\.log)` (which also used to hang) now report normally.

#### 6. Excludes are merged with the defaults and follow `.gitignore` rules

- `node_modules` and `.git` (any depth) plus `/dist` and `/build` (project root) are always excluded. Your `exclude` no longer replaces them, so `"exclude": ["data"]` no longer makes Chaperone walk `node_modules`.
- A slash-less pattern matches that name **at any depth**: `"exclude": ["dist"]` now also excludes `packages/x/dist`, and no longer excludes `distribution/` (a prefix match before). Anchor it with a slash to mean only the root: `"/dist"`.
- `**/x` patterns now match at the root too: `"exclude": ["**/*.md"]` now excludes `AGENTS.md`. Globs with braces now work in `exclude` and `allowedIn`: `"**/*.test.{ts,tsx}"` used to match nothing.
- To check something an exclude covers, re-include the directory itself with `!`: `"exclude": ["build", "!src/build"]`. As in `.gitignore`, files below an excluded directory cannot be re-included one by one.

Some rules may now see fewer files (things you excluded now really are excluded) or more files (brace globs in `files` that used to fail now match).

#### 7. Import boundaries and public APIs see aliased imports

`import-boundary` and `public-api` used to look only at relative imports. They now resolve tsconfig `paths`/`baseUrl` aliases (`@/features/auth`), directory imports and `.js` specifiers, so violations hidden behind `@/…` imports **now surface**. Type-only imports (`import type`, `import { type X }`, `export type { X } from`, `typeof import("x")`) are recognised; import-boundary checks them by default (`includeTypeImports: true`), forbidden-import does not.

If a boundary rule now floods with violations you cannot fix yet, lower its `severity` to `"warning"` while you migrate, or (temporarily) set `"integrations": { "useTypescriptPaths": false }` to stop resolving aliases. public-api no longer flags correct barrel imports such as `import { login } from "../features/auth"`; with a custom `barrelFile`, only that file counts as the public API (`index.*` is no longer accepted implicitly).

#### 8. Other behaviour you may notice

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

1. Install the 0.10.0 launcher once (`CHAPERONE_VERSION=0.10.0` with the install script). Repositories that pin keep their version from then on.
2. In each repository: replace a wrapper script, if there is one, at its own version first ([Replacing a wrapper script](#replacing-a-wrapper-script)); then `chaperone pin 0.10.0` and commit `.chaperone.json`.
3. In CI, install with `CHAPERONE_VERSION=pinned`, and remove the version from every other place (CI variables, scripts).
4. Run `chaperone check --format json > /tmp/chaperone.json; echo $?`.
5. Coming from 0.7.x and exit code 2: fix every listed configuration error (see [Coming from 0.7.x](#coming-from-07x-what-08-changed)), then rerun.
6. Read the configuration warnings and the "matched no files" rules and skipped tools; fix them, or accept them knowingly.
7. Fix new violations in the code (symbol-reference after 0.9; regex `^`/`$`, aliased imports, component counts and symbol references after 0.8).
8. Replace scripts that are now config, with parity proven first ([Moving checks into Chaperone](#moving-checks-into-chaperone)).

## Prompt for AI agents

Paste this into a coding agent working in any repository that uses Chaperone:

```text
This repository uses Chaperone, a CLI that checks repo conventions from .chaperone.json.
Pin it to 0.10.0 in .chaperone.json, make `chaperone check` pass honestly, and then move
checks that this repository runs as scripts into Chaperone's built-in rules. Work in
this order.

Never: delete a rule, lower a severity, widen an exclude, raise a threshold or add an
allowlist entry just to make the check pass; delete a script before proving that what
replaces it does the same; edit generated files to silence a rule; or skip hooks
(--no-verify).

1. Make sure the installed chaperone is a launcher (0.10.0 or later).
   - Run `chaperone --version`. If it is missing or older than 0.10.0, install 0.10.0:
     `curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=0.10.0 sh`
     The script verifies the checksum. It replaces the binary every repository on this
     machine uses; from 0.10 on that binary runs whatever version each repository pins,
     so repositories that pin are not affected. Mention the install in your summary.

2. Find every place this repository decides which Chaperone runs:
   `grep -rn -i chaperone .github package.json scripts .husky lefthook.yml 2>/dev/null`.
   Look for a version in CI (`CHAPERONE_VERSION: v0.8.0`, a download URL with a tag),
   and for a wrapper script: a script that downloads a fixed Chaperone version and runs
   it (for example scripts/chaperone.mjs with `const VERSION = "0.8.0"`). Note each
   version you find.

3. If there is a wrapper script, replace it at its own version first, and prove it:
   - Pin the wrapper's version: `chaperone pin <its version>` (for example 0.8.0).
   - `chaperone --version` must name that version
     (`chaperone v0.8.0 (pinned in .chaperone.json, launched by v0.10.0)`), as the wrapper
     does (`node scripts/chaperone.mjs --version`).
   - Run both on the current tree:
     `node scripts/chaperone.mjs check --format json > /tmp/wrapper.json; echo "exit=$?"`
     `chaperone check --format json > /tmp/pinned.json; echo "exit=$?"`
     The exit codes must match, and this must print nothing:
     `diff <(jq -S .results /tmp/wrapper.json) <(jq -S .results /tmp/pinned.json)`
     (Versions before 0.10 warn `unknown field "chaperoneVersion" is ignored`: that is
     the one expected difference, in .diagnostics.)
   - Only then point package.json scripts, git hooks and CI at `chaperone` (for example
     `"chaperone": "chaperone check"`), and delete the wrapper script and the cache it
     kept (such as node_modules/.cache/chaperone). Commit this step on its own.
   If the versions or the results differ, stop and report it: do not delete the wrapper.

4. Pin 0.10.0: `chaperone pin 0.10.0`. `chaperone --version` must say
   `chaperone v0.10.0 (pinned in .chaperone.json)`. Then make CI install exactly the
   pinned version, replacing any other install step:
   `curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=pinned sh`
   Remove every other place that names a Chaperone version (CI variables, scripts):
   "chaperoneVersion" in .chaperone.json is now the only one.

5. Fix whatever newly fails, honestly.
   - Run `chaperone check --format json > /tmp/chaperone.json; echo "exit=$?"`.
     Exit 2 = the configuration is invalid (or the pinned version could not be
     installed) and nothing was checked; 1 = violations; 0 = passed.
   - Exit 2 (usually coming from 0.7.x): read `.diagnostics` and fix every error in
     .chaperone.json and in any local preset it extends. Removed rule types
     (`relationship`, `file-naming`, `file-structure`, `file-suffix-content`) become
     `file-pairing` (files, pair: { from, to }, mustExist) or `file-contract`
     (requiredPatterns, forbiddenPatterns, assertions), keeping the same id and intent.
     `severity` must be "error" or "warning". Add the missing fields the errors name.
     An override of a preset rule replaces the whole rule.
   - Fix the warnings: unknown fields (follow the "did you mean" hint), `"forbidden"`
     (use "mustMatch"), regex patterns that can match an empty string.
   - Read `.gaps`, `.rules[] | select(.status == "no-files")` and
     `.runners[] | select(.status != "passed")`: fix globs that match nothing; explain
     any tool that is skipped on purpose.
   - Fix the violations in the code (`chaperone check --format ai`). After 0.9, a
     symbol-reference rule may report an export that a test only names in a comment:
     reference it for real (call it). After 0.8, regex rules match ^ and $ per line
     (add "flags": "" where ^ meant the start of the file), excludes follow
     .gitignore rules, and import rules resolve tsconfig aliases: fix the imports,
     do not weaken the layers. If a rule truly cannot pass yet, set it to "warning"
     and say so in your summary.
   - Scripts or CI steps that treated exit code 1 as "chaperone failed to run" must
     treat any non-zero code as failure (2 = configuration or usage error).

6. Search for checks that are now config. Look in scripts/ (and tools/, bin/), in CI
   workflows, in package.json scripts, in git hooks, and in .chaperone.json `command`
   rules. Candidates:
   - copied code: `.jscpd.json`, a jscpd dependency, a guard around it;
   - repeated class strings, or any "the third copy of a string fails" script;
   - doc comments broken by merges: a script looking for `*` lines outside comments,
     or a `/*` inside a comment;
   - duplicate migration or sequence numbers: a script that checks a folder of
     numbered files.
   For each, read the script and write down exactly what it checks, its files, its
   limits and its allowlist.

7. Replace each with a built-in rule, and prove parity before deleting the script:
   - copied code -> `duplicate-code` (files, exclude, minTokens, minLines, allow);
   - repeated strings -> `repeated-literal` (files, literalPattern, minTokens,
     contextPattern, contextFiles, ignoreOrder, maxOccurrences, allow);
   - broken comments -> `comment-integrity` (files);
   - duplicate numbers -> `unique-capture` (files, capture: { pattern, group, source }).
   Read their documentation in Chaperone's README (Custom Rule Types) and MIGRATION.md.
   Run the script and the rule on the current tree: they must report the same files,
   lines and groups, or you must explain each difference from the documentation.
   Then break a scratch copy of the tree on purpose (paste a block of code into a
   second file, add a third copy of a string, delete a doc comment's opener, give two
   files the same number) and run both again: both must report each break. Throw the
   scratch copy away. If the rule covers only part of the script (a migrations script
   that also checks a journal), replace only that part and keep the rest.
   Delete the script, its `command` rule and any dependency only it used, only after
   parity holds.

8. Every exception needs a reason. Carry the script's allowlist over to the rule's
   `allow`, entry by entry, each with a "reason" that says why the copy is kept. Do not
   add entries for things the script did not allow. An entry the rule reports as no
   longer needed is stale: remove it.

9. If this repository has canaries (fixtures that break each check on purpose, so a
   check that stops firing is noticed), add one per new rule, following how the
   existing canaries are written, and make sure each one fires.

10. Finish with `chaperone check` exiting 0, and summarise: the launcher you installed
   (if any), the pin (from which version to which), each place that named a version
   and what replaced it, the wrapper script you replaced with the parity evidence
   (both versions, both exit codes, the results diff), what newly failed and how you
   fixed it, each script you replaced with a rule (with the parity evidence: what both
   reported, on the tree and on the break), each script you kept or kept in part and
   why, any allow entries and their reasons, and anything still reported as skipped or
   "matched no files".
```
