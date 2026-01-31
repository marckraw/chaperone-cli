# Chaperone - Claude Code Instructions

## Project Overview
Chaperone is a code enforcer CLI tool that ensures codebase conventions are followed. It detects existing tools (TypeScript, ESLint, Prettier) and enforces custom rules.

## Technology Stack
- **Runtime**: Bun (NOT Node.js/npm)
- **Language**: TypeScript
- **Build System**: Bun

## Commands - ALWAYS use Bun
```bash
# Development
bun run dev              # Run CLI in development mode
bun run src/cli.ts       # Run CLI directly

# Building
bun run build            # Build for current platform
bun run build:all        # Build for all platforms

# Testing
bun test                 # Run tests

# Linking globally
bun link                 # Link package globally for development
```

## IMPORTANT: Do NOT use npm, yarn, or pnpm
This project is built with Bun. Always use `bun` commands:
- ❌ `npm install` → ✅ `bun install`
- ❌ `npm run` → ✅ `bun run`
- ❌ `npx` → ✅ `bunx`

## Project Structure
```
src/
├── cli.ts              # CLI entry point
├── index.ts            # Library exports
├── version.ts          # Version constant
├── init/               # Init command
│   ├── index.ts        # Init orchestrator
│   ├── types.ts        # TypeScript interfaces
│   ├── detector.ts     # Tool detection logic
│   ├── config-writer.ts# Config file writer
│   └── prompts.ts      # Interactive prompts
└── utils/
    └── fs.ts           # File system utilities
```

## CLI Usage
```bash
chaperone init           # Initialize .chaperone.json config
chaperone init --yes     # Non-interactive mode
chaperone init --dry-run # Preview without writing
chaperone check          # Check codebase for violations
chaperone version        # Show version
chaperone help           # Show help
```

## Configuration
The CLI creates a `.chaperone.json` file with detected tools and settings.

## File Conventions
- Use `.ts` extension for all TypeScript files (no `.tsx` needed - this is a CLI tool)
- Keep modules focused and single-purpose
- Export types from their respective modules
