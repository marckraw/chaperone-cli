/**
 * Strict command-line argument parsing shared by every command.
 */

/**
 * Process exit codes, shared by every command.
 */
export const EXIT = {
  /** Everything passed */
  OK: 0,
  /** The check ran and found errors */
  VIOLATIONS: 1,
  /** Chaperone could not do its job: invalid configuration, bad usage, or an internal error */
  ERROR: 2,
} as const;

/**
 * Invalid command-line usage (unknown flag, missing value, bad choice). Maps to exit code 2.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface FlagSpec {
  /** Accepted spellings, e.g. ["--format", "-f"] */
  names: readonly string[];
  type: "boolean" | "string";
  /** Allowed values for string flags */
  choices?: readonly string[];
}

type ParsedFlags<T extends Record<string, FlagSpec>> = {
  [K in keyof T]?: T[K]["type"] extends "boolean" ? boolean : string;
};

/**
 * Parse `args` against `spec`. Accepts `--flag value` and `--flag=value`.
 *
 * @throws {UsageError} for unknown flags, unexpected positional arguments,
 * missing values and values outside `choices`.
 */
export function parseArgs<T extends Record<string, FlagSpec>>(args: readonly string[], spec: T): ParsedFlags<T> {
  const result: Record<string, boolean | string> = {};
  const byName = new Map<string, [string, FlagSpec]>();
  for (const [key, flag] of Object.entries(spec)) {
    for (const name of flag.names) byName.set(name, [key, flag]);
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const entry = byName.get(name);

    if (!entry) {
      if (arg.startsWith("-")) {
        throw new UsageError(`Unknown option: ${name}`);
      }
      throw new UsageError(`Unexpected argument: ${arg}`);
    }

    const [key, flag] = entry;
    if (flag.type === "boolean") {
      if (equals !== -1) {
        throw new UsageError(`Option ${name} does not take a value`);
      }
      result[key] = true;
      continue;
    }

    let value: string | undefined;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else {
      value = args[index + 1];
      if (value === undefined || (value.startsWith("-") && value.length > 1)) {
        throw new UsageError(`Option ${name} requires a value`);
      }
      index++;
    }

    if (flag.choices && !flag.choices.includes(value)) {
      throw new UsageError(
        `Invalid value for ${name}: "${value}". Expected one of: ${flag.choices.join(", ")}`
      );
    }
    result[key] = value;
  }

  return result as ParsedFlags<T>;
}
