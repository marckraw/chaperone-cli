# Chaperone

**Don't let your AI ship unsupervised.**

Chaperone is a deterministic CLI that enforces project-specific rules that TypeScript and ESLint don't cover — things like file structure, naming conventions, required exports, file pairing, allowed patterns, architectural boundaries and repo "invariants".

It's designed to work **alongside** your existing TypeScript + ESLint setup, not replace them. Initialize once, define your rules in a config file, and run it locally, in CI, or from your AI coding agent.

## Why Chaperone?

In AI-assisted workflows, code gets generated fast — but it doesn't always follow your project's conventions. Chaperone acts as your repo's "adult supervision", verifying changes comply with your rules before they're committed or merged.

**TypeScript** catches type errors. **ESLint** catches style issues. **Chaperone** catches everything else:

- 📁 Directory structure requirements and retired locations
- 📛 File and export naming conventions
- 🔗 File pairing rules (e.g., every `.pure.ts` needs a `.pure.test.ts`)
- 🧱 Architectural layer boundaries and public APIs (aliases like `@/…` included)
- 🚫 Forbidden patterns and imports
- ✅ Custom repo invariants

Chaperone is built to be trusted: an invalid configuration fails loudly (exit code 2) instead of being ignored, a tool that crashes is reported as an error instead of a pass, and a report never says a bare `PASSED` when something was skipped.

## Installation

Chaperone ships as a single self-contained executable — no runtime, no dependencies. Pick the method that suits you.

### Quick Install (recommended)

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | sh
```

With a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=0.3.0 sh
```

