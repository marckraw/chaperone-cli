# Chaperone CLI - Phase 2: Init Command

> **Note:** This plan has been implemented.

## Overview
Add `chaperone init` command that detects existing tools (TypeScript, ESLint, Prettier) and creates a `.chaperone.json` config file.

## Location
`/Users/marckraw/Projects/OpenSource/chaperone/`

## File Structure
```
src/
├── cli.ts                    # Modified - added init command
├── index.ts                  # Modified - exports init API
├── init/
│   ├── index.ts              # Main init orchestrator
│   ├── types.ts              # TypeScript interfaces
│   ├── detector.ts           # Tool detection logic
│   ├── config-writer.ts      # Writes .chaperone.json
│   └── prompts.ts            # Interactive prompts
└── utils/
    └── fs.ts                 # File system utilities
```

## Config Schema (`.chaperone.json`)
```json
{
  "version": "1.0.0",
  "project": {
    "typescript": {
      "detected": true,
      "configPath": "tsconfig.json",
      "settings": { "strict": true, "target": "ESNext" }
    },
    "eslint": {
      "detected": true,
      "configPath": "eslint.config.mjs",
      "configFormat": "flat"
    },
    "prettier": {
      "detected": true,
      "configPath": ".prettierrc"
    },
    "packageManager": { "name": "bun", "lockfile": "bun.lockb" }
  },
  "rules": {},
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "build"],
  "integrations": {
    "respectEslintIgnore": true,
    "respectPrettierIgnore": true,
    "useTypescriptPaths": true
  }
}
```

## Detection Logic

**TypeScript:** `tsconfig.json`, `tsconfig.*.json` - read `strict`, `target`

**ESLint:**
- Legacy: `.eslintrc`, `.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.json`, `.eslintrc.yaml`
- Flat (v9+): `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`
- `package.json` `eslintConfig` key

**Prettier:** `.prettierrc`, `.prettierrc.json`, `.prettierrc.yaml`, `prettier.config.js`, etc.

**Package Manager (priority):**
1. `bun.lockb` → Bun
2. `pnpm-lock.yaml` → pnpm
3. `yarn.lock` → Yarn
4. `package-lock.json` → npm

## CLI Usage

```
chaperone init [options]

Options:
  --yes, -y         Skip prompts, use defaults
  --force, -f       Overwrite existing .chaperone.json
  --cwd <path>      Target directory
  --dry-run         Show what would be created
```

**Interactive output:**
```
$ chaperone init

🔍 Scanning project...

Detected tools:
  ✓ TypeScript (tsconfig.json) - strict mode
  ✓ ESLint (eslint.config.mjs) - flat config
  ✓ Prettier (.prettierrc)
  ✓ Package Manager: bun

? Include directories [src/**/*]:
? Exclude directories [node_modules, dist]:

Creating .chaperone.json...
✅ Configuration created!
```

## Verification Steps
1. `bun run src/cli.ts init --help` - shows init help
2. `bun run src/cli.ts init --dry-run` - shows detection without writing
3. `bun run src/cli.ts init` - interactive mode works
4. `bun run src/cli.ts init --yes` - non-interactive creates config
5. Verify `.chaperone.json` created with correct detected tools
6. Test on a project with TS + ESLint + Prettier
7. Test on a project with no tools
