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

### From Source

```bash
# Clone the repository
git clone https://github.com/your-username/chaperone.git
cd chaperone

# Install Bun if you haven't already
# https://bun.sh/docs/installation

# Run directly
bun run src/cli.ts --help

# Or build a standalone executable
bun run build.ts
./bin/chaperone-darwin-arm64 --help  # macOS Apple Silicon
```

### Pre-built Binaries

Download the appropriate binary for your platform from the releases page.

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

## CI Integration

Add Chaperone to your CI pipeline to catch convention violations before merge:

```yaml
# GitHub Actions example
- name: Run Chaperone
  run: chaperone check
```

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
