#!/usr/bin/env bun

/**
 * Entry point. The launcher runs first: when the project pins another Chaperone version, it runs
 * that version instead and this binary's commands are never loaded. The commands are imported
 * lazily for that reason (keep it that way: a static import here would make every hand-over pay
 * for loading the checks, zod and the AI SDK).
 */

import { runLauncher } from "./launcher";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let launch: Awaited<ReturnType<typeof runLauncher>>;
  try {
    launch = await runLauncher(args);
  } catch (error) {
    console.error(`chaperone: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  if (launch.kind === "exit") process.exit(launch.code);

  const { runCommand } = await import("./main");
  process.exit(await runCommand(args, launch.context));
}

main();
