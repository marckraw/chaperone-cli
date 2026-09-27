import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { createFileIndex } from "./file-index";

afterEach(cleanupProjects);

describe("createFileIndex", () => {
  test("indexes files once, applying the global excludes", () => {
    const root = makeProject({
      "src/a.ts": "",
      "src/b.tsx": "",
      "node_modules/x/index.ts": "",
    });

    const index = createFileIndex(root, { exclude: ["node_modules"] });
    expect(index.files).toEqual(["src/a.ts", "src/b.tsx"]);
    expect(index.has("src/a.ts")).toBe(true);
    expect(index.has("node_modules/x/index.ts")).toBe(false);
  });

  test("glob answers from the index and applies rule excludes", () => {
    const index = createFileIndex("/virtual", {
      files: ["src/a.ts", "src/a.test.ts", "src/deep/b.ts", "srcx/c.ts", "lib/d.ts"],
    });

    expect(index.glob("src/**/*.ts")).toEqual(["src/a.test.ts", "src/a.ts", "src/deep/b.ts"]);
    expect(index.glob("src/**/*.ts", ["**/*.test.ts"])).toEqual(["src/a.ts", "src/deep/b.ts"]);
    expect(index.glob("**/*.ts", ["src"])).toEqual(["lib/d.ts", "srcx/c.ts"]);
    expect(index.glob("src/a.ts")).toEqual(["src/a.ts"]);
  });

  test("tracks directories that contain files", () => {
    const index = createFileIndex("/virtual", {
      files: ["src/features/auth/index.ts", "src/features/billing/ui/x.tsx", "README.md"],
    });

    expect(index.hasDirectory("src/features/auth")).toBe(true);
    expect(index.hasDirectory("src/features/missing")).toBe(false);
    expect(index.childDirectories("src/features")).toEqual([
      "src/features/auth",
      "src/features/billing",
    ]);
    expect(index.childDirectories("")).toEqual(["src"]);
  });

  test("reads each file at most once", () => {
    const root = makeProject({ "a.txt": "first" });
    const index = createFileIndex(root);

    expect(index.read("a.txt")).toBe("first");
    writeFileSync(join(root, "a.txt"), "second");
    expect(index.read("a.txt")).toBe("first");
    expect(index.read("missing.txt")).toBeNull();
  });
});
