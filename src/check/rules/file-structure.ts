import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, FileStructureRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

/**
 * Discover directories matching a glob pattern like "src/features/*".
 * We glob for any file under the pattern, then extract unique parent directories.
 */
function discoverDirectories(
  parentDirs: string,
  cwd: string,
  ignore: string[]
): string[] {
  // The parentDirs pattern like "src/features/*" means we want to find
  // directories that match. We'll split the pattern to find the base and wildcard.
  const parts = parentDirs.split("/");
  const lastPart = parts[parts.length - 1];

  if (lastPart === "*") {
    // Simple case: parent/dir/* — list directories in parent/dir
    const parentPath = parts.slice(0, -1).join("/");
    const fullParentPath = join(cwd, parentPath);

    if (!existsSync(fullParentPath)) {
      return [];
    }

    try {
      const entries = readdirSync(fullParentPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => join(parentPath, e.name));
    } catch {
      return [];
    }
  }

  // For more complex patterns, glob for files and extract unique dir paths
  const files = globSync(parentDirs + "/**/*", { cwd, ignore });
  const dirs = new Set<string>();
  for (const file of files) {
    // Extract the directory that matches the pattern level
    const fileParts = file.split("/");
    if (fileParts.length > parts.length) {
      const dirPath = fileParts.slice(0, parts.length).join("/");
      dirs.add(dirPath);
    }
  }
  return Array.from(dirs).sort();
}

export async function runFileStructureRule(
  rule: FileStructureRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  const allExcludes = [...exclude, ...(rule.exclude ?? [])];
  const directories = discoverDirectories(rule.parentDirs, cwd, allExcludes);

  for (const dir of directories) {
    const fullDirPath = join(cwd, dir);
    const dirName = basename(dir);

    let entries: string[];
    try {
      entries = readdirSync(fullDirPath).map((e) => e);
    } catch {
      continue;
    }

    // Check required entries
    for (const req of rule.required) {
      if (!entries.includes(req)) {
        results.push({
          file: dir,
          rule: `file-structure/${rule.id}`,
          message:
            rule.message ||
            `Directory "${dir}" is missing required entry: ${req}`,
          severity: rule.severity,
          source: "custom",
          context: {
            expectedValue: req,
            actualValue: "missing",
          },
        });
      }
    }

    // Check strict mode — no unlisted entries
    if (rule.strict) {
      const allowedEntries = new Set([
        ...rule.required,
        ...(rule.optional ?? []),
      ]);

      for (const entry of entries) {
        if (!allowedEntries.has(entry)) {
          results.push({
            file: join(dir, entry),
            rule: `file-structure/${rule.id}`,
            message:
              rule.message ||
              `Unexpected entry "${entry}" in "${dir}". Allowed: ${Array.from(allowedEntries).join(", ")}`,
            severity: rule.severity,
            source: "custom",
            context: {
              actualValue: entry,
            },
          });
        }
      }
    }
  }

  return {
    ruleId: rule.id,
    results,
  };
}

export function isFileStructureRule(rule: unknown): rule is FileStructureRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as FileStructureRule).type === "file-structure"
  );
}
