import type { ChaperonePreset } from "./types";

export const reactServerComponentsPreset: ChaperonePreset = {
  name: "react-server-components",
  description:
    "Enforces safe export discipline for React Server Components / Next.js App Router projects",
  rules: {
    custom: [
      {
        type: "directive-export-pattern",
        id: "preset/use-client-exports",
        severity: "error",
        files: "src/**/*.{ts,tsx,js,jsx}",
        directive: "use client",
        allowedExportNamePatterns: [
          "^[A-Z][A-Za-z0-9]*$",
          "^use[A-Z][A-Za-z0-9]*$",
        ],
        message:
          'Files marked "use client" should export only React components or hooks. Move utility exports into sibling pure modules.',
      },
    ],
  },
};
