import type { ChaperonePreset } from "./types";

export const packageEssentialsPreset: ChaperonePreset = {
  name: "package-essentials",
  description:
    "Ensures package.json has essential scripts: dev, build, test, lint",
  rules: {
    custom: [
      {
        type: "package-fields",
        id: "preset/required-scripts",
        severity: "error",
        requiredFields: [
          "scripts.dev",
          "scripts.build",
          "scripts.test",
          "scripts.lint",
        ],
        message: "package.json must have dev, build, test, and lint scripts",
      },
    ],
  },
};
