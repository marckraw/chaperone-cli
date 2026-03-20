import type { ChaperonePreset } from "./types";

export const reactNativeExpoPreset: ChaperonePreset = {
  name: "react-native-expo",
  description:
    "Enforces conventions for React Native + Expo apps",
  rules: {
    typescript: { enabled: true },
    eslint: { enabled: true, extensions: [".ts", ".tsx", ".js", ".jsx"] },
    custom: [
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
