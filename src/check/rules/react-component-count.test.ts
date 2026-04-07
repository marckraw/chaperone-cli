import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runReactComponentCountRule } from "./react-component-count";

const tempDirs: string[] = [];

function makeProject(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "chaperone-react-component-count-"));
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

describe("runReactComponentCountRule", () => {
  test("passes when a file contains only one React component", async () => {
    const cwd = makeProject({
      "src/button.tsx": `export function Button() {\n  return <button />;\n}\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
        maxComponents: 1,
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(0);
  });

  test("flags files with multiple top-level React components", async () => {
    const cwd = makeProject({
      "src/button.tsx": `export function Button() {\n  return <button />;\n}\n\nfunction ButtonIcon() {\n  return <svg />;\n}\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
        maxComponents: 1,
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.line).toBe(5);
    expect(result.results[0]?.context?.actualValue).toContain("Button");
    expect(result.results[0]?.context?.actualValue).toContain("ButtonIcon");
  });

  test("ignores hooks and PascalCase values that are not React components", async () => {
    const cwd = makeProject({
      "src/button.tsx": `const APIUrl = "https://example.com";\n\nexport function useButtonState() {\n  return { APIUrl };\n}\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(0);
  });

  test("counts memo and forwardRef component declarations", async () => {
    const cwd = makeProject({
      "src/button.tsx": `import { forwardRef, memo } from "react";\n\nconst Button = memo(function Button() {\n  return <button />;\n});\n\nconst ButtonIcon = forwardRef(function ButtonIcon(_props, ref) {\n  return <svg ref={ref} />;\n});\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
        maxComponents: 1,
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.context?.actualValue).toContain("Button");
    expect(result.results[0]?.context?.actualValue).toContain("ButtonIcon");
  });
});
