import type { ChaperonePreset } from "./types";
import { pureFunctionsPreset } from "./pure-functions";
import { presentationalComponentsPreset } from "./presentational-components";
import { packageEssentialsPreset } from "./package-essentials";
import { layeredArchitecturePreset } from "./layered-architecture";
import { reactLayeredPreset } from "./react-layered";
import { reactNativeExpoPreset } from "./react-native-expo";
import { reactServerComponentsPreset } from "./react-server-components";
import { singleReactComponentPerFilePreset } from "./single-react-component-per-file";

export type { ChaperonePreset } from "./types";

/**
 * Registry of built-in presets.
 * Use "chaperone/<name>" in the config's `extends` array.
 */
const builtInPresets: Record<string, ChaperonePreset> = {
  // Foundation presets (composable building blocks)
  "pure-functions": pureFunctionsPreset,
  "presentational-components": presentationalComponentsPreset,
  "single-react-component-per-file": singleReactComponentPerFilePreset,
  "package-essentials": packageEssentialsPreset,

  // Architecture presets
  "layered-architecture": layeredArchitecturePreset,
  "react-layered": reactLayeredPreset,
  "react-native-expo": reactNativeExpoPreset,
  "react-server-components": reactServerComponentsPreset,
};

export function getBuiltInPreset(name: string): ChaperonePreset | null {
  return builtInPresets[name] ?? null;
}

export function listBuiltInPresets(): string[] {
  return Object.keys(builtInPresets);
}
