import type { ChaperonePreset } from "./types";

export const pureFunctionsPreset: ChaperonePreset = {
  name: "pure-functions",
  description:
    "Enforces the .pure.ts discipline: side-effect-free files with mandatory test pairing",
  rules: {
    custom: [
      // ── Every .pure.ts must have a .pure.test.ts ─────────────────
      {
        type: "file-pairing",
        id: "preset/pure-files-need-tests",
        severity: "error",
        files: "**/*.pure.ts",
        pair: {
          from: "\\.pure\\.ts$",
          to: ".pure.test.ts",
        },
        mustExist: true,
        message: "Every .pure.ts file must have a corresponding .pure.test.ts sibling",
      },

      // ── Every .pure.test.ts must have a .pure.ts ────────────────
      {
        type: "file-pairing",
        id: "preset/pure-tests-need-source",
        severity: "error",
        files: "**/*.pure.test.ts",
        pair: {
          from: "\\.pure\\.test\\.ts$",
          to: ".pure.ts",
        },
        mustExist: true,
        message: "Every .pure.test.ts file must have a corresponding .pure.ts sibling",
      },

      // ── No side effects in .pure.ts files ────────────────────────
      {
        type: "file-contract",
        id: "preset/pure-no-side-effects",
        severity: "error",
        files: "**/*.pure.ts",
        forbiddenPatterns: [
          "\\bfetch\\s*\\(",
          "\\bsetTimeout\\s*\\(",
          "\\bsetInterval\\s*\\(",
          "\\bconsole\\.",
          "\\blocalStorage\\b",
          "\\bsessionStorage\\b",
          "\\bXMLHttpRequest\\b",
          "\\bWebSocket\\b",
        ],
        message: "Pure files must be side-effect-free: no IO, no timers, no console, no storage",
      },

      // ── No API/service imports in .pure.ts files ─────────────────
      {
        type: "regex",
        id: "preset/pure-no-api-imports",
        severity: "error",
        pattern: "from\\s+['\"].*\\.api['\"]",
        files: "**/*.pure.ts",
        message: "Pure files must not import from .api modules (side-effect boundary)",
        mustMatch: false,
      },
    ],
  },
};
