/**
 * Configuration file writer for Chaperone init
 */

import { writeFileSync } from "node:fs";
import { fileExists, joinPath } from "../utils/fs";
import type { ChaperoneConfig } from "./types";

export interface WriteConfigOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface WriteConfigResult {
  success: boolean;
  path: string;
  message: string;
  content?: string;
}

const CONFIG_FILENAME = ".chaperone.json";

/**
 * Write the Chaperone configuration file
 */
export function writeConfig(
  cwd: string,
  config: ChaperoneConfig,
  options: WriteConfigOptions = {}
): WriteConfigResult {
  const { force = false, dryRun = false } = options;
  const configPath = joinPath(cwd, CONFIG_FILENAME);
  const content = JSON.stringify(config, null, 2);

  // Check if file already exists
  if (fileExists(configPath) && !force) {
    return {
      success: false,
      path: configPath,
      message: `${CONFIG_FILENAME} already exists. Use --force to overwrite.`,
    };
  }

  // Dry run mode - just return what would be written
  if (dryRun) {
    return {
      success: true,
      path: configPath,
      message: `Would create ${CONFIG_FILENAME}`,
      content,
    };
  }

  // Write the file
  try {
    writeFileSync(configPath, content + "\n", "utf-8");
    return {
      success: true,
      path: configPath,
      message: `Created ${CONFIG_FILENAME}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      path: configPath,
      message: `Failed to write ${CONFIG_FILENAME}: ${errorMessage}`,
    };
  }
}

/**
 * Get the config filename
 */
export function getConfigFilename(): string {
  return CONFIG_FILENAME;
}