The version the project in the current directory pins (meant for CI; see [In CI](#in-ci)):

```bash
curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=pinned sh
```

Custom install directory:

```bash
curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_INSTALL_DIR="$HOME/.local/bin" sh
```

The install script auto-detects your OS and architecture, downloads the correct binary, verifies the SHA256 checksum, and installs it. If `/usr/local/bin` is not writable, it falls back to `~/.local/bin`. Since 0.10 the binary you install is also a launcher: a repository that pins another version runs that version, so installing a newer `chaperone` no longer changes what every repository on the machine runs.

**Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri "https://github.com/marckraw/chaperone-cli/releases/latest/download/chaperone-windows-x64.exe" -OutFile "$env:LOCALAPPDATA\chaperone.exe"
# Add $env:LOCALAPPDATA to your PATH, or move chaperone.exe somewhere already in PATH
```

### Manual Download

1. Go to the [latest release](https://github.com/marckraw/chaperone-cli/releases/latest)
2. Download the binary for your platform:

   | Platform | Binary |
   |----------|--------|
   | macOS (Apple Silicon) | `chaperone-darwin-arm64` |
   | macOS (Intel) | `chaperone-darwin-x64` |
   | Linux (x64) | `chaperone-linux-x64` |
   | Linux (ARM64) | `chaperone-linux-arm64` |
   | Windows (x64) | `chaperone-windows-x64.exe` |

3. Make it executable and move to your PATH:
   ```bash
   chmod +x chaperone-*
   sudo mv chaperone-* /usr/local/bin/chaperone
   ```

### Verify Installation

```bash
chaperone --version
```

### From Source

```bash
# Clone the repository
git clone https://github.com/marckraw/chaperone-cli.git
cd chaperone-cli

# Install Bun if you haven't already
# https://bun.sh/docs/installation
bun install

# Run directly
bun run src/cli.ts --help

# Or build a standalone executable
bun run build
./bin/chaperone-darwin-arm64 --help  # macOS Apple Silicon
```

## Quick Start

```bash
# Initialize Chaperone in your project
chaperone init

# Check your codebase against the rules
chaperone check
```

The `init` command scans your project, detects existing tools (TypeScript, ESLint, Prettier, package manager), and creates a `.chaperone.json` config file, pinned to the version that wrote it.

## Pinning a version

Each repository pins the Chaperone it runs, the way `.nvmrc` works with fnm. One field in `.chaperone.json` does it:

```json
{
  "chaperoneVersion": "0.10.0",
  "version": "1.0.0",
  "rules": { "custom": [] }
}
```

`chaperone pin` writes the field for the version you have installed, `chaperone pin 0.9.0` for another one. Commit it like any other config change: upgrading Chaperone in a repository is then a one-line diff that CI checks, and upgrading the `chaperone` on your machine changes nothing in repositories that pin.

### How it works

The `chaperone` you install is also a launcher. Before anything else, it reads `chaperoneVersion` from the config the command would load: `.chaperone.json` in the working directory, or the files `--cwd` and `--config` name, as `check` reads them. Then:

- **The pin names this binary's version:** it runs, as before. Nothing is downloaded.
- **The pin names another version:** it runs that version instead, with the same arguments, stdio, environment and working directory. Its exit code is the run's exit code (`2` included), and a signal that ends it ends the run. On macOS and Linux the pinned binary replaces the launcher's process (exec), so nothing stays in between; on Windows it runs as a child, gets Ctrl-C from the console itself, and the launcher passes its exit code on. The first time, the launcher downloads the release binary for your platform from GitHub, checks it against the release's `SHA256SUMS.txt`, and keeps it in the cache; from then on it works offline. Handing over to a cached version costs about one extra binary start: tens of milliseconds.
- **No pin:** it runs, as before. A text report on a terminal ends with a one-line tip to pin; the tip never appears with `--format json` or `ai`, with `--quiet`, or when stderr is not a terminal (CI, agents).
- **Pins older than the launcher work:** a pin like `0.9.0` runs 0.9.0, which knows nothing of pins. It reports `unknown field "chaperoneVersion" is ignored` as a configuration warning, which never changes the exit code.

**It never runs a different version.** When the pinned version is not cached and cannot be installed (no network, a checksum that does not match, a version with no release, a platform with no binary), or the cached binary cannot be run (a cache on a filesystem mounted `noexec`), nothing runs: the launcher explains what happened and what to do on stderr, and exits with code `2`. With `check --format json`, stdout carries the reason as one JSON document (`"error": "pinned-version-unavailable"`).

### The `chaperoneVersion` field

- An exact version: `MAJOR.MINOR.PATCH`, with an optional pre-release (`0.11.0-rc.1`). `v0.10.0` is accepted and means `0.10.0` (the release tagged `v0.10.0`); `chaperone pin` writes the version without the `v`.
- Anything else stops the run with exit code `2`, with a suggestion where one fits: `"chaperoneVersion" must be an exact version, such as "0.10.0", not a range (got "^0.9") (did you mean "0.9.0"?)`. Ranges and `latest` are refused because the version would change under you.
- A misspelled field (`chaperone_version`, `chaperoneVerison`) is an error rather than an unknown-field warning: it would pin nothing.
- Only the project's own config counts. A preset (`extends`) cannot pin, and saying so is an error.

### Commands

| Command | What it does |
|---------|--------------|
| `chaperone --version` | The version that runs here first, then the launcher's: `chaperone v0.9.0 (pinned in .chaperone.json, launched by v0.10.0)`. Without a pin, `chaperone v0.10.0 (not pinned: ...)`; without a config, `chaperone v0.10.0`. |
| `chaperone pin [version]` | Writes `chaperoneVersion` (this binary's version by default), keeping the file's formatting. Another version is downloaded and verified first, so a pin that cannot be installed is never written. |
| `chaperone cache` | Lists the cached versions. `chaperone cache clear [version]` removes them (only files Chaperone wrote). |

`version`, `pin` and `cache` are the launcher's own commands and work whatever the pin says. Every other command, `help` included, runs in the pinned version.

### Cache and environment

Pinned versions are kept in `<cache>/<version>/chaperone-<os>-<arch>`, where `<cache>` is the first of:

| Location | When |
|----------|------|
| `$CHAPERONE_CACHE_DIR` | when set |
| `$XDG_CACHE_HOME/chaperone` | when `XDG_CACHE_HOME` is set (an absolute path) |
| `%LOCALAPPDATA%\chaperone\cache` | Windows |
| `~/.cache/chaperone` | macOS and Linux (not `~/Library/Caches` on macOS, which the system may purge when the disk runs low: a purged pin would fail offline) |

A download goes to a temporary file next to its final path and is renamed into place only once its checksum matches, so two runs at once (parallel CI jobs, a pre-push hook while you run a check) cannot leave a half-written binary.

| Variable | Effect |
|----------|--------|
| `CHAPERONE_CACHE_DIR` | Where pinned versions are kept. |
| `CHAPERONE_RELEASES_URL` | Download from a mirror laid out as `<url>/v<version>/<file>` (default `https://github.com/marckraw/chaperone-cli/releases/download`). |
| `CHAPERONE_IGNORE_PIN=1` | Run the installed version even though the repository pins another one, with a note on stderr: to try an upgrade before pinning it, or to run a development build. |
| `CHAPERONE_LAUNCHED` | Internal: tells a launched version not to launch again (it removes it from its environment, so the commands it runs do not inherit it). |

The pinned version does not print "update available": the pin chose it. In a repository pinned to the version you have installed, the notice says how to move the pin (`chaperone pin <latest>`).

### In CI

Install exactly the pinned version, in one line, and run it:

```yaml
- name: Install Chaperone (the version .chaperone.json pins)
  run: curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=pinned sh
- name: Run Chaperone
  run: chaperone check --format ai
```

`CHAPERONE_VERSION=pinned` (or `install.sh --version pinned`, plus `--config <path>` for another config file) reads `chaperoneVersion` from `.chaperone.json`. The install script reads the pin only when asked, because it installs the machine's global `chaperone`. For the same reason it installs a pin older than 0.10, which has no launcher, only when `CI` is set: as a workstation's `chaperone` it would run that version in every repository, whatever each one pins. On a workstation, install the launcher instead (`sh install.sh`), which runs each repository's pin; `--version 0.9.0` still installs 0.9.0 explicitly. On a self-hosted runner that several repositories share, prefer the launcher too, or `--install-dir` a directory of the job's own. An installed launcher of any version works in CI as well: it downloads the pinned version on the first run.

## Usage

```bash
chaperone init                 # Create .chaperone.json (interactive)
chaperone init --yes           # Non-interactive, defaults
chaperone init --dry-run       # Preview the config without writing it

chaperone check                # Check the codebase
chaperone check --format ai    # Markdown report for AI agents
chaperone check --format json  # Machine-readable report
chaperone check --since origin/master   # Custom rules only look at changed files

chaperone analyze              # Extract rules from CLAUDE.md, AGENTS.md, ...

chaperone pin                  # Pin this version in .chaperone.json
chaperone pin 0.9.0            # Pin another version (downloaded and verified first)
chaperone cache                # List the versions downloaded for pins
chaperone cache clear          # Remove them

chaperone help
chaperone version              # The version that runs here, and the launcher's
```

### `check` options

| Option | Description |
|--------|-------------|
| `--config, -c <path>` | Config file path (default: `.chaperone.json`) |
| `--cwd <path>` | Working directory (default: current directory) |
| `--fix` | Let ESLint and Prettier fix what they can. The tools then run one at a time (ESLint, Prettier, TypeScript) and the custom rules run after them. |
| `--format, -f <type>` | `text` (default), `json` or `ai` |
| `--quiet, -q` | List only errors, in every format (counts still include warnings) |
| `--no-warnings` | Drop warnings entirely |
| `--copy` | Copy the remaining problems to the clipboard (ai format) |
| `--no-progress` | Disable the progress spinner |
| `--debug` | Print rule execution details (to stderr) |
| `--since <git-ref>` | Custom rules only check files changed since the merge base of `<git-ref>` and `HEAD`, plus uncommitted and untracked files. Layer membership, module discovery and symbol targets still use every file, as do `unique-capture`, `repeated-literal` and `duplicate-code`, which count and compare every file but report only what involves a changed one; `package-fields` and `command` rules always run; TypeScript, ESLint and Prettier still check the whole project. The report says the run was limited. |

Unknown options, missing option values and unknown `--format` values are usage errors (exit code 2).

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | The check passed (warnings do not fail it) |
| `1` | The check ran and found at least one error |
| `2` | Chaperone could not do its job: invalid configuration, usage error (unknown option, bad value, unknown command, bad `--since` ref), a pinned version that cannot be installed, or internal error. Nothing is reported as passed. |

### Output and environment

- Results go to **stdout**; progress, debug output and notices go to **stderr**.
- `--format json` and `--format ai` never contain ANSI escape codes; `json` output is always a single JSON document (also for configuration errors), so `chaperone check --format json | jq` works.
- Text output is coloured only on an interactive terminal. `NO_COLOR` disables colours, `FORCE_COLOR=1` forces them.
- The progress spinner only appears for text output on an interactive terminal.
- Chaperone checks GitHub for a newer release once a day. Set `CHAPERONE_NO_UPDATE_CHECK=1` to switch this off (it is also off when `CI` is set).

## Configuration

`.chaperone.json`:

```json
{
  "chaperoneVersion": "0.10.0",
  "version": "1.0.0",
  "extends": ["chaperone/pure-functions", "./tools/chaperone/team-preset.json"],
  "include": ["src/**/*"],
  "exclude": ["generated", "src/legacy/**"],
  "rules": {
    "typescript": { "enabled": true },
    "eslint": { "enabled": true },
    "prettier": { "enabled": false },
    "custom": []
  }
}
```

| Field | Description |
|-------|-------------|
| `chaperoneVersion` | The Chaperone version this repository runs (see [Pinning a version](#pinning-a-version)). Only in the project's own config, not in presets. |
| `version` | Config format version (`"1.0.0"`). |
| `extends` | Presets to build on, in order: `"chaperone/<name>"` for built-in presets, `"./path.json"` / `"../path.json"` for local files (a local preset's own `extends` resolve relative to that preset's file). |
| `include` | Globs used for the "Files checked" count. Rules use their own `files` globs. |
| `exclude` | Extra exclude patterns, **added to** the defaults (see below). Excluded directories are never read. |
| `rules.typescript` / `rules.eslint` / `rules.prettier` | `{ "enabled": boolean, "args": string[] }` for the tool runners. |
| `rules.custom` | Custom rules (see [Custom rule types](#custom-rule-types)). |
| `integrations.useTypescriptPaths` | Resolve tsconfig `paths`/`baseUrl` aliases in import rules (default `true`). `respectEslintIgnore` and `respectPrettierIgnore` are accepted for compatibility but have no effect; `chaperone init` no longer writes them. |
| `aiInstructions` | Which instruction files `chaperone analyze` reads. |
| `project` | Informational tool detection written by `chaperone init`. |

### Excludes

Exclude patterns (global `exclude` and each rule's `exclude`) follow `.gitignore` conventions:

- `node_modules` and `.git` (at any depth) plus `/dist` and `/build` (at the project root) are **always** excluded. Your `exclude` list, and those of your presets, are added to these.
- A pattern without a slash matches a file or directory name at any depth: `dist` matches `dist/` and `packages/x/dist/`, but not `distribution/`.
- A pattern with a slash, or a leading `/`, is anchored to the project root: `src/generated`, `/build`.
- Excluding a directory excludes everything below it; `src/generated`, `src/generated/` and `src/generated/**` are equivalent.
- For each file or directory the last matching pattern wins, so `!pattern` re-includes something an earlier pattern (including a default) excluded, e.g. `"exclude": ["build", "!src/build"]`. As in `.gitignore`, nothing below an excluded directory can be re-included: re-include the directory itself.
- Directories and files that cannot be read (for example because of permissions) are listed in the report as not checked, and `check --cwd` with a missing directory exits 2.

### Globs

Globs (`files`, `allowedIn`, layer `files`, ...) are matched against paths relative to the project root:

- `*` matches within one path segment (dotfiles included), `**` matches any number of directories, `src/**` matches everything below `src`.
- Braces work everywhere: `src/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`, even nested `{a,{b,c}}`.
- `+`, `(` and `)` are literal (`src/routes/+page.svelte`, `src/app/(marketing)/**`). `[abc]` is a character class; a literal path such as `src/app/[id]/page.tsx` also matches itself, and brackets can be escaped with a backslash (written `"src/app/\\[id\\]/**"` in JSON).

### Validation

Every config source — your file, local presets and built-in presets — is validated when it loads, and every problem is reported at once.

**Errors** stop the run with exit code 2 and nothing is checked:

- unknown rule types (with a suggestion, e.g. `unknown rule type "regexp" (did you mean "regex"?)`);
- rule types removed in chaperone 0.5.0, with migration advice (see [Removed rule types](#removed-rule-types));
- invalid severities (`"severity" must be one of "error", "warning" (got "eror") (did you mean "error"?)`);
- missing or mistyped fields, named with the rule id (`.chaperone.json › rules.custom[3].files (rule "no-console"): missing required field "files"`);
- invalid regular expressions (compiled with the rule's flags) and invalid globs (unbalanced braces or brackets);
- rules that define nothing to check, and import-boundary layers that allow imports from unknown layers;
- unknown built-in presets, missing preset files and circular `extends`;
- a `chaperoneVersion` that is not an exact version (with a suggestion), a misspelled `chaperoneVersion` field, and a `chaperoneVersion` in a preset.

**Warnings** are shown with the results and never change the exit code:

- unknown fields, with "did you mean" suggestions (`unknown field "mustmatch" is ignored (did you mean "mustMatch"?)`);
- deprecated options (`"forbidden" is deprecated; use "mustMatch": false instead`);
- regex patterns that can match an empty string (e.g. a trailing `|`);
- duplicate rule ids in one file, and `disabled` entries that do not switch anything off.

### Removed rule types

These types were removed in chaperone 0.5.0. Configs that still use them now fail with exit code 2 instead of being silently skipped:

| Removed type | Use instead |
|--------------|-------------|
| `relationship` | `file-pairing` for companion files (`mustHaveCompanion` → `files` + `pair: { from, to }` + `mustExist: true`), `file-contract` for content (`fileMustContain`/`fileMustNot` → `requiredPatterns`/`forbiddenPatterns`, `maxLines` → `assertions.maxLines`, `mustImport`/`mustNotImport` → `assertions.mustImport`/`mustNotImport`) |
| `file-naming` | `file-pairing`: rename `pattern` to `files`, replace `requireCompanion.transform` with `pair: { from, to }` |
| `file-suffix-content` | `file-contract`: put the suffix in `files` (`"src/**/*.presentational.tsx"`) and use plain regex strings in `requiredPatterns`/`forbiddenPatterns` |
| `file-structure` | No direct replacement: `file-pairing` (`mustExist: true`) for required companions, `retired-path` for unwanted locations, or a `command` rule |

See [MIGRATION.md](./MIGRATION.md) for before/after examples.

## Custom Rule Types

Custom rules live in `rules.custom`. Every rule has these common fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | One of the 17 types below. |
| `id` | `string` | Yes | Unique identifier. A rule with the same id as a preset rule replaces it. |
| `severity` | `"error" \| "warning"` | Yes | Errors make `check` exit with 1; warnings are only reported. |
| `exclude` | `string[]` | No | Extra exclude patterns for this rule (same semantics as the global `exclude`). |
| `disabled` | `boolean` | No | `true` switches the rule off (also rules inherited from presets). A disabled entry only needs `id`. |
| `message` | `string` | No* | Custom violation message (*required for `regex`). For `comment-integrity`, `unique-capture`, `repeated-literal` and `duplicate-code`, the finding follows in parentheses. |
| `source`, `originalText` | `string` | No | Written by `chaperone analyze` to trace a rule to its instruction. |

A rule whose file globs match no files at all is reported as **"matched no files, so it checked nothing"** in every output format, and the status line says `PASSED, but not everything was checked`. That usually means a typo in the glob.

### `regex`

Forbid (default) or require a pattern in files.

```json
{
  "type": "regex",
  "id": "no-default-exports",
  "severity": "error",
  "files": "src/**/*.{ts,tsx}",
  "pattern": "^\\s*export\\s+default\\b",
  "message": "Use named exports only"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Glob for files to scan. |
| `pattern` | Yes | JavaScript regular expression. |
| `message` | Yes | Violation message. |
| `mustMatch` | No | `false` (default): the pattern must not appear. `true`: every file must contain it. |
| `flags` | No | RegExp flags. **Default `"m"`**, so `^` and `$` match at every line start and end. Setting `flags` replaces the default: `""` makes `^`/`$` match only the start/end of the file, `"im"` adds case-insensitive matching. `g` is always added; supported: `d`, `i`, `m`, `s`, `u`, `v`. |
| `reportOnce` | No | Report only the first match per file. |
| `forbidden` | No | **Deprecated** alias: `forbidden: true` means `mustMatch: false` (a warning suggests the replacement). |

Each violation points at the first non-whitespace character of the match and includes the matched text and the surrounding lines. A pattern that can match an empty string, such as `TODO|`, would match everywhere: validation warns about it and its zero-length matches are ignored, so only real `TODO`s are reported. Lookaheads such as `(?=console\.log)` work normally.

### `file-pairing`

Map each matched file to a companion path and require (or forbid) it.

```json
{
  "type": "file-pairing",
  "id": "migration-has-validator",
  "severity": "error",
  "files": "src/storyblok/migrations/**/*.sb.migration.ts",
  "pair": { "from": "\\.sb\\.migration\\.ts$", "to": ".validation.ts" },
  "mustExist": true,
  "requireTransformMatch": true,
  "message": "Each runnable migration must have a co-located validator"
}
```

- `pair.from` (regex, applied to the relative path) and `pair.to` (replacement) are required.
- `mustExist` (default `true`): `false` forbids the companion.
- `requireTransformMatch` (default `true`): report files that `pair.from` does not match.

### `file-contract`

Deterministic content contracts per file, including filename-derived placeholders and semantic assertions. At least one pattern list or `assertions` is required.

```json
{
  "type": "file-contract",
  "id": "validator-id-and-name-match-file",
  "severity": "error",
  "files": "src/storyblok/migrations/**/*.validation.ts",
  "captureFromPath": { "pattern": "([^/]+)\\.validation\\.ts$", "group": 1 },
  "requiredPatterns": ["defineMigrationValidation\\s*\\(", "export\\s+default\\s+"],
  "requiredAnyPatterns": ["ruleSet\\s*:", "validateData\\s*:", "validateFile\\s*:"],
  "templatedRequiredPatterns": ["id\\s*:\\s*['\"]{{capture}}['\"]"],
  "assertions": { "maxLines": 200, "mustNotImport": ["@tauri-apps/*", "react-dom"] }
}
```

| Field | Description |
|-------|-------------|
| `requiredPatterns` / `requiredAnyPatterns` / `forbiddenPatterns` | Regex lists: all must match / at least one must match / none may match. |
| `captureFromPath` | `{ pattern, group?, source?: "path" \| "basename" }` captures part of the path for `{{capture}}`. |
| `templatedRequiredPatterns` / `templatedRequiredAnyPatterns` / `templatedForbiddenPatterns` | Same as above with `{{capture}}` (escaped) substituted. |
| `assertions` | See below. |

| Assertion | Type | Description |
|-----------|------|-------------|
| `firstLine` | `string` | First non-empty, non-comment line must match this regex. |
| `mustExportDefault` | `boolean` | File must have `export default`. |
| `mustExportNamed` | `boolean` | File must have at least one named export. |
| `mustNotImport` | `string[]` | Modules that must not be imported (`*` wildcard). Static, side-effect, re-export, dynamic and `require()` imports all count; commented-out ones do not. |
| `mustImport` | `string[]` | Modules that must be imported. |
| `maxLines` / `minLines` | `number` | Line count limits. A trailing newline does not count as an extra line. |
| `mustHaveJSDoc` | `boolean` | Exported functions must have JSDoc comments. |
| `maxExports` | `number` | Maximum number of exports. |
| `mustBeModule` | `boolean` | File must have at least one `import` or `export`. |

### `package-fields`

`package.json` invariants. At least one of `requiredFields`, `forbiddenFields` or `fieldPatterns` is required. Dot notation reaches nested fields.

```json
{
  "type": "package-fields",
  "id": "require-scripts",
  "severity": "error",
  "requiredFields": ["scripts.build", "scripts.test"],
  "forbiddenFields": ["private"],
  "fieldPatterns": { "scripts.build": "^bun " }
}
```

### `component-location`

Keep presentational (no hooks/state/effects/fetching) or stateful components in the expected folders.

```json
{
  "type": "component-location",
  "id": "presentational-in-ui",
  "severity": "error",
  "files": "src/**/*.tsx",
  "componentType": "presentational",
  "requiredLocation": "src/components/ui/**",
  "mustBeIn": true
}
```

- `componentType` (`"presentational"` or `"stateful"`), `requiredLocation` and `mustBeIn` are required.
- `requiredLocation` is a directory (`src/components/ui` or `src/components/ui/`: files inside it, not `src/components/ui-kit`) or a glob matching the file or one of its parent directories (`src/components/ui/**`, `src/features/*/ui`).

### `react-component-count`

Cap how many top-level React components a file may define.

```json
{
  "type": "react-component-count",
  "id": "single-react-component",
  "severity": "error",
  "files": "src/**/*.{tsx,jsx}",
  "exclude": ["**/*.test.{tsx,jsx}", "**/*.stories.{tsx,jsx}"],
  "maxComponents": 1,
  "ignoreNames": ["Provider"]
}
```

A component is a top-level PascalCase declaration that renders JSX (or calls `createElement`): function declarations (also default-exported), class components extending `Component`/`PureComponent`, arrow and function expressions, and `memo(...)`/`forwardRef<...>(...)` wrappers. Destructured props, return type annotations, generics and JSX text are handled; nested helpers do not count.

### `command`

Run a command and check its exit code and output.

```json
{
  "type": "command",
  "id": "unit-tests-pass",
  "severity": "error",
  "command": "bun",
  "args": ["test", "--bail"],
  "expectedExitCode": 0,
  "timeoutMs": 60000,
  "message": "Unit tests must pass"
}
```

Optional: `args`, `cwd` (relative to the project), `timeoutMs` (default 30000), `expectedExitCode` (default 0), `stdoutPattern`, `stderrPattern`. A command that cannot be started or times out is always reported with the reason.

### `symbol-reference`

Ensure exported functions are referenced in target files (for example, pure functions in their unit tests).

```json
{
  "type": "symbol-reference",
  "id": "pure-functions-tested",
  "severity": "error",
  "sourceFiles": "src/**/*.pure.ts",
  "targetFiles": "src/**/*.pure.test.ts",
  "targetPair": { "from": "\\.pure\\.ts$", "to": ".pure.test.ts" },
  "symbolKinds": ["function-declaration", "function-variable"],
  "message": "Exported pure functions must be referenced in sibling unit tests"
}
```

- `function-declaration`: `export function f`, `export async function f`, `export function* f`, `export function f<T>()`.
- `function-variable`: `export const f = (...) => ...`, `export const f = function ...`, typed variables (`export const f: Fn = ...`), generic arrows (`<T,>(x: T) => ...`) and parameters with nested parentheses (`(x = g(1)) => ...`).
- Default exports are not checked. Options: `targetPair`, `symbolPattern` (regex filter), `ignoreSymbols`.

### `retired-path`

Prevent files in deprecated or legacy locations. Catches AI agents that create files in old places.

```json
{
  "type": "retired-path",
  "id": "no-legacy-dirs",
  "severity": "error",
  "paths": [
    { "pattern": "src/components/**/*", "reason": "Use layered architecture", "migratedTo": "src/features/<feature>/ui/" },
    { "pattern": "src/{hooks,lib}/**", "migratedTo": "src/shared/" }
  ]
}
```

Each `paths` entry needs a `pattern`; `reason` and `migratedTo` are optional. (A retired location with no files is the goal, so this rule never reports "matched no files".)

### `forbidden-import`

Restrict which files may import a module or use a code pattern.

```json
{
  "type": "forbidden-import",
  "id": "tauri-api-boundary",
  "severity": "error",
  "files": "src/**/*.{ts,tsx}",
  "restrictions": [
    { "source": "^@tauri-apps/", "allowedIn": ["src/**/*.api.ts"], "message": "Tauri APIs can only be used in .api.ts files" }
  ],
  "checkPatterns": [
    { "pattern": "\\binvoke\\s*\\(", "allowedIn": ["src/**/*.{api,bridge}.ts"], "message": "invoke() only in .api.ts files" }
  ],
  "includeTypeImports": false
}
```

- At least one `restrictions` or `checkPatterns` entry is required. `allowedIn` defaults to `[]` (allowed nowhere) and supports braces.
- `source` is a regex matched against the import specifier as written. Static imports, side-effect imports (`import "x"`), re-exports (`export * from`, `export { x } from`), dynamic `import("x")` and `require("x")` are all checked; imports in comments, strings and template literals are not.
- `includeTypeImports` (default `false`): type-only imports (`import type`, `export type { X } from`, `import { type X }` when every specifier is a type, `typeof import("x")`) are ignored unless enabled.

### `import-boundary`

Enforce architectural layers.

```json
{
  "type": "import-boundary",
  "id": "fsd-layers",
  "severity": "error",
  "layers": {
    "shared":   { "files": "src/shared/**/*.{ts,tsx}",   "allowImportsFrom": [] },
    "entities": { "files": "src/entities/**/*.{ts,tsx}", "allowImportsFrom": ["shared"] },
    "features": { "files": "src/features/**/*.{ts,tsx}", "allowImportsFrom": ["shared", "entities"] },
    "widgets":  { "files": "src/widgets/**/*.{ts,tsx}",  "allowImportsFrom": ["shared", "entities", "features"] },
    "app":      { "files": "src/app/**/*.{ts,tsx}",      "allowImportsFrom": ["shared", "entities", "features", "widgets"] }
  }
}
```

- Each layer needs `files` and `allowImportsFrom` (names of other layers; unknown names are errors). Imports within a layer are always allowed.
- Every import that resolves to a project file is checked: relative paths, directory imports (`../features/auth` → `index.ts`), `.js` specifiers for `.ts`/`.tsx` sources, and **tsconfig `paths`/`baseUrl` aliases** such as `@/features/auth` (from the nearest `tsconfig.json`/`jsconfig.json` above the importing file, following `extends` and project `references`). Packages are ignored. Set `integrations.useTypescriptPaths: false` to stop resolving aliases.
- When a file matches several layers, the layer listed **last** wins. Layers with no files, layers whose files all belong to a later layer, and alias-like imports (`@/…`, `~/…`, `#…`) that no tsconfig `paths` entry resolves are reported as notices.
- `includeTypeImports` (default `true`) and `includeDynamicImports` (default `true`).

### `public-api`

Modules must be imported through their barrel file, not via deep imports.

```json
{
  "type": "public-api",
  "id": "feature-public-api",
  "severity": "error",
  "modules": "src/features/*",
  "files": "src/**/*.{ts,tsx}",
  "barrelFile": "index.ts",
  "allowSameModule": true
}
```

- `modules` (glob for module directories, `**` allowed: `src/**/features/*`) and `files` are required. A `modules` glob that matches no directory is reported as checking nothing.
- `import { login } from "../features/auth"` and `from "@/features/auth"` resolve to the barrel and pass; `from "@/features/auth/model/login"` is a deep import. The barrel may use any extension (`index.ts`, `index.tsx`, `index.js`).
- `barrelFile` (default `index.ts`), `allowSameModule` (default `true`: deep imports inside the same module are fine).

### `directive-export-pattern`

In files that start with a directive (such as `"use client"`), every runtime named export must match one of the allowed name patterns.

```json
{
  "type": "directive-export-pattern",
  "id": "use-client-exports",
  "severity": "error",
  "files": "src/**/*.{ts,tsx}",
  "directive": "use client",
  "allowedExportNamePatterns": ["^[A-Z][A-Za-z0-9]*$", "^use[A-Z][A-Za-z0-9]*$"],
  "message": "Files marked \"use client\" should export only components or hooks"
}
```

Type-only exports and default exports are not checked; `export { a as b }`, `export * as ns from` and enums are.

The next four types catch what review lets through: what a merge breaks (`comment-integrity`, `unique-capture`) and copies (`repeated-literal`, `duplicate-code`). They report the same way: each finding once, with every place it involves under "Locations" (`context.locations` in JSON), and a `message` comes first with the finding in parentheses after it.

### `comment-integrity`

Block comments a merge broke, in JavaScript and TypeScript files: a doc comment that lost its `/**` (its remaining lines now sit in code, and the compiler stops far from the cause), one that lost its `*/` (the next comment opens inside it, and whatever lay between them disappears into one comment with no error at all), and a comment that never closes.

```json
{
  "type": "comment-integrity",
  "id": "merge-broken-comments",
  "severity": "error",
  "files": "{apps,packages,scripts}/**/*.{ts,tsx,mts,js,mjs,jsx}",
  "message": "A merge broke a comment"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Glob for JavaScript and TypeScript files to scan. |

- **What counts:** a line that reads like a comment's middle or end (`* text`, `*/`) with no comment open, reported once per run of such lines; a line inside a comment that opens another (`/*` at its start), reported with both lines under "Locations"; and a comment that never closes. Strings, template literals, regular expressions and JSX text may hold `/*` or lines starting with `*` without counting.
- **Reports:** each problem at its line (`A comment opens inside the comment from line 4: a merge may have dropped that one's */`). Under `--since`, only changed files are read.
- **Limits:** it reads the file as a tokenizer does, not as a compiler: it finds comments a merge broke, not every syntax error.

### `unique-capture`

No two files may capture the same key from their paths: numbered files that two branches add at once, such as migrations (two `0016_*.sql` after a merge) or ADRs.

```json
{
  "type": "unique-capture",
  "id": "migration-numbers",
  "severity": "error",
  "files": "packages/db/drizzle/*.sql",
  "capture": { "pattern": "^(\\d{4})_[a-z0-9_]+\\.sql$", "source": "basename" },
  "message": "Two migrations share a number: generate yours again after the other branch's"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Glob for the files whose keys must be unique. |
| `capture.pattern` | Yes | Regex applied to each path (or file name) that captures the key. Files it doesn't match are ignored. |
| `capture.group` | No | The capture group holding the key (default `1`). |
| `capture.source` | No | `"path"` (default) or `"basename"`: what the pattern is applied to. |

- **Reports:** each shared key once, at its first file in path order (`2 files share the key "0016"`), with every file that shares it under "Locations". Under `--since`, a key is reported when one of its files changed; every file still counts.
- **Limits:** it compares paths, not contents. A migration tool's other invariants (a journal's order, a snapshot chain, a migration that lost its statements) need their own checks.

### `repeated-literal`

The same string literal may appear at most `maxOccurrences` times across the matched files: "duplicate on purpose up to twice; extract on the third use". Made for Tailwind class strings, and as useful for error messages, route paths or any magic string.

```json
{
  "type": "repeated-literal",
  "id": "repeated-classes",
  "severity": "error",
  "files": "{apps,packages}/*/src/**/*.{ts,tsx}",
  "exclude": ["**/*.test.{ts,tsx}", "**/*.stories.tsx"],
  "minTokens": 4,
  "contextPattern": "\\bclassName\\s*=|(?:^|[^\\w$.])(?:cn|cva)\\s*\\(",
  "contextFiles": ["**/*.styles.ts"],
  "ignoreOrder": true,
  "maxOccurrences": 2,
  "allow": [
    { "literal": "flex min-w-0 flex-1 flex-col", "reason": "A text column in four unrelated parts: layout, not a look" }
  ],
  "message": "A class string of 4+ utilities appears more than twice: make it a part, a variant or a shared constant"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Glob for files to scan. |
| `literalPattern` | No | Regex the whole literal must match (it is anchored for you), after whitespace is normalized. Default: every literal. |
| `minTokens` | No | Fewest whitespace-separated tokens a literal needs to count (default `1`). With `4`, `"flex items-center"` repeats freely. |
| `contextPattern` | No | Where literals count (default: everywhere). See below. |
| `contextFiles` | No | Globs for files where every literal counts, whatever `contextPattern` says (e.g. `**/*.styles.ts`). |
| `ignoreOrder` | No | `true`: literals with the same tokens in any order are the same (`"b a"` is `"a b"`), and a token repeated inside a literal counts once. Default `false`. |
| `maxOccurrences` | No | Most occurrences allowed (default `2`): the third fails. |
| `allow` | No | `[{ "literal": "...", "reason": "..." }]`: literals kept on purpose. The reason is required. Entries are compared like the literals (normalized, and in any order with `ignoreOrder`); an entry that no longer excuses anything is reported, so the list can't outlive its reasons. |

- **What counts:** quoted strings, JSX attribute strings (`className="..."`) and template literals without `${...}`, compared after trimming and collapsing whitespace. **Never:** comments, templates with `${...}` (what they hold is known only when they run), module specifiers (`from "x"`, `import("x")`, `require("x")`, `declare module "x"`), directives (`"use client"`), and anything between `chaperone-ignore-start` and `chaperone-ignore-end` comments.
- **`contextPattern`** is a regex (flags `m`) matched against the code with comments, the text of every literal and JSX text blanked out, so it only ever finds code. A match that ends with `(`, `[` or `{`, or is followed by one, opens a context up to the matching bracket, and every literal inside counts (`cn(...)`, `cva(...)`, `className={...}`, with their ternaries and objects). Any other match counts the literal right after it (`className="..."`). Only where a match ends matters, so consume a character rather than use a lookbehind, which is slower: `(?:^|[^\w$.])cn\s*\(` rather than `(?<![\w$.])cn\s*\(`. A `contextPattern` that matches nowhere is reported as a notice.
- Each literal over the limit is reported once, at its first place, with every place as `path:line:column` (listed under "Locations"). Under `--since`, a literal is reported when one of its copies is in a changed file; every file is still counted, and an unused allow entry is reported either way.
- **Limits:** literals are read with Chaperone's JavaScript/TypeScript tokenizer (JSX included). Other C-family files work (`"..."`, `'...'`, `` `...` ``, `//` and `/* */` comments), but not syntaxes with other strings or comments (Python's `#` and triple quotes, for one). It compares text, not values: `"a b" + " c d"` is two literals, and a string built at runtime is none.

### `duplicate-code`

Copied code: a block of at least `minTokens` tokens that appears twice across the matched files. Renaming a variable breaks a copy where the name changes; reformatting, re-indenting and re-commenting do not hide one.

```json
{
  "type": "duplicate-code",
  "id": "copied-code",
  "severity": "error",
  "files": "{apps/*/src,packages/ui/src}/**/*.{ts,tsx}",
  "exclude": ["**/*.test.{ts,tsx}", "**/*.stories.tsx"],
  "minTokens": 100,
  "minLines": 5,
  "allow": [
    {
      "files": ["src/widgets/message-list.container.tsx", "src/widgets/thread-list.container.tsx"],
      "reason": "The same parts around the viewport, but different data; one part for both is a measured change of its own"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `files` | Yes | Glob for files to compare. |
| `minTokens` | No | Fewest tokens a copy has (default `100`). A pasted 30-line component is about 120 tokens; a few props or an import list stay under. |
| `minLines` | No | Fewest lines a copy spans, in either place (default `5`), so long one-line data does not count. |
| `allow` | No | `[{ "files": ["a", "b"], "reason": "..." }]`: copies kept on purpose between two files (paths or globs, in either order; the same file twice for a copy inside one file). The reason is required, and an entry that matches no copy is reported. |

- **Tokens:** identifiers, literals and punctuation are kept as they are; whitespace, line breaks and comments are dropped. Token counts follow jscpd (`===` is one token, `</` two, a template literal's text parts count), so a `minTokens` tuned for jscpd means the same here. Whitespace between JSX tags counts as one token, whatever its width.
- **Reports:** each copy is reported once, at the copy, with both places and their line ranges (`src/b.tsx:12-32` and `src/a.tsx:12-32`). Files are read in path order and every copy is reported against the block's first place, so a block in three files gives a–b and a–c, never b–c, and the same tree always gives the same report.
- **Ignore comments:** code between `chaperone-ignore-start` and `chaperone-ignore-end` comments is left out, and so is code between jscpd's `jscpd:ignore-start` and `jscpd:ignore-end`, so a jscpd setup moves over unchanged. Say why in the comment.
- Under `--since`, a copy is reported when either of its files changed; every file is still compared, and an unused allow entry is reported either way.
- **Speed:** a rolling hash (Rabin–Karp) over the tokens, with no dependency: about 0.2 s of work for 1,200 TypeScript files.
- **Unlike jscpd:** a copy between a `.ts` and a `.tsx` file counts (jscpd compares files of one format only); re-indented JSX is still a copy; a copy's last line is the line of its last token; and there is no `threshold` on the overall share of copied lines.

## Recipes

Rule types work best together. These are examples to adapt, not presets: the globs, the names and the limits are one project's.

### Keeping a design system's boundary

accent., a team chat, keeps its features from building by hand what its design system (`packages/ui`) already has. Its UI audit found that most of 146 findings had one cause: parts missing from the design system, so each feature built its own search field, empty state or header, and the copies drifted apart. Three kinds of rules now hold the line between the design system and the features:

1. **`regex`: a pattern that means "built by hand"**, with a message that names the part to use instead. One rule per job the design system owns:

   ```json
   {
     "id": "use-spinner",
     "type": "regex",
     "severity": "error",
     "files": "apps/*/src/**/*.{ts,tsx}",
     "exclude": ["**/*.test.{ts,tsx}"],
     "pattern": "\\banimate-spin\\b",
     "message": "A spinner built by hand: give the Button pending (with pendingLabel), or use Spinner from @accent/ui."
   }
   ```

2. **`repeated-literal`: a class string's third copy** is a part, a variant or a shared constant (the [`repeated-literal`](#repeated-literal) example above). A regex sees only what is written where it looks, so a look kept in a `*.styles.ts` constant passes the regex rules; `contextFiles` is what catches that constant's third copy.
3. **`duplicate-code`: a pasted component** fails on its second copy (the [`duplicate-code`](#duplicate-code) example above): a hundred identical tokens are never a coincidence of style, where two short class strings may be.

Roll each rule out as a `"warning"`, fix what it finds, put what stays on purpose in `allow` with a reason, and make it an `"error"` once it passes. The allow lists stay honest on their own: an entry that no longer excuses anything fails the check.

### Surviving merges

Agents resolving merge conflicts in accent. broke doc comments twice in one day (a `/**` lost, so the comment's lines became code; a `*/` lost, so a declaration vanished into the next comment), and two branches' migrations collided three times (two `0016`s, two `0017`s, two `0020`s). Neither fails a build where it happens, so two rules check for them:

```json
[
  {
    "id": "merge-broken-comments",
    "type": "comment-integrity",
    "severity": "error",
    "files": "{apps,packages,scripts}/**/*.{ts,tsx,mts,js,mjs,jsx}"
  },
  {
    "id": "migration-numbers",
    "type": "unique-capture",
    "severity": "error",
    "files": "packages/db/drizzle/*.sql",
    "capture": { "pattern": "^(\\d{4})_[a-z0-9_]+\\.sql$", "source": "basename" },
    "message": "Two migrations share a number: the branch that merged later generates its migration again"
  }
]
```

Run them in the pre-push hook as well as CI: a merge resolution is the moment they catch, and the sooner the better.

## Presets

Presets are shareable rule bundles used through `extends`:

```json
{
  "version": "1.0.0",
  "extends": ["chaperone/react-layered", "./tools/chaperone/team.json"],
  "rules": {
    "custom": [
      { "id": "preset/no-legacy-dirs", "disabled": true }
    ]
  }
}
```

- `"chaperone/<name>"` — a built-in preset; `"./path.json"` / `"../path.json"` — a local JSON file (same shape as `.chaperone.json`, optionally with `name` and `description`).
- Presets apply in order, then your own config. Rules with the same `id` replace earlier ones **entirely** (copy every field you want to keep); `{ "id": "...", "disabled": true }` switches an inherited rule off. `exclude` lists accumulate.

### Built-in presets

| Preset | What it enforces |
|--------|------------------|
| `chaperone/pure-functions` | Every `*.pure.ts` has a sibling `*.pure.test.ts` and vice versa; pure files have no side effects (`fetch`, timers, `console`, storage, `XMLHttpRequest`, `WebSocket`) and do not import `*.api` modules. |
| `chaperone/presentational-components` | `*.presentational.tsx` files use no effects (`useEffect`, `useLayoutEffect`, `useInsertionEffect`, `fetch`, `XMLHttpRequest`) and no stateful hooks (`useState`, `useReducer`, `useContext`, `useImperativeHandle`). |
| `chaperone/single-react-component-per-file` | At most one top-level React component per `*.tsx`/`*.jsx` file; test, spec, stories and story files are excluded. |
| `chaperone/package-essentials` | `package.json` has `dev`, `build`, `test` and `lint` scripts. |
| `chaperone/layered-architecture` | Feature-Sliced layers (`shared` → `entities` → `features` → `widgets` → `app`) under `src/`, public APIs for `src/features/*` and `src/entities/*`, and no files in `src/components`, `src/hooks` or `src/lib`. |
| `chaperone/react-layered` | The same layers plus presentational purity, pure-file purity, `.pure.test.ts` pairing (warning) and feature public APIs. |
| `chaperone/react-native-expo` | Files containing JSX use `.tsx`, no `console.log` (warning) and no inline style objects (warning) under `src/`; includes `src/**` and `app/**`, excludes `.expo` and the root `android` and `ios` projects. |
| `chaperone/react-server-components` | Files starting with `"use client"` export only components (`PascalCase`) and hooks (`useX`). |

## Tool runners

When configured, `check` also runs TypeScript (`tsc --noEmit`), ESLint (`eslint --format json .`) and Prettier (`prettier --check .`), concurrently with each other and with the custom rules. `command` rules start after the tools have finished (a command may write files), and with `--fix` the tools run one after another.

- A runner runs when its config exists in the project root (`tsconfig.json`; `eslint.config.{js,mjs,cjs,ts,mts,cts}`, `.eslintrc*` or `eslintConfig` in `package.json`; `.prettierrc*`, `prettier.config.*` or `prettier` in `package.json`) and its binary is found in `node_modules/.bin` (of the project or any parent directory) or on the `PATH`. Set `rules.<tool>.enabled: false` to skip one.
- Runners **fail closed**: a tool that exits with an error but reports nothing parseable (a crashed ESLint config, `tsc` error TS18003 "No inputs were found", a Prettier syntax error) is an error in the report, with the tool's output, never a pass. ESLint failing on warnings alone (`--max-warnings`) fails the check too.
- A skipped runner is always listed with the reason (`skipped: no ESLint config in the project root`), and a passing report says what was skipped.
- A "solution-style" `tsconfig.json` (`"files": []` plus `references`, as in the Vite templates) would make `tsc --noEmit` check nothing, so TypeScript is reported as skipped until you point it at a project: `"rules": { "typescript": { "args": ["-p", "tsconfig.app.json"] } }`.

## Reports

All three formats contain the same facts:

- status: `PASSED`, `PASSED, but not everything was checked: ...` (tools skipped, rules that matched no files, `--since`), or `FAILED`;
- each tool runner's status (passed, failed, skipped with the reason, or could not run) and duration;
- rules that matched no files, rule notices (empty or shadowed layers, modules globs without modules) and disabled rules;
- configuration warnings;
- the results, with context: matched text or offending import, expected vs actual, suggestions, command output, and every place a finding involves ("Locations": a copy and its original, a repeated literal's copies, the files that share a key, a comment opened inside another).

`--format json` adds machine-readable fields: `status` (`passed`, `passed-with-gaps`, `failed`), `gaps`, `runners`, `rules` (per-rule `status`, `filesChecked`, counts, notices), `disabledRules`, `diagnostics` and `since`, next to the existing `success`, `summary`, `results` and `bySource`.

`--format ai` is Markdown written for coding agents: results are grouped by rule with their context, capped at 20 per rule (with an "… and N more" line), and a "Not Fully Checked" section lists skipped rules.

## `chaperone analyze`

`chaperone analyze` reads AI instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, ...) and asks Claude (`ANTHROPIC_API_KEY`) to turn enforceable instructions into rules.

- It only produces `regex`, `file-pairing`, `file-contract`, `package-fields`, `component-location`, `command` and `symbol-reference` rules; structural rules are written by hand. Every extracted rule is validated with the same schema as `check`; invalid ones are listed with the reason.
- It patches **only your own config file**: `extends`, excludes and every other field are kept, presets are never inlined, and ids used by presets are not reused. If your config does not load, analyze stops before calling the API and writes nothing (exit code 2).
- `--dry-run` previews, `--force` replaces the rules analyze added before (those with `source`).

## CI Integration

```yaml
# GitHub Actions example
- name: Install Chaperone (the version .chaperone.json pins)
  run: curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_VERSION=pinned sh
- name: Run Chaperone
  run: chaperone check --format ai
```

Exit code 1 fails the job on errors; exit code 2 fails it on a broken configuration, or when the pinned version cannot be installed.

## Release Process

This repository uses **Changesets** for version control and **GitHub Actions** for binary releases.

Target branch: `master`

### 1) Feature PRs

For user-facing/code changes, include a changeset:

```bash
bun run changeset
```

The PR check (`Changeset Check`) enforces this for changes under `src/`, `build.ts`, or `package.json`. The `CI` workflow runs `bun test`, Chaperone's own `check`, the same check with the compiled binary, and the launcher's tests against the compiled binary (`CHAPERONE_TEST_BINARY=bin/<binary> bun test src/launcher/compiled.test.ts`).

### 2) Version PRs

On pushes to `master`, `Changeset Version PR` runs and opens/updates a version PR using `changesets/action`.

### 3) Binary Releases

After version bumps land on `master`, `Release Binaries`:
- reads `package.json` version,
- creates `v<version>` tag if missing,
- builds Bun executables for all targets,
- generates `SHA256SUMS.txt`,
- publishes assets to GitHub Releases.

Release assets include:
- `chaperone-darwin-arm64`
- `chaperone-darwin-x64`
- `chaperone-linux-x64`
- `chaperone-linux-arm64`
- `chaperone-windows-x64.exe`

The launcher of every released version downloads pins by these names, and checks them against `SHA256SUMS.txt`: keep the names and the checksum file as they are.

## Development

```bash
bun install          # Install dependencies
bun test             # Run the tests
bun run typecheck    # tsc --noEmit
bun run check        # Chaperone checks itself
bun run dev          # Run the CLI from source
bun run build        # Build for the current platform
bun run build:all    # Build for all platforms
```

Running this checkout in a repository that pins a version runs the pinned version, as the installed binary would. To run the checkout itself there, set `CHAPERONE_IGNORE_PIN=1`. This repository does not pin a version: its own check runs the code under test.

## License

MIT
