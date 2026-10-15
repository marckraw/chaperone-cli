/**
 * Reading and writing `.chaperone-baseline.json`, next to the config in the project root.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_FILENAME, BaselineError, parseBaseline, serializeBaseline, type Baseline } from "./baseline";

export function baselinePath(cwd: string): string {
  return join(cwd, BASELINE_FILENAME);
}

/**
 * The project's baseline, or null when it has none.
 *
 * @throws {BaselineError} when the file cannot be read or is not a valid baseline
 */
export function readBaselineFile(cwd: string): Baseline | null {
  const path = baselinePath(cwd);
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    throw new BaselineError(`cannot read ${BASELINE_FILENAME}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseBaseline(text);
}

/**
 * Write the baseline: to a temporary file first, so an interrupted write never leaves half a file.
 */
export function writeBaselineFile(cwd: string, baseline: Baseline): void {
  const path = baselinePath(cwd);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, serializeBaseline(baseline));
  renameSync(temporary, path);
}
