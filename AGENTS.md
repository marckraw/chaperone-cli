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

## Changesets

Always use the CLI command to create changesets — never create `.changeset/*.md` files manually:

```bash
bunx changeset              # Interactive prompt for package, bump type, summary
```

## File Conventions

- Use `.ts` extension for all TypeScript files (no `.tsx` needed - this is a CLI tool)
- Keep modules focused and single-purpose
- Prefer pure (side-effect-free) functions whenever possible—they're easier to test and reason about. Isolate side effects (I/O, network, DB, filesystem, time, randomness) at the edges.
- Export types from their respective modules
