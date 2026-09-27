import { describe, expect, test } from "bun:test";
import { parseArgs, UsageError } from "./args";

const SPEC = {
  format: { names: ["--format", "-f"], type: "string", choices: ["text", "json", "ai"] },
  quiet: { names: ["--quiet", "-q"], type: "boolean" },
  cwd: { names: ["--cwd"], type: "string" },
} as const;

describe("parseArgs", () => {
  test("parses booleans, values and --flag=value", () => {
    expect(parseArgs(["-q", "--format", "json", "--cwd=/tmp/x"], SPEC)).toEqual({
      quiet: true,
      format: "json",
      cwd: "/tmp/x",
    });
  });

  test("rejects unknown options", () => {
    expect(() => parseArgs(["--bogus"], SPEC)).toThrow(new UsageError("Unknown option: --bogus"));
  });

  test("rejects unexpected positional arguments", () => {
    expect(() => parseArgs(["src"], SPEC)).toThrow("Unexpected argument: src");
  });

  test("rejects values outside the allowed choices", () => {
    expect(() => parseArgs(["--format", "xml"], SPEC)).toThrow('Invalid value for --format: "xml"');
  });

  test("rejects missing values", () => {
    expect(() => parseArgs(["--format"], SPEC)).toThrow("Option --format requires a value");
    expect(() => parseArgs(["--cwd", "--quiet"], SPEC)).toThrow("Option --cwd requires a value");
  });

  test("rejects values on boolean flags", () => {
    expect(() => parseArgs(["--quiet=yes"], SPEC)).toThrow("does not take a value");
  });
});
