# Chaperone

**Don't let your AI ship unsupervised.**

Chaperone is a deterministic CLI that enforces project-specific rules that TypeScript and ESLint don't cover — things like file structure, naming conventions, required exports, file pairing, allowed patterns, and repo "invariants".

It's designed to work **alongside** your existing TypeScript + ESLint setup, not replace them. Initialize once, define your rules in a config file, and run it locally or in CI.

## Why Chaperone?

In AI-assisted workflows, code gets generated fast — but it doesn't always follow your project's conventions. Chaperone acts as your repo's "adult supervision", verifying changes comply with your rules before they're committed or merged.

**TypeScript** catches type errors. **ESLint** catches style issues. **Chaperone** catches everything else:

- 📁 Directory structure requirements
- 📛 File and export naming conventions
- 🔗 File pairing rules (e.g., every `.tsx` needs a `.test.tsx`)
- 📦 Required exports per module
- 🚫 Forbidden patterns and imports
- ✅ Custom repo invariants

## Installation

Chaperone ships as a single self-contained executable — no runtime, no dependencies. Pick the method that suits you.

### Quick Install (recommended)

**macOS / Linux:**

```bash
curl -fsSL https://github.com/marckraw/chaperone/releases/latest/download/chaperone-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') -o chaperone \
  && chmod +x chaperone \
  && sudo mv chaperone /usr/local/bin/
```

Or without `sudo` (user-local install):

```bash
mkdir -p ~/.local/bin
curl -fsSL https://github.com/marckraw/chaperone/releases/latest/download/chaperone-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/') -o ~/.local/bin/chaperone \
  && chmod +x ~/.local/bin/chaperone
```

> Make sure `~/.local/bin` is in your `PATH`. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile if needed.

**Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri "https://github.com/marckraw/chaperone/releases/latest/download/chaperone-windows-x64.exe" -OutFile "$env:LOCALAPPDATA\chaperone.exe"
# Add $env:LOCALAPPDATA to your PATH, or move chaperone.exe somewhere already in PATH
```

### Using GitHub CLI

If you have [`gh`](https://cli.github.com/) installed:

```bash
# macOS Apple Silicon
gh release download --repo marckraw/chaperone --pattern 'chaperone-darwin-arm64' --output chaperone --clobber
chmod +x chaperone && sudo mv chaperone /usr/local/bin/

# macOS Intel
gh release download --repo marckraw/chaperone --pattern 'chaperone-darwin-x64' --output chaperone --clobber
chmod +x chaperone && sudo mv chaperone /usr/local/bin/

# Linux x64
gh release download --repo marckraw/chaperone --pattern 'chaperone-linux-x64' --output chaperone --clobber
chmod +x chaperone && sudo mv chaperone /usr/local/bin/

# Linux ARM64
gh release download --repo marckraw/chaperone --pattern 'chaperone-linux-arm64' --output chaperone --clobber
chmod +x chaperone && sudo mv chaperone /usr/local/bin/
```

### Manual Download

1. Go to the [latest release](https://github.com/marckraw/chaperone/releases/latest)
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

Optionally verify the checksum against `SHA256SUMS.txt` from the release:

```bash
# Download the checksums file
curl -fsSL https://github.com/marckraw/chaperone/releases/latest/download/SHA256SUMS.txt -o SHA256SUMS.txt

# Verify (macOS)
shasum -a 256 -c SHA256SUMS.txt --ignore-missing

# Verify (Linux)
sha256sum -c SHA256SUMS.txt --ignore-missing
```

### From Source

```bash
# Clone the repository
git clone https://github.com/marckraw/chaperone.git
cd chaperone

# Install Bun if you haven't already
# https://bun.sh/docs/installation

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
# Initialize configuration (interactive)
chaperone init

# Initialize with defaults (non-interactive)
chaperone init --yes

# Preview config without writing
chaperone init --dry-run

# Check codebase for violations
chaperone check

# Show help
chaperone help

