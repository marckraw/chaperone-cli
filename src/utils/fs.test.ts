import { afterEach, describe, expect, test } from "bun:test";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { existsCaseExact } from "./fs";

afterEach(cleanupProjects);

describe("existsCaseExact", () => {
  test("requires the exact case of every segment", () => {
    const cwd = makeProject({ "src/components/FanCard/fan-card.sb.ts": "" });
    expect(existsCaseExact(cwd, "src/components/FanCard/fan-card.sb.ts")).toBe(true);
    expect(existsCaseExact(cwd, "./src/components/FanCard/")).toBe(true);
    expect(existsCaseExact(cwd, "src/components/Fancard/fan-card.sb.ts")).toBe(false);
    expect(existsCaseExact(cwd, "src/components/FanCard/Fan-card.sb.ts")).toBe(false);
    expect(existsCaseExact(cwd, "src/missing/fan-card.sb.ts")).toBe(false);
  });

  test("compares names, so a filesystem that ignores case cannot answer for it", () => {
    const listing: Record<string, string[]> = { "/p": ["src"], "/p/src": ["Fancard"], "/p/src/Fancard": ["a.ts"] };
    const readDirectory = (directory: string) => listing[directory] ?? [];
    expect(existsCaseExact("/p", "src/Fancard/a.ts", readDirectory)).toBe(true);
    expect(existsCaseExact("/p", "src/FanCard/a.ts", readDirectory)).toBe(false);
  });
});
