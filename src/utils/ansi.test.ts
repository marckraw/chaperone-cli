import { describe, expect, test } from "bun:test";
import { createPalette, shouldUseColor, stripAnsi } from "./ansi";
import { createSpinner } from "./spinner";

describe("shouldUseColor", () => {
  test("colours only interactive terminals by default", () => {
    expect(shouldUseColor({ isTTY: true }, {})).toBe(true);
    expect(shouldUseColor({ isTTY: false }, {})).toBe(false);
    expect(shouldUseColor({}, {})).toBe(false);
  });

  test("honours NO_COLOR and FORCE_COLOR", () => {
    expect(shouldUseColor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(shouldUseColor({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
    expect(shouldUseColor({ isTTY: true }, { FORCE_COLOR: "0" })).toBe(false);
  });
});

describe("createPalette", () => {
  test("a disabled palette produces no escape codes", () => {
    const colors = createPalette(false);
    expect(`${colors.red}x${colors.reset}`).toBe("x");
  });

  test("stripAnsi removes escape sequences", () => {
    const colors = createPalette(true);
    expect(stripAnsi(`\r\x1b[K\x1b[?25h${colors.bold}x${colors.reset}`)).toBe("\rx");
  });
});

describe("createSpinner", () => {
  test("a disabled spinner writes nothing", () => {
    const writes: string[] = [];
    const spinner = createSpinner("", { enabled: false, stream: { write: (chunk) => writes.push(chunk) } });
    spinner.start("Working");
    spinner.succeed("Done");
    spinner.stop();
    expect(writes).toEqual([]);
  });

  test("stop() on a spinner that never started writes nothing", () => {
    const writes: string[] = [];
    const spinner = createSpinner("", { enabled: true, stream: { write: (chunk) => writes.push(chunk) } });
    spinner.stop();
    expect(writes).toEqual([]);
  });
});