# Show version
chaperone version
```

## Custom Rule Types

Chaperone supports custom rules in `.chaperone.json` under `rules.custom`.

```json
{
  "rules": {
    "custom": []
  }
}
```

### `regex`

Use for forbidden/required code patterns.

```json
{
  "type": "regex",
  "id": "no-console-log",
  "severity": "error",
  "files": "src/**/*.{ts,tsx}",
  "pattern": "console\\.log\\(",
  "message": "console.log is forbidden"
}
```

### `file-naming`

Use for companion file requirements.

```json
{
  "type": "file-naming",
  "id": "component-needs-test",
  "severity": "error",
  "pattern": "src/**/*.tsx",
  "requireCompanion": {
    "transform": "$1.test.tsx"
  },
  "message": "Each component must have a test file"
}
```

### `file-pairing`

Use for path-based file pairing where simple basename transforms are not enough.

```json
{
  "type": "file-pairing",
  "id": "migration-has-validator",
  "severity": "error",
  "files": "src/storyblok/migrations/**/*.sb.migration.ts",
  "pair": {
    "from": "\\.sb\\.migration\\.ts$",
    "to": ".validation.ts"
  },
  "mustExist": true,
  "requireTransformMatch": true,
  "message": "Each runnable migration must have a co-located validator"
}
```

### `file-contract`

Use for deterministic content contracts per file, including filename-derived placeholders.

```json
{
  "type": "file-contract",
  "id": "validator-id-and-name-match-file",
  "severity": "error",
  "files": "src/storyblok/migrations/**/*.validation.ts",
  "captureFromPath": {
    "pattern": "([^/]+)\\.validation\\.ts$",
    "group": 1
  },
  "requiredPatterns": [
    "defineMigrationValidation\\s*\\(",
    "export\\s+default\\s+"
  ],
  "requiredAnyPatterns": [
    "ruleSet\\s*:",
    "validateData\\s*:",
    "validateFile\\s*:"
  ],
  "templatedRequiredPatterns": [
    "id\\s*:\\s*['\"]{{capture}}['\"]",
    "name\\s*:\\s*['\"]{{capture}}['\"]"
  ]
}
```

### `package-fields`

Use for package.json invariants.

```json
{
  "type": "package-fields",
  "id": "require-build-script",
  "severity": "error",
  "requiredFields": ["scripts.build"]
}
```

### `component-location`

Use to keep presentational/stateful components in expected folders.

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

### `command`

Use for deterministic command-based checks.

```json
{
  "type": "command",
  "id": "unit-tests-pass",
  "severity": "error",
  "command": "npm",
  "args": ["run", "test:unit"],
  "expectedExitCode": 0,
  "message": "Unit tests must pass"
}
```

### `symbol-reference`

Use to ensure exported symbols from source files are referenced in target files.

```json
{
  "type": "symbol-reference",
  "id": "pure-functions-tested",
  "severity": "error",
  "sourceFiles": "src/**/*.pure.ts",
  "targetFiles": "tests/unit/**/*.test.ts",
  "symbolKinds": ["function-declaration", "function-variable"],
  "message": "Exported pure functions must be referenced in unit tests"
}
```

`symbol-reference` options:
- `symbolPattern`: regex filter for symbol names.
- `ignoreSymbols`: explicit symbol names to skip.
- `exclude`: per-rule glob exclusions (same as other custom rule types).

### `retired-path`

Use to prevent files from being created in deprecated or legacy directories. Catches AI agents that create files in old locations.

```json
{
  "type": "retired-path",
  "id": "no-legacy-dirs",
  "severity": "error",
  "paths": [
    { "pattern": "src/components/**/*", "reason": "Use layered architecture", "migratedTo": "src/features/<feature>/ui/" },
    { "pattern": "src/hooks/**/*", "migratedTo": "src/features/<feature>/model/" },
    { "pattern": "src/lib/**/*", "migratedTo": "src/shared/lib/" }
  ]
}
```

Each `paths` entry:
- `pattern` (required): glob for the retired location.
- `reason`: why this path is retired.
- `migratedTo`: where files should go instead.

### `file-suffix-content`

Use to enforce content conventions on files with a specific suffix. Produces clear, named error messages instead of raw regex.

```json
{
  "type": "file-suffix-content",
  "id": "presentational-purity",
  "severity": "error",
  "suffix": ".presentational.tsx",
  "files": "src/**/*.tsx",
  "forbiddenPatterns": [
    { "pattern": "\\buseEffect\\s*\\(", "name": "useEffect" },
    { "pattern": "\\buseState\\s*\\(", "name": "useState" },
    { "pattern": "\\bfetch\\s*\\(", "name": "fetch" }
  ],
  "requiredPatterns": [
    { "pattern": "export default", "name": "default export" }
  ]
}
```

Options:
- `suffix` (required): file suffix to match (e.g., `.styles.ts`, `.store.ts`, `.presentational.tsx`).
- `files` (required): glob scope.
- `forbiddenPatterns`: array of `{ pattern, name }` — each pattern must NOT match.
- `requiredPatterns`: array of `{ pattern, name }` — each pattern MUST match.

### `file-structure`

Use to enforce directory conventions like feature folder structure.

```json
{
  "type": "file-structure",
  "id": "feature-folder-structure",
  "severity": "error",
  "parentDirs": "src/features/*",
  "required": ["ui", "index.ts"],
  "optional": ["lib", "model", "api", "service"],
  "strict": true
}
```

Options:
- `parentDirs` (required): glob for parent directories to check (e.g., `src/features/*`).
- `required` (required): entries that must exist in each matched directory.
- `optional`: entries that may exist.
- `strict`: if `true`, any entry not in `required` or `optional` is a violation.

### `forbidden-import`

Use to restrict which files can import from specific modules or use specific patterns. Replaces complex ESLint `no-restricted-imports` configs.

```json
{
  "type": "forbidden-import",
  "id": "tauri-api-boundary",
  "severity": "error",
  "files": "src/**/*.{ts,tsx}",
  "restrictions": [
    {
      "source": "^@tauri-apps/",
      "allowedIn": ["src/**/*.api.ts"],
      "message": "Tauri APIs can only be used in .api.ts files"
    }
  ],
  "checkPatterns": [
    {
      "pattern": "\\binvoke\\s*\\(",
      "allowedIn": ["src/**/*.api.ts"],
      "message": "invoke() can only be used in .api.ts files"
    }
  ],
  "includeTypeImports": false
}
```

Options:
- `files` (required): glob for files to scan.
- `restrictions`: array of import restrictions. Each has:
  - `source` (required): regex matching the import specifier.
  - `allowedIn` (required): globs for files where this import IS allowed.
  - `message`: custom error message.
- `checkPatterns`: array of code pattern restrictions (same shape as restrictions but matches code, not imports).
- `includeTypeImports`: whether to check `import type` statements (default: `false` — type imports are usually safe).

### `import-boundary`

Use to enforce architectural layer boundaries. Prevents imports across layers that violate your dependency direction.

```json
{
  "type": "import-boundary",
  "id": "fsd-layers",
  "severity": "error",
  "layers": {
    "shared":   { "files": "src/shared/**/*.{ts,tsx}",   "allowImportsFrom": [] },
    "entities": { "files": "src/entities/**/*.{ts,tsx}",  "allowImportsFrom": ["shared"] },
    "features": { "files": "src/features/**/*.{ts,tsx}",  "allowImportsFrom": ["shared", "entities"] },
    "widgets":  { "files": "src/widgets/**/*.{ts,tsx}",   "allowImportsFrom": ["shared", "entities", "features"] },
    "app":      { "files": "src/app/**/*.{ts,tsx}",       "allowImportsFrom": ["shared", "entities", "features", "widgets"] }
  }
}
```

Options:
- `layers` (required): map of layer name → config. Each layer has:
  - `files` (required): glob for files belonging to this layer.
  - `allowImportsFrom` (required): list of layer names this layer can import from.
- Self-layer imports are always implicitly allowed (a shared file can import from another shared file).
- `includeTypeImports`: check `import type` statements (default: `true`).
- `includeDynamicImports`: check `import()` expressions (default: `true`).

### `public-api`

Use to enforce that modules are imported through their barrel file (`index.ts`), not via deep imports into internal files.

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

Options:
- `modules` (required): glob for module root directories.
- `files` (required): glob for files to check.
- `barrelFile`: name of the barrel file (default: `index.ts`).
- `allowSameModule`: allow deep imports within the same module (default: `true`).

### `relationship`

Use for composite "if A then B" rules — when a file exists, enforce conditions on the file and/or its companion.

```json
{
  "type": "relationship",
  "id": "container-needs-presentational",
  "severity": "error",
  "when": { "files": "src/**/*.container.tsx" },
  "then": [
    { "mustHaveCompanion": { "suffix": ".presentational.tsx" } },
    { "mustImport": { "companion": true } },
    { "companionMustNot": { "patterns": ["\\buseEffect", "\\buseState"] } },
    { "maxLines": 150 }
  ]
}
```

The `when.files` glob selects trigger files. The `then` array is a sequence of actions:

| Action | Description |
|--------|-------------|
| `mustHaveCompanion` | Companion file must exist. Use `suffix` (extension swap) or `pair` (`{ from, to }` regex). |
| `mustNotHaveCompanion` | Companion file must NOT exist. |
| `mustImport` | File must import `companion: true` or specific `modules: [...]`. |
| `mustNotImport` | File must not import specific `modules: [...]`. |
| `companionMustContain` | Companion must match `patterns: [...]` (regex array). |
| `companionMustNot` | Companion must NOT match `patterns: [...]`. |
| `fileMustContain` | Trigger file must match `patterns: [...]`. |
| `fileMustNot` | Trigger file must NOT match `patterns: [...]`. |
| `companionMaxLines` | Companion file max line count. |
| `maxLines` | Trigger file max line count. |

Actions are processed sequentially. If `mustHaveCompanion` fails (companion doesn't exist), remaining actions for that file are skipped.

### `file-contract` assertions

The `file-contract` rule also supports an `assertions` field for semantic content checks beyond regex patterns. Assertions and patterns are additive — all must pass.

```json
{
  "type": "file-contract",
  "id": "server-component-contract",
  "severity": "error",
  "files": "src/**/*.server.ts",
  "assertions": {
    "firstLine": "['\"]use server['\"]",
    "mustExportDefault": true,
    "mustNotImport": ["@tauri-apps/*", "react-dom"],
    "maxLines": 200
  }
}
```

Available assertions:

| Assertion | Type | Description |
|-----------|------|-------------|
| `firstLine` | `string` | First non-empty, non-comment line must match this regex. |
| `mustExportDefault` | `boolean` | File must have `export default`. |
| `mustExportNamed` | `boolean` | File must have at least one named export. |
| `mustNotImport` | `string[]` | Module patterns that must not be imported (supports `*` glob). |
| `mustImport` | `string[]` | Module patterns that must be imported. |
| `maxLines` | `number` | Maximum line count. |
| `minLines` | `number` | Minimum line count. |
| `mustHaveJSDoc` | `boolean` | Exported functions must have JSDoc comments. |
| `maxExports` | `number` | Maximum number of exports. |
| `mustBeModule` | `boolean` | File must have at least one `import` or `export`. |

## Presets

Chaperone supports shareable rule bundles via the `extends` field. Presets let you reuse common rule sets across projects.

```json
{
  "version": "1.0.0",
  "extends": ["chaperone/react-layered"],
  "rules": {
    "custom": [
      {
        "type": "forbidden-import",
        "id": "tauri-api-boundary",
        "severity": "error",
        "files": "src/**/*.{ts,tsx}",
        "restrictions": [{ "source": "^@tauri-apps/", "allowedIn": ["src/**/*.api.ts"] }]
      }
    ]
  }
}
```

### Preset specifiers

- `"chaperone/<name>"` — built-in preset (e.g., `"chaperone/react-layered"`).
- `"./<path>"` or `"../<path>"` — local JSON file relative to your config.

### Built-in presets

#### `chaperone/react-layered`

Enforces a layered React architecture with Feature-Sliced Design conventions:

- **Import boundaries** between shared → entities → features → widgets → app layers.
- **Retired paths** for `src/components/`, `src/hooks/`, `src/lib/` (legacy flat structure).
- **Presentational purity** — `.presentational.tsx` files cannot use `useEffect`, `useState`, `useContext`, or `fetch`.
- **Pure file purity** — `.pure.ts` files cannot use side effects.
- **Pure file testing** — `.pure.ts` files must have paired `.pure.test.ts` files.
- **Public API enforcement** — feature modules must be imported through their `index.ts` barrel file.

### Overriding preset rules

User config rules override preset rules with the same `id`. To disable a preset rule:

```json
{
  "extends": ["chaperone/react-layered"],
  "rules": {
    "custom": [
      { "type": "retired-path", "id": "preset/no-legacy-dirs", "severity": "error", "disabled": true, "paths": [] }
    ]
  }
}
```

### Common fields

All custom rules share these base fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | Rule type (see sections above). |
| `id` | `string` | Yes | Unique identifier for this rule. |
| `severity` | `"error" \| "warning"` | Yes | Severity level. Errors cause non-zero exit code. |
| `exclude` | `string[]` | No | Glob patterns to exclude from this rule. |
| `disabled` | `boolean` | No | Set to `true` to disable a preset rule. |
| `message` | `string` | No | Custom error message (most rule types). |

## CI Integration

Add Chaperone to your CI pipeline to catch convention violations before merge:

```yaml
# GitHub Actions example
- name: Run Chaperone
  run: chaperone check
```

## Release Process

This repository uses **Changesets** for version control and **GitHub Actions** for binary releases.

Target branch: `master`

### 1) Feature PRs

For user-facing/code changes, include a changeset:

```bash
bun run changeset
```

The PR check (`Changeset Check`) enforces this for changes under `src/`, `build.ts`, or `package.json`.

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
# Run in development mode
bun run dev

# Build for current platform
bun run build

# Build for all platforms
bun run build:all
```

## Building Executables

Chaperone uses Bun's compile feature to create standalone executables:

```bash
# Build for current platform only
bun run build.ts

# Build for all supported platforms
bun run build.ts --all
```

Supported platforms:
- macOS (Apple Silicon): `chaperone-darwin-arm64`
- macOS (Intel): `chaperone-darwin-x64`
- Linux (x64): `chaperone-linux-x64`
- Linux (ARM64): `chaperone-linux-arm64`
- Windows (x64): `chaperone-windows-x64.exe`

## License

MIT
