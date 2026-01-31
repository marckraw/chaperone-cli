/**
 * Main init orchestrator for Chaperone
 */

import { detectProjectTools } from "./detector";
import { writeConfig, getConfigFilename } from "./config-writer";
import { inputList } from "./prompts";
import type {
  ChaperoneConfig,
  DetectionResult,
  InitOptions,
} from "./types";

const CONFIG_VERSION = "1.0.0";

const DEFAULT_INCLUDE = ["src/**/*"];
const DEFAULT_EXCLUDE = ["node_modules", "dist", "build"];

/**
 * Print detection results to console
 */
function printDetectionResults(detection: DetectionResult): void {
  console.log("");
  console.log("Detected tools:");

  // TypeScript
  if (detection.typescript.detected) {
    const settings = detection.typescript.settings;
    const details: string[] = [];
    if (settings?.strict) details.push("strict mode");
    if (settings?.target) details.push(`target: ${settings.target}`);
    const detailStr = details.length > 0 ? ` - ${details.join(", ")}` : "";
    console.log(`  ✓ TypeScript (${detection.typescript.configPath})${detailStr}`);
  } else {
    console.log("  ✗ TypeScript (not found)");
  }

  // ESLint
  if (detection.eslint.detected) {
    const format = detection.eslint.configFormat === "flat" ? "flat config" : "legacy config";
    console.log(`  ✓ ESLint (${detection.eslint.configPath}) - ${format}`);
  } else {
    console.log("  ✗ ESLint (not found)");
  }

  // Prettier
  if (detection.prettier.detected) {
    console.log(`  ✓ Prettier (${detection.prettier.configPath})`);
  } else {
    console.log("  ✗ Prettier (not found)");
  }

  // Package Manager
  if (detection.packageManager) {
    console.log(`  ✓ Package Manager: ${detection.packageManager.name}`);
  } else {
    console.log("  ✗ Package Manager (not detected)");
  }

  console.log("");
}

/**
 * Build the configuration object from detection results
 */
function buildConfig(
  detection: DetectionResult,
  include: string[],
  exclude: string[]
): ChaperoneConfig {
  return {
    version: CONFIG_VERSION,
    project: {
      typescript: detection.typescript,
      eslint: detection.eslint,
      prettier: detection.prettier,
      packageManager: detection.packageManager,
    },
    rules: {},
    include,
    exclude,
    integrations: {
      respectEslintIgnore: detection.eslint.detected,
      respectPrettierIgnore: detection.prettier.detected,
      useTypescriptPaths: detection.typescript.detected,
    },
  };
}

/**
 * Parse init command arguments
 */
export function parseInitArgs(args: string[]): InitOptions {
  const options: InitOptions = {
    cwd: process.cwd(),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--cwd" && args[i + 1]) {
      options.cwd = args[i + 1];
      i++; // Skip next arg
    }
  }

  return options;
}

/**
 * Show init command help
 */
export function showInitHelp(): void {
  console.log(`
chaperone init - Initialize Chaperone configuration

USAGE:
  chaperone init [options]

OPTIONS:
  --yes, -y         Skip prompts, use defaults
  --force, -f       Overwrite existing ${getConfigFilename()}
  --cwd <path>      Target directory (default: current directory)
  --dry-run         Show what would be created without writing

EXAMPLES:
  chaperone init
  chaperone init --yes
  chaperone init --force --cwd ./my-project
  chaperone init --dry-run
`);
}

/**
 * Run the init command
 */
export async function runInit(args: string[]): Promise<void> {
  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    showInitHelp();
    return;
  }

  const options = parseInitArgs(args);
  const cwd = options.cwd || process.cwd();

  console.log("🔍 Scanning project...");

  // Run detection
  const detection = detectProjectTools(cwd);

  // Print results
  printDetectionResults(detection);

  // Get include/exclude paths
  let include = DEFAULT_INCLUDE;
  let exclude = DEFAULT_EXCLUDE;

  if (!options.yes) {
    // Interactive mode - prompt for include/exclude
    include = await inputList("? Include directories", DEFAULT_INCLUDE);
    exclude = await inputList("? Exclude directories", DEFAULT_EXCLUDE);
    console.log("");
  }

  // Build configuration
  const config = buildConfig(detection, include, exclude);

  // Show what would be created in dry-run mode
  if (options.dryRun) {
    console.log("Dry run mode - would create the following configuration:");
    console.log("");
    console.log(JSON.stringify(config, null, 2));
    console.log("");
    return;
  }

  // Write configuration
  console.log(`Creating ${getConfigFilename()}...`);

  const result = writeConfig(cwd, config, {
    force: options.force,
    dryRun: options.dryRun,
  });

  if (result.success) {
    console.log(`✅ Configuration created!`);
  } else {
    console.error(`❌ ${result.message}`);
    process.exit(1);
  }
}

// Re-export types and functions for external use
export { detectProjectTools } from "./detector";
export type {
  ChaperoneConfig,
  DetectionResult,
  InitOptions,
  TypeScriptDetection,
  ESLintDetection,
  PrettierDetection,
  PackageManagerDetection,
} from "./types";
