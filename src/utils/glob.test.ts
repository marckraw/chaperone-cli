import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import {
  checkGlobSyntax,
  compileExcludes,
  globSync,
  matchGlob,
  staticPrefix,
  walkFiles,
} from "./glob";

afterEach(cleanupProjects);

describe("matchGlob", () => {
  test("a trailing ** matches everything below", () => {
    expect(matchGlob("src/a.ts", "src/**")).toBe(true);
    expect(matchGlob("src/a/b/c.ts", "src/**")).toBe(true);
    expect(matchGlob("lib/a.ts", "src/**")).toBe(false);
  });

  test("**/ matches zero or more directories", () => {
    expect(matchGlob("a.test.ts", "**/*.test.ts")).toBe(true);
    expect(matchGlob("src/deep/a.test.ts", "**/*.test.ts")).toBe(true);
    expect(matchGlob("src/a.ts", "**/*.test.ts")).toBe(false);
  });

  test("single * does not cross directories", () => {
    expect(matchGlob("src/check/rules/regex.ts", "src/check/rules/*.ts")).toBe(true);
    expect(matchGlob("src/check/rules/utils/x.ts", "src/check/rules/*.ts")).toBe(false);
  });

  test("supports braces, including nested braces", () => {
    expect(matchGlob("src/a.tsx", "src/**/*.{ts,tsx}")).toBe(true);
    expect(matchGlob("src/a/b.ts", "src/**/*.{ts,tsx}")).toBe(true);
    expect(matchGlob("src/a.js", "src/**/*.{ts,tsx}")).toBe(false);
    expect(matchGlob("src/c/x.ts", "src/{a,{b,c}}/*.ts")).toBe(true);
  });

  test("matches dotfiles with *", () => {
    expect(matchGlob(".github/workflows/ci.yml", "**/*.yml")).toBe(true);
    expect(matchGlob(".chaperone.json", "*.json")).toBe(true);
  });

  test("treats +, ( and ) as literal characters", () => {
    expect(matchGlob("src/routes/+page.svelte", "src/routes/+page.svelte")).toBe(true);
    expect(matchGlob("src/routes/+page.svelte", "src/**/*.svelte")).toBe(true);
    expect(matchGlob("src/app/(marketing)/a/page.tsx", "src/app/(marketing)/**/*.tsx")).toBe(true);
  });

  test("literal paths with brackets match unescaped, and escaped brackets work too", () => {
    expect(matchGlob("src/app/[id]/page.tsx", "src/app/[id]/page.tsx")).toBe(true);
    expect(matchGlob("src/app/[id]/page.tsx", "src/app/\\[id\\]/page.tsx")).toBe(true);
    expect(matchGlob("src/app/[id]/page.tsx", "src/app/**/page.tsx")).toBe(true);
  });

  test("ignores a leading ./", () => {
    expect(matchGlob("./src/a.ts", "./src/*.ts")).toBe(true);
  });
});

describe("staticPrefix", () => {
  test("returns the literal leading directories", () => {
    expect(staticPrefix("src/**/*.ts")).toBe("src/");
    expect(staticPrefix("apps/*/src/**")).toBe("apps/");
    expect(staticPrefix("**/*.ts")).toBe("");
    expect(staticPrefix("{src,lib}/*.ts")).toBe("");
    expect(staticPrefix("package.json")).toBe("package.json");
  });
});

describe("checkGlobSyntax", () => {
  test("accepts valid patterns", () => {
    expect(checkGlobSyntax("src/**/*.{ts,tsx}")).toBeNull();
    expect(checkGlobSyntax("src/app/\\[id\\]/page.tsx")).toBeNull();
  });

  test("reports unbalanced braces and brackets", () => {
    expect(checkGlobSyntax("src/*.{ts,tsx")).toContain("{");
    expect(checkGlobSyntax("src/*.ts}")).toContain("}");
    expect(checkGlobSyntax("src/[abc")).toContain("[");
    expect(checkGlobSyntax("  ")).toBe("pattern is empty");
  });
});

