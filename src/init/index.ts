/**
 * Main init orchestrator for Chaperone
 */

import { detectProjectTools } from "./detector";
import { writeConfig, getConfigFilename } from "./config-writer";
import { inputList } from "./prompts";
import { EXIT, parseArgs, UsageError } from "../utils/args";
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
 *
 * @throws {UsageError} for unknown options or missing values
 */
export function parseInitArgs(args: string[]): InitOptions & { help?: boolean } {
  const parsed = parseArgs(args, {
    help: { names: ["--help", "-h"], type: "boolean" },
    yes: { names: ["--yes", "-y"], type: "boolean" },
    force: { names: ["--force", "-f"], type: "boolean" },
    dryRun: { names: ["--dry-run"], type: "boolean" },
    cwd: { names: ["--cwd"], type: "string" },
  });

  return { ...parsed, cwd: parsed.cwd ?? process.cwd() };
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
 * Run the init command. Returns the process exit code.
 */
export async function runInit(args: string[]): Promise<number> {
  let options: ReturnType<typeof parseInitArgs>;
  try {
    options = parseInitArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}`);
      console.error('Run "chaperone init --help" for usage information.');
      return EXIT.ERROR;
    }
    throw error;
  }

  if (options.help) {
    showInitHelp();
    return EXIT.OK;
  }

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
    return EXIT.OK;
  }

  // Write configuration
  console.log(`Creating ${getConfigFilename()}...`);

  const result = writeConfig(cwd, config, {
    force: options.force,
    dryRun: options.dryRun,
  });

  if (result.success) {
    console.log(`✅ Configuration created!`);
    return EXIT.OK;
  }

  console.error(`❌ ${result.message}`);
  return EXIT.ERROR;
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
