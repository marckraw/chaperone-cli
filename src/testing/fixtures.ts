/**
 * Test helpers: small temporary project trees.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const created: string[] = [];

/**
 * Create a temporary directory populated with `files` (relative path → content).
 * A value of `{ symlink: "target" }` creates a symlink instead.
 */
export function makeProject(files: Record<string, string | { symlink: string }> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "chaperone-test-"));
  created.push(root);
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: Record<string, string | { symlink: string }>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    if (typeof content === "string") {
      writeFileSync(fullPath, content);
    } else {
      symlinkSync(content.symlink, fullPath);
    }
  }
}

/**
 * Remove every directory created by {@link makeProject}. Call from afterEach.
 */
export function cleanupProjects(): void {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}
