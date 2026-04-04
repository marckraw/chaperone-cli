import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runDirectiveExportPatternRule } from "./directive-export-pattern";

const tempDirs: string[] = [];

function makeProject(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "chaperone-directive-export-pattern-"));
  tempDirs.push(cwd);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(cwd, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  return cwd;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("runDirectiveExportPatternRule", () => {
  test("allows component and hook exports from use client files", async () => {
    const cwd = makeProject({
      "src/button.tsx": `"use client"\n\nexport function Button() {}\nexport function useButtonState() {}\n`,
    });

    const result = await runDirectiveExportPatternRule(
      {
        type: "directive-export-pattern",
        id: "use-client-exports",
        severity: "error",
        files: "src/**/*.{ts,tsx}",
        directive: "use client",
        allowedExportNamePatterns: ["^[A-Z][A-Za-z0-9]*$", "^use[A-Z][A-Za-z0-9]*$"],
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(0);
  });

  test("flags utility exports from use client files", async () => {
    const cwd = makeProject({
      "src/button.tsx": `"use client"\n\nconst buttonVariants = {};\nfunction Button() {}\nexport { Button, buttonVariants }\n`,
    });

    const result = await runDirectiveExportPatternRule(
      {
        type: "directive-export-pattern",
        id: "use-client-exports",
        severity: "error",
        files: "src/**/*.{ts,tsx}",
        directive: "use client",
        allowedExportNamePatterns: ["^[A-Z][A-Za-z0-9]*$", "^use[A-Z][A-Za-z0-9]*$"],
        message: "use client files should export only components/hooks",
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.message).toBe("use client files should export only components/hooks");
    expect(result.results[0]?.context?.matchedText).toBe("buttonVariants");
  });

  test("ignores non-client files", async () => {
    const cwd = makeProject({
      "src/button.tsx": `export const buttonVariants = {};\n`,
    });

    const result = await runDirectiveExportPatternRule(
      {
        type: "directive-export-pattern",
        id: "use-client-exports",
        severity: "error",
        files: "src/**/*.{ts,tsx}",
        directive: "use client",
        allowedExportNamePatterns: ["^[A-Z][A-Za-z0-9]*$", "^use[A-Z][A-Za-z0-9]*$"],
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(0);
  });
});
