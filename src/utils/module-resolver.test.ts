import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { parseJsonc } from "./jsonc";
import { createModuleResolver, matchTsconfigPaths } from "./module-resolver";

afterEach(cleanupProjects);

describe("parseJsonc", () => {
  test("accepts comments and trailing commas, and keeps // inside strings", () => {
    expect(
      parseJsonc(`{
        // comment
        "a": "http://example.com", /* block */
        "b": [1, 2,],
      }`)
    ).toEqual({ a: "http://example.com", b: [1, 2] });
  });
});

describe("matchTsconfigPaths", () => {
  test("prefers exact matches, then the longest prefix", () => {
    const paths = {
      pathsBase: "/root",
      paths: { "@/*": ["src/*"], "@/features/*": ["src/modules/*"], "@config": ["config/index.ts"] },
    };
    expect(matchTsconfigPaths("@/features/auth", paths)).toEqual(["/root/src/modules/auth"]);
    expect(matchTsconfigPaths("@/shared/ui", paths)).toEqual(["/root/src/shared/ui"]);
    expect(matchTsconfigPaths("@config", paths)).toEqual(["/root/config/index.ts"]);
    expect(matchTsconfigPaths("react", paths)).toEqual([]);
  });
});

describe("createModuleResolver", () => {
  test("resolves relative files, directory index files and .js specifiers for .ts sources", () => {
    const root = makeProject({
      "src/app/main.ts": "",
      "src/features/auth/index.ts": "",
      "src/lib/util.ts": "",
      "src/lib/view.tsx": "",
      "src/data.json": "{}",
    });
    const resolver = createModuleResolver({ root });

    expect(resolver.resolve("../features/auth", "src/app/main.ts")).toBe("src/features/auth/index.ts");
    expect(resolver.resolve("../lib/util", "src/app/main.ts")).toBe("src/lib/util.ts");
    expect(resolver.resolve("../lib/util.js", "src/app/main.ts")).toBe("src/lib/util.ts");
    expect(resolver.resolve("../lib/view.js", "src/app/main.ts")).toBe("src/lib/view.tsx");
    expect(resolver.resolve("../data.json", "src/app/main.ts")).toBe("src/data.json");
    expect(resolver.resolve("../missing", "src/app/main.ts")).toBeNull();
    expect(resolver.resolve("react", "src/app/main.ts")).toBeNull();
    expect(resolver.resolve("../../../outside", "src/app/main.ts")).toBeNull();
  });

  test("resolves tsconfig paths aliases from the nearest tsconfig.json", () => {
    const root = makeProject({
      "tsconfig.json": `{
        // JSONC is fine
        "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },
      }`,
      "src/app/main.ts": "",
      "src/features/auth/index.ts": "",
      "src/shared/ui/button.tsx": "",
    });
    const resolver = createModuleResolver({ root });

    expect(resolver.resolve("@/features/auth", "src/app/main.ts")).toBe("src/features/auth/index.ts");
    expect(resolver.resolve("@/shared/ui/button", "src/app/main.ts")).toBe("src/shared/ui/button.tsx");
    expect(resolver.resolve("@/missing", "src/app/main.ts")).toBeNull();
  });

  test("follows extends, and resolves paths relative to the config that declares them", () => {
    const root = makeProject({
      "tsconfig.json": `{ "extends": "./apps/web/tsconfig.json", "include": ["apps/web/src"] }`,
      "apps/web/tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      "apps/web/src/app/main.ts": "",
      "apps/web/src/features/x/index.ts": "",
      "packages/client/src/index.ts": "",
    });
    const resolver = createModuleResolver({ root });

    expect(resolver.resolve("@/features/x", "apps/web/src/app/main.ts")).toBe("apps/web/src/features/x/index.ts");
    // Files outside apps/web use the root tsconfig, which inherits the same alias
    expect(resolver.resolve("@/features/x", "packages/client/src/index.ts")).toBe(
      "apps/web/src/features/x/index.ts"
    );
  });

  test("uses baseUrl for paths and for bare specifiers", () => {
    const root = makeProject({
      "tsconfig.json": `{ "compilerOptions": { "baseUrl": "src", "paths": { "~/*": ["*"] } } }`,
      "src/components/button.ts": "",
      "src/app.ts": "",
    });
    const resolver = createModuleResolver({ root });

    expect(resolver.resolve("~/components/button", "src/app.ts")).toBe("src/components/button.ts");
    expect(resolver.resolve("components/button", "src/app.ts")).toBe("src/components/button.ts");
  });

  test("follows extends into packages", () => {
    const root = makeProject({
      "node_modules/@repo/tsconfig/base.json": `{ "compilerOptions": { "baseUrl": "../../../", "paths": { "#/*": ["src/*"] } } }`,
      "tsconfig.json": `{ "extends": "@repo/tsconfig/base" }`,
      "src/a.ts": "",
      "src/b.ts": "",
    });
    const resolver = createModuleResolver({ root });
    expect(resolver.resolve("#/b", "src/a.ts")).toBe("src/b.ts");
  });

  test("looks into project references when the nearest config has no paths", () => {
    const root = makeProject({
      "tsconfig.json": `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }`,
      "tsconfig.app.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      "src/a.ts": "",
      "src/b.ts": "",
    });
    const resolver = createModuleResolver({ root });
    expect(resolver.resolve("@/b", "src/a.ts")).toBe("src/b.ts");
  });

  test("does not resolve aliases when tsconfig paths are disabled", () => {
    const root = makeProject({
      "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      "src/a.ts": "",
      "src/b.ts": "",
    });
    expect(createModuleResolver({ root, useTsconfigPaths: false }).resolve("@/b", "src/a.ts")).toBeNull();
  });

  test("only reports files the caller says exist", () => {
    const root = makeProject({ "src/a.ts": "", "src/b.ts": "" });
    const resolver = createModuleResolver({ root, fileExists: (path) => path === "src/a.ts" });
    expect(resolver.resolve("./b", "src/a.ts")).toBeNull();
  });
});
