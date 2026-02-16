import type { ChaperonePreset } from "./types";

export const reactNativeExpoMrckLabsPreset: ChaperonePreset = {
  name: "react-native-expo-mrck-labs",
  description:
    "Enforces conventions for React Native + Expo + Supabase apps (mrck-labs stack)",
  rules: {
    typescript: { enabled: true },
    eslint: { enabled: true, extensions: [".ts", ".tsx", ".js", ".jsx"] },
    custom: [
      // ── Type safety ──────────────────────────────────────────────
      {
        type: "regex",
        id: "preset/no-any-types",
        severity: "error",
        pattern: ":\\s*any\\b",
        files: "**/*.{ts,tsx}",
        exclude: [
          "**/*.test.{ts,tsx}",
          "**/__tests__/**",
          "**/__mocks__/**",
          "**/types/supabase.ts",
        ],
        message:
          "Do not use 'any' type. Define proper types instead.",
        mustMatch: false,
      },

      // ── File extension discipline ────────────────────────────────
      {
        type: "regex",
        id: "preset/require-tsx-for-jsx",
        severity: "error",
        pattern:
          "(<[A-Z][a-zA-Z0-9]*\\s+[a-zA-Z]+=|<[A-Z][a-zA-Z0-9]*\\s*/>|<[A-Z][a-zA-Z0-9]*>[^<]*</[A-Z])",
        files: "**/*.ts",
        exclude: ["**/*.d.ts"],
        message: "Files containing JSX must use .tsx extension.",
        mustMatch: false,
        reportOnce: true,
      },

      // ── No console.log in production code ────────────────────────
      {
        type: "regex",
        id: "preset/no-console-log",
        severity: "warning",
        pattern: "console\\.log\\s*\\(",
        files: "src/**/*.{ts,tsx}",
        exclude: [
          "**/*.test.{ts,tsx}",
          "**/__tests__/**",
          "**/debug/**",
        ],
        message:
          "Remove console.log before committing. Use a proper logger or remove the statement.",
        mustMatch: false,
      },

      // ── Expo Router navigation ───────────────────────────────────
      {
        type: "regex",
        id: "preset/require-header-shown-false",
        severity: "error",
        pattern: "headerShown:\\s*false",
        files: "app/_layout.tsx",
        message:
          "All screens must have headerShown: false in app/_layout.tsx (custom headers are used).",
        mustMatch: true,
      },

      // ── Pure file purity ─────────────────────────────────────────
      {
        type: "file-suffix-content",
        id: "preset/pure-file-purity",
        severity: "error",
        suffix: ".pure.ts",
        files: "src/**/*.ts",
        forbiddenPatterns: [
          { pattern: "\\bfetch\\s*\\(", name: "fetch" },
          { pattern: "\\bsetTimeout\\s*\\(", name: "setTimeout" },
          { pattern: "\\bsetInterval\\s*\\(", name: "setInterval" },
          { pattern: "\\bconsole\\.", name: "console" },
          { pattern: "\\bAsyncStorage\\b", name: "AsyncStorage" },
        ],
      },

      // ── Pure files should have tests ─────────────────────────────
      {
        type: "file-pairing",
        id: "preset/pure-files-need-tests",
        severity: "warning",
        files: "src/**/*.pure.ts",
        pair: {
          from: "\\.pure\\.ts$",
          to: ".pure.test.ts",
        },
        mustExist: true,
      },

      // ── Package.json must include chaperone check ────────────────
      {
        type: "package-fields",
        id: "preset/require-test-pure-script",
        severity: "error",
        requiredFields: ["scripts.test:pure"],
        fieldPatterns: {
          "scripts.test:pure": "chaperone\\s+check",
        },
        message:
          "package.json must have a test:pure script that runs chaperone check.",
      },

      // ── No direct Supabase client usage outside service layer ────
      {
        type: "regex",
        id: "preset/no-direct-supabase-in-components",
        severity: "warning",
        pattern: "from\\s+['\"]@supabase/supabase-js['\"]",
        files: "src/components/**/*.{ts,tsx}",
        message:
          "Do not import Supabase client directly in components. Use hooks or services instead.",
        mustMatch: false,
      },

      // ── No inline styles in components (prefer StyleSheet/NativeWind) ─
      {
        type: "regex",
        id: "preset/no-inline-style-objects",
        severity: "warning",
        pattern: "style=\\{\\{",
        files: "src/**/*.tsx",
        exclude: ["**/*.test.tsx", "**/__tests__/**"],
        message:
          "Avoid inline style objects. Use StyleSheet.create or NativeWind classes instead.",
        mustMatch: false,
      },
    ],
  },
  include: ["src/**/*", "app/**/*"],
  exclude: ["node_modules", "dist", "build", ".expo", "android", "ios"],
  integrations: {
    respectEslintIgnore: true,
    useTypescriptPaths: true,
  },
};
