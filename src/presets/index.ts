import type { ChaperonePreset } from "./types";
import { reactLayeredPreset } from "./react-layered";

export type { ChaperonePreset } from "./types";

/**
 * Registry of built-in presets.
 * Use "chaperone/<name>" in the config's `extends` array.
 */
const builtInPresets: Record<string, ChaperonePreset> = {
  "react-layered": reactLayeredPreset,
};

export function getBuiltInPreset(name: string): ChaperonePreset | null {
  return builtInPresets[name] ?? null;
}

export function listBuiltInPresets(): string[] {
  return Object.keys(builtInPresets);
}
