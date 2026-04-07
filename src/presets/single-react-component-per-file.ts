import type { ChaperonePreset } from "./types";

export const singleReactComponentPerFilePreset: ChaperonePreset = {
  name: "single-react-component-per-file",
  description:
    "Enforces one top-level React component per file so component helpers are split into their own modules",
  rules: {
    custom: [
      {
        type: "react-component-count",
        id: "preset/single-react-component-per-file",
        severity: "error",
        files: "**/*.{tsx,jsx}",
        exclude: [
          "**/*.test.{tsx,jsx}",
          "**/*.spec.{tsx,jsx}",
          "**/*.stories.{tsx,jsx}",
          "**/*.story.{tsx,jsx}",
        ],
        maxComponents: 1,
        message: "Keep a single top-level React component in each file",
      },
    ],
  },
};
