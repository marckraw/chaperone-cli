---
"chaperone": minor
---

Add 7 new rule types, file-contract assertions, and presets system

New rule types:
- `retired-path` — prevent files in deprecated directories
- `file-suffix-content` — content rules by file suffix
- `file-structure` — enforce feature folder conventions
- `forbidden-import` — restrict imports to specific files
- `import-boundary` — enforce architectural layer boundaries
- `public-api` — enforce barrel file imports
- `relationship` — composite "if A then B" rules

Enhanced `file-contract` with semantic assertions (firstLine, mustExportDefault, mustNotImport, maxLines, mustHaveJSDoc, maxExports, mustBeModule, etc.).

Added presets system with `extends` support in config, built-in `chaperone/react-layered` preset, and merge-by-id custom rules strategy with `disabled` override.
