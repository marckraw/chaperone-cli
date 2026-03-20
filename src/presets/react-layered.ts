import type { ChaperonePreset } from "./types";

export const reactLayeredPreset: ChaperonePreset = {
  name: "react-layered",
  description:
    "Enforces a layered React architecture with Feature-Sliced Design conventions",
  rules: {
    custom: [
      {
        type: "import-boundary",
        id: "preset/fsd-layers",
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
      {
        type: "retired-path",
        id: "preset/no-legacy-dirs",
        severity: "error",
        paths: [
          {
            pattern: "src/components/**/*",
            reason: "Use layered architecture",
            migratedTo: "src/features/<feature>/ui/",
          },
          {
            pattern: "src/hooks/**/*",
            reason: "Use layered architecture",
            migratedTo: "src/features/<feature>/model/",
          },
          {
            pattern: "src/lib/**/*",
            reason: "Use layered architecture",
            migratedTo: "src/shared/lib/",
          },
        ],
      },
      {
        type: "file-contract",
        id: "preset/presentational-purity",
        severity: "error",
        files: "src/**/*.presentational.tsx",
        forbiddenPatterns: [
          "\\buseEffect\\s*\\(",
          "\\buseState\\s*\\(",
          "\\buseContext\\s*\\(",
          "\\bfetch\\s*\\(",
        ],
        message: "Presentational components must not contain side effects or state",
      },
      {
        type: "file-contract",
        id: "preset/pure-file-purity",
        severity: "error",
        files: "src/**/*.pure.ts",
        forbiddenPatterns: [
          "\\buseEffect\\s*\\(",
          "\\buseState\\s*\\(",
          "\\bfetch\\s*\\(",
          "\\bsetTimeout\\s*\\(",
          "\\bsetInterval\\s*\\(",
        ],
        message: "Pure files must not contain side effects",
      },
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
      {
        type: "public-api",
        id: "preset/feature-public-api",
        severity: "error",
        modules: "src/features/*",
        files: "src/**/*.{ts,tsx}",
        barrelFile: "index.ts",
        allowSameModule: true,
      },
    ],
  },
};
