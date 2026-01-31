#!/usr/bin/env bun

/**
 * Multi-platform build script for Chaperone CLI
 *
 * Builds single executables for multiple platforms using Bun's compile feature
 */

import { $ } from "bun";
import { dirname, join } from "path";

// Get the directory where this script lives
const ROOT_DIR = dirname(import.meta.path);
const SRC_CLI = join(ROOT_DIR, "src", "cli.ts");
const BIN_DIR = join(ROOT_DIR, "bin");

interface BuildTarget {
  name: string;
  target: string;
  extension: string;
}

const TARGETS: BuildTarget[] = [
  { name: "darwin-arm64", target: "bun-darwin-arm64", extension: "" },
  { name: "darwin-x64", target: "bun-darwin-x64", extension: "" },
  { name: "linux-x64", target: "bun-linux-x64", extension: "" },
  { name: "linux-arm64", target: "bun-linux-arm64", extension: "" },
  { name: "windows-x64", target: "bun-windows-x64", extension: ".exe" },
];

async function build(targets: BuildTarget[]): Promise<void> {
  // Ensure bin directory exists
  await $`mkdir -p ${BIN_DIR}`;

  for (const { name, target, extension } of targets) {
    const outputName = `chaperone-${name}${extension}`;
    const outputPath = join(BIN_DIR, outputName);
    console.log(`Building ${outputName}...`);

    try {
      await $`bun build ${SRC_CLI} --compile --minify --bytecode --target=${target} --outfile=${outputPath}`;
      console.log(`  ✅ Created bin/${outputName}`);
    } catch (error) {
      console.error(`  ❌ Failed to build ${outputName}`);
      if (error instanceof Error) {
        console.error(`     ${error.message}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const buildAll = args.includes("--all");

  console.log("🔨 Chaperone Build Script");
  console.log("");

  if (buildAll) {
    console.log("Building for all platforms...");
    console.log("");
    await build(TARGETS);
  } else {
    // Build only for current platform
    const platform = process.platform;
    const arch = process.arch;
    const currentTarget = `${platform}-${arch === "arm64" ? "arm64" : "x64"}`;

    const target = TARGETS.find((t) => t.name === currentTarget);
    if (target) {
      console.log(`Building for current platform (${currentTarget})...`);
      console.log("");
      await build([target]);
    } else {
      console.error(`Unknown platform: ${currentTarget}`);
      process.exit(1);
    }
  }

  console.log("");
  console.log("Build complete!");
}

main();