describe("compileExcludes", () => {
  test("a plain name matches that path segment at any depth, not a prefix", () => {
    const matcher = compileExcludes(["dist"]);
    expect(matcher.excludes("dist/index.js")).toBe(true);
    expect(matcher.excludes("packages/x/dist/index.js")).toBe(true);
    expect(matcher.excludes("distribution/index.js")).toBe(false);
    expect(matcher.excludes("src/dist.ts")).toBe(false);
  });

  test("a leading slash anchors a name to the project root", () => {
    const matcher = compileExcludes(["/build"]);
    expect(matcher.excludes("build/out.js")).toBe(true);
    expect(matcher.excludes("src/build/tool.ts")).toBe(false);
  });

  test("patterns with a slash are anchored and exclude everything below", () => {
    const matcher = compileExcludes(["src/generated"]);
    expect(matcher.excludes("src/generated/a.ts")).toBe(true);
    expect(matcher.excludes("src/generated")).toBe(true);
    expect(matcher.excludes("lib/src/generated/a.ts")).toBe(false);
    expect(matcher.excludes("src/generated-extra/a.ts")).toBe(false);
  });

  test("**/ patterns exclude at any depth, including the root", () => {
    const matcher = compileExcludes(["**/*.md", "**/__tests__/**"]);
    expect(matcher.excludes("AGENTS.md")).toBe(true);
    expect(matcher.excludes("docs/guide/intro.md")).toBe(true);
    expect(matcher.excludes("src/__tests__/a.ts")).toBe(true);
    expect(matcher.excludes("src/a.ts")).toBe(false);
  });

  test("braces work in excludes", () => {
    const matcher = compileExcludes(["**/*.test.{ts,tsx}"]);
    expect(matcher.excludes("src/a.test.tsx")).toBe(true);
    expect(matcher.excludes("src/a.test.ts")).toBe(true);
    expect(matcher.excludes("src/a.tsx")).toBe(false);
  });

  test("slash-less globs match names at any depth", () => {
    const matcher = compileExcludes(["*.d.ts"]);
    expect(matcher.excludes("types.d.ts")).toBe(true);
    expect(matcher.excludes("src/deep/types.d.ts")).toBe(true);
  });

  test("the last matching pattern wins and ! re-includes", () => {
    const matcher = compileExcludes(["build", "!src/build"]);
    expect(matcher.excludes("build/a.js")).toBe(true);
    expect(matcher.excludes("src/build/a.ts")).toBe(false);
    expect(matcher.excludes("lib/build/a.ts")).toBe(true);
  });
});

describe("walkFiles", () => {
  test("prunes excluded directories at any depth without reading them", () => {
    const root = makeProject({
      "src/a.ts": "",
      "node_modules/pkg/index.js": "",
      "packages/x/node_modules/pkg/index.js": "",
      "packages/x/src/b.ts": "",
      ".git/HEAD": "",
    });

    const visited: string[] = [];
    const files = walkFiles(root, {
      exclude: ["node_modules", ".git"],
      readDirectory: (path) => {
        visited.push(path);
        return readdirSync(path, { withFileTypes: true });
      },
    });

    expect(files).toEqual(["packages/x/src/b.ts", "src/a.ts"]);
    expect(visited.some((path) => path.includes("node_modules"))).toBe(false);
    expect(visited.some((path) => path.includes(".git"))).toBe(false);
  });

  test("handles paths containing +, (, ), [ and ]", () => {
    const root = makeProject({
      "src/routes/+page.svelte": "",
      "src/app/(marketing)/[slug]/page.tsx": "",
    });

    expect(walkFiles(root)).toEqual(["src/app/(marketing)/[slug]/page.tsx", "src/routes/+page.svelte"]);
  });

  test("includes symlinked files but does not follow symlinked directories", () => {
    const root = makeProject({
      "AGENTS.md": "# agents",
      "CLAUDE.md": { symlink: "AGENTS.md" },
      "real/a.ts": "",
      "linked": { symlink: "real" },
    });

    expect(walkFiles(root)).toEqual(["AGENTS.md", "CLAUDE.md", "real/a.ts"]);
  });

  test("walks only below the base directory", () => {
    const root = makeProject({ "a/x.ts": "", "b/y.ts": "" });
    expect(walkFiles(root, { base: "b" })).toEqual(["b/y.ts"]);
  });

  test("a negated exclude lets the walker enter an otherwise excluded directory", () => {
    const root = makeProject({ "build/a.js": "", "src/build/b.ts": "" });
    expect(walkFiles(root, { exclude: ["build", "!src/build"] })).toEqual(["src/build/b.ts"]);
  });
});

describe("globSync", () => {
  test("matches files below the pattern's literal base", () => {
    const root = makeProject({
      ".cursor/rules/a.mdc": "",
      ".cursor/rules/b.txt": "",
      "other/c.mdc": "",
    });

    expect(globSync(".cursor/rules/*.mdc", { cwd: root })).toEqual([".cursor/rules/a.mdc"]);
  });

  test("honours ignore patterns", () => {
    const root = makeProject({ "src/a.ts": "", "src/gen/b.ts": "" });
    expect(globSync("src/**/*.ts", { cwd: root, ignore: ["src/gen"] })).toEqual(["src/a.ts"]);
  });
});
