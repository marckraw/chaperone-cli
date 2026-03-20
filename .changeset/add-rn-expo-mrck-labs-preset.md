---
"chaperone": minor
---

Simplify rule types from 15 to 11 and add composable preset system.

**Rule type changes:**
- Merged `file-naming` into `file-pairing`
- Merged `file-suffix-content` into `file-contract`
- Removed unused `file-structure` and `relationship` rule types

**New presets:**
- `chaperone/pure-functions` — .pure.ts test pairing and side-effect enforcement
- `chaperone/presentational-components` — .presentational.tsx purity rules
- `chaperone/package-essentials` — required dev/build/test/lint scripts
- `chaperone/layered-architecture` — FSD layers, public APIs, legacy dir retirement
- `chaperone/react-native-expo` — generic Expo conventions (replaces `react-native-expo-mrck-labs`)
