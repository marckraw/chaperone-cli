---
"chaperone": minor
---

Release 0.5.0 with composable preset system and simplified rule types.

**Rule type changes:**
- Merged `file-naming` into `file-pairing`
- Merged `file-suffix-content` into `file-contract`
- Removed unused `file-structure` and `relationship` rule types (15 → 11)

**New presets:**
- `chaperone/pure-functions` — .pure.ts test pairing and side-effect enforcement
- `chaperone/presentational-components` — .presentational.tsx purity rules
- `chaperone/package-essentials` — required dev/build/test/lint scripts
- `chaperone/layered-architecture` — FSD layers, public APIs, legacy dir retirement
- `chaperone/react-native-expo` — generic Expo conventions

**Other:**
- Added optional `version` field to preset type
