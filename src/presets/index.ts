import type { ChaperonePreset } from "./types";
import { reactLayeredPreset } from "./react-layered";
import { reactNativeExpoMrckLabsPreset } from "./react-native-expo-mrck-labs";

export type { ChaperonePreset } from "./types";

/**
 * Registry of built-in presets.
 * Use "chaperone/<name>" in the config's `extends` array.
 */
const builtInPresets: Record<string, ChaperonePreset> = {
  "react-layered": reactLayeredPreset,
  "react-native-expo-mrck-labs": reactNativeExpoMrckLabsPreset,
};

export function getBuiltInPreset(name: string): ChaperonePreset | null {
  return builtInPresets[name] ?? null;
}

export function listBuiltInPresets(): string[] {
  return Object.keys(builtInPresets);
}
