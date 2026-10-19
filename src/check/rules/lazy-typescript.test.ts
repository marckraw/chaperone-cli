import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { FAKE_BACKPACK, RESERVED_NAMES } from "../../testing/backbase-fixtures";
import { cleanupProjects, makeProject } from "../../testing/fixtures";

afterEach(cleanupProjects);

test("loading the rule engine and running unrelated rules leaves TypeScript unloaded", () => {
  const cwd = makeProject({ ...FAKE_BACKPACK, "src/components/Button.ts": "// TODO" });
  // A fresh process checks module evaluation, independent of other tests' imports.
  const script = `
    const { runAllRules } = await import(${JSON.stringify(join(import.meta.dir, "index.ts"))});
    const loaded = () => Object.keys(require.cache).some(path => /typescript[\\\\/]lib[\\\\/]typescript\\.js$/.test(path));
    const before = loaded();
    const options = { cwd: ${JSON.stringify(cwd)}, include: [], exclude: ["node_modules"] };
    const unrelated = await runAllRules({rules:{custom:[{type:"regex",id:"todo",severity:"error",files:"src/**/*.ts",pattern:"TODO",message:"No TODO"}]}}, options);
    const afterUnrelated = loaded();
    const native = await runAllRules({rules:{custom:[${JSON.stringify(RESERVED_NAMES)}]}}, options);
    console.log(JSON.stringify({before, afterUnrelated, afterNative:loaded(), unrelated:unrelated.results.length, native:native.results.length}));
  `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({
    before: false, afterUnrelated: false, afterNative: true, unrelated: 1, native: 1,
  });
});
