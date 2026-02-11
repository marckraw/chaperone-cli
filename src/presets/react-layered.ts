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
        type: "file-suffix-content",
        id: "preset/presentational-purity",
        severity: "error",
        suffix: ".presentational.tsx",
        files: "src/**/*.tsx",
        forbiddenPatterns: [
          { pattern: "\\buseEffect\\s*\\(", name: "useEffect" },
          { pattern: "\\buseState\\s*\\(", name: "useState" },
          { pattern: "\\buseContext\\s*\\(", name: "useContext" },
          { pattern: "\\bfetch\\s*\\(", name: "fetch" },
        ],
      },
      {
        type: "file-suffix-content",
        id: "preset/pure-file-purity",
        severity: "error",
        suffix: ".pure.ts",
        files: "src/**/*.ts",
        forbiddenPatterns: [
          { pattern: "\\buseEffect\\s*\\(", name: "useEffect" },
          { pattern: "\\buseState\\s*\\(", name: "useState" },
          { pattern: "\\bfetch\\s*\\(", name: "fetch" },
          { pattern: "\\bsetTimeout\\s*\\(", name: "setTimeout" },
          { pattern: "\\bsetInterval\\s*\\(", name: "setInterval" },
        ],
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
