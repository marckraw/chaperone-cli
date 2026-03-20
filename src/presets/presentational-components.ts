import type { ChaperonePreset } from "./types";

export const presentationalComponentsPreset: ChaperonePreset = {
  name: "presentational-components",
  description:
    "Enforces the .presentational.tsx discipline: render-only components with no hooks, state, or side effects",
  rules: {
    custom: [
      // ── No side effects in .presentational.tsx ───────────────────
      {
        type: "file-contract",
        id: "preset/presentational-no-side-effects",
        severity: "error",
        files: "**/*.presentational.tsx",
        forbiddenPatterns: [
          "\\buseEffect\\s*\\(",
          "\\buseLayoutEffect\\s*\\(",
          "\\buseInsertionEffect\\s*\\(",
          "\\bfetch\\s*\\(",
          "\\bXMLHttpRequest\\b",
        ],
        message: "Presentational components must not contain side effects",
      },

      // ── No stateful hooks in .presentational.tsx ─────────────────
      {
        type: "file-contract",
        id: "preset/presentational-no-stateful-hooks",
        severity: "error",
        files: "**/*.presentational.tsx",
        forbiddenPatterns: [
          "\\buseState\\s*\\(",
          "\\buseReducer\\s*\\(",
          "\\buseContext\\s*\\(",
          "\\buseImperativeHandle\\s*\\(",
        ],
        message: "Presentational components must not use stateful hooks",
      },
    ],
  },
};
