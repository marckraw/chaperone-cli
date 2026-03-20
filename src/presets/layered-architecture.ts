import type { ChaperonePreset } from "./types";

export const layeredArchitecturePreset: ChaperonePreset = {
  name: "layered-architecture",
  description:
    "Enforces FSD-style layered architecture with import boundaries, public APIs, and legacy directory retirement",
  rules: {
    custom: [
      // ── Layer import boundaries ──────────────────────────────────
      {
        type: "import-boundary",
        id: "preset/layer-boundaries",
        severity: "error",
        layers: {
          shared: {
            files: "src/shared/**/*.{ts,tsx}",
            allowImportsFrom: [],
          },
          entities: {
            files: "src/entities/**/*.{ts,tsx}",
            allowImportsFrom: ["shared"],
          },
          features: {
            files: "src/features/**/*.{ts,tsx}",
            allowImportsFrom: ["shared", "entities"],
          },
          widgets: {
            files: "src/widgets/**/*.{ts,tsx}",
            allowImportsFrom: ["shared", "entities", "features"],
          },
          app: {
            files: "src/app/**/*.{ts,tsx}",
            allowImportsFrom: ["shared", "entities", "features", "widgets"],
          },
        },
      },

      // ── Public API enforcement for features ──────────────────────
      {
        type: "public-api",
        id: "preset/feature-public-api",
        severity: "error",
        modules: "src/features/*",
        files: "src/**/*.{ts,tsx}",
        barrelFile: "index.ts",
        allowSameModule: true,
      },

      // ── Public API enforcement for entities ──────────────────────
      {
        type: "public-api",
        id: "preset/entity-public-api",
        severity: "error",
        modules: "src/entities/*",
        files: "src/**/*.{ts,tsx}",
        barrelFile: "index.ts",
        allowSameModule: true,
      },

      // ── Block legacy directories ─────────────────────────────────
      {
        type: "retired-path",
        id: "preset/no-legacy-dirs",
        severity: "error",
        paths: [
          {
            pattern: "src/components/**/*",
            reason: "Use layered architecture",
            migratedTo: "src/shared/ui/ or src/features/<feature>/ui/",
          },
          {
            pattern: "src/hooks/**/*",
            reason: "Use layered architecture",
            migratedTo: "src/shared/hooks/ or src/features/<feature>/model/",
          },
          {
            pattern: "src/lib/**/*",
            reason: "Use layered architecture",
            migratedTo: "src/shared/lib/",
          },
        ],
      },
    ],
  },
};
