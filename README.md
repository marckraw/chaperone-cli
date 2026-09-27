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

Custom install directory:

```bash
curl -fsSL https://raw.githubusercontent.com/marckraw/chaperone-cli/master/scripts/install.sh | CHAPERONE_INSTALL_DIR="$HOME/.local/bin" sh
```

The install script auto-detects your OS and architecture, downloads the correct binary, verifies the SHA256 checksum, and installs it. If `/usr/local/bin` is not writable, it falls back to `~/.local/bin`.

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

The `init` command scans your project, detects existing tools (TypeScript, ESLint, Prettier, package manager), and creates a `.chaperone.json` config file.

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
chaperone help
chaperone version
```

### `check` options

| Option | Description |
|--------|-------------|
| `--config, -c <path>` | Config file path (default: `.chaperone.json`) |
| `--cwd <path>` | Working directory (default: current directory) |
| `--fix` | Let ESLint and Prettier fix what they can (custom rules run after the fixers) |
| `--format, -f <type>` | `text` (default), `json` or `ai` |
| `--quiet, -q` | List only errors, in every format (counts still include warnings) |
| `--no-warnings` | Drop warnings entirely |
| `--copy` | Copy the remaining problems to the clipboard (ai format) |
| `--no-progress` | Disable the progress spinner |
| `--debug` | Print rule execution details (to stderr) |
| `--since <git-ref>` | Custom rules only check files changed since the merge base of `<git-ref>` and `HEAD`, plus uncommitted and untracked files. Layer membership, module discovery and symbol targets still use every file; `package-fields` and `command` rules always run; TypeScript, ESLint and Prettier still check the whole project. The report says the run was limited. |

Unknown options, missing option values and unknown `--format` values are usage errors (exit code 2).

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | The check passed (warnings do not fail it) |
| `1` | The check ran and found at least one error |
| `2` | Chaperone could not do its job: invalid configuration, usage error (unknown option, bad value, unknown command, bad `--since` ref) or internal error. Nothing is reported as passed. |

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
- Patterns are applied in order and the last match wins; `!pattern` re-includes something an earlier pattern (including a default) excluded, e.g. `"exclude": ["!src/build"]`.

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
- unknown built-in presets, missing preset files and circular `extends`.

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
| `type` | `string` | Yes | One of the 13 types below. |
| `id` | `string` | Yes | Unique identifier. A rule with the same id as a preset rule replaces it. |
| `severity` | `"error" \| "warning"` | Yes | Errors make `check` exit with 1; warnings are only reported. |
| `exclude` | `string[]` | No | Extra exclude patterns for this rule (same semantics as the global `exclude`). |
| `disabled` | `boolean` | No | `true` switches the rule off (also rules inherited from presets). A disabled entry only needs `id`. |
| `message` | `string` | No* | Custom violation message (*required for `regex`). |
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

Each violation points at the first non-whitespace character of the match and includes the matched text and the surrounding lines. Zero-length matches are ignored: a pattern such as `TODO|` only reports real `TODO`s (and validation warns about it), and a zero-length match never satisfies `mustMatch`.

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
- When a file matches several layers, the layer listed **last** wins. Layers with no files, and layers whose files all belong to a later layer, are reported as notices.
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

- `modules` (glob for module directories) and `files` are required.
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
| `chaperone/react-native-expo` | Files containing JSX use `.tsx`, no `console.log` (warning) and no inline style objects (warning) under `src/`; includes `src/**` and `app/**`, excludes `.expo`, `android` and `ios`. |
| `chaperone/react-server-components` | Files starting with `"use client"` export only components (`PascalCase`) and hooks (`useX`). |

## Tool runners

When configured, `check` also runs TypeScript (`tsc --noEmit`), ESLint (`eslint --format json .`) and Prettier (`prettier --check .`), concurrently with each other and with the custom rules.

- A runner runs when its config exists in the project root (`tsconfig.json`; `eslint.config.{js,mjs,cjs,ts,mts,cts}`, `.eslintrc*` or `eslintConfig` in `package.json`; `.prettierrc*`, `prettier.config.*` or `prettier` in `package.json`) and its binary is found in `node_modules/.bin` (of the project or any parent directory) or on the `PATH`. Set `rules.<tool>.enabled: false` to skip one.
- Runners **fail closed**: a tool that exits with an error but reports nothing parseable (a crashed ESLint config, `tsc` error TS18003 "No inputs were found", a Prettier syntax error) is an error in the report, with the tool's output, never a pass.
- A skipped runner is always listed with the reason (`skipped: no ESLint config in the project root`), and a passing report says what was skipped.

## Reports

All three formats contain the same facts:

- status: `PASSED`, `PASSED, but not everything was checked: ...` (tools skipped, rules that matched no files, `--since`), or `FAILED`;
- each tool runner's status (passed, failed, skipped with the reason, or could not run) and duration;
- rules that matched no files, rule notices (empty or shadowed layers, modules globs without modules) and disabled rules;
- configuration warnings;
- the results, with context: matched text or offending import, expected vs actual, suggestions, command output.

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
- name: Run Chaperone
  run: chaperone check --format ai
```

Exit code 1 fails the job on errors; exit code 2 fails it on a broken configuration.

## Release Process

This repository uses **Changesets** for version control and **GitHub Actions** for binary releases.

Target branch: `master`

### 1) Feature PRs

For user-facing/code changes, include a changeset:

```bash
bun run changeset
```

The PR check (`Changeset Check`) enforces this for changes under `src/`, `build.ts`, or `package.json`. The `CI` workflow runs `bun test`, Chaperone's own `check`, and the same check with the compiled binary.

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

## License

MIT
