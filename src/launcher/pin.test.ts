import { describe, expect, test } from "bun:test";
import {
  checkPinValue,
  formatPinHint,
  isMisspelledPinKey,
  normalizeVersion,
  readPin,
  shouldShowPinHint,
  type PinState,
} from "./pin";

describe("normalizeVersion", () => {
  test("accepts exact versions, with or without a leading v", () => {
    expect(normalizeVersion("0.10.0")).toBe("0.10.0");
    expect(normalizeVersion("v0.10.0")).toBe("0.10.0");
    expect(normalizeVersion("1.2.3-rc.1")).toBe("1.2.3-rc.1");
    expect(normalizeVersion("v10.20.30")).toBe("10.20.30");
  });

  test("rejects ranges, partial versions, build metadata and leading zeros", () => {
    for (const input of ["0.10", "^0.10.0", "~0.10.0", ">=0.10.0", "0.10.x", "latest", "", " 0.10.0", "0.10.0+abc", "01.2.3", "V0.10.0", "0.10.0.1"]) {
      expect(normalizeVersion(input)).toBeNull();
    }
  });
});

describe("checkPinValue", () => {
  test("returns the bare version", () => {
    expect(checkPinValue("0.9.0")).toEqual({ ok: true, version: "0.9.0" });
    expect(checkPinValue("v0.9.0")).toEqual({ ok: true, version: "0.9.0" });
  });

  test("a range is an error with the version it probably meant", () => {
    const check = checkPinValue("^0.9.0");
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toBe(
      '"chaperoneVersion" must be an exact version, such as "0.10.0", not a range (got "^0.9.0") (did you mean "0.9.0"?)'
    );
    expect(!checkPinValue("0.9.x").ok && (checkPinValue("0.9.x") as { message: string }).message).toContain("not a range");
  });

  test("suggests the closest exact version", () => {
    const suggestion = (input: string) => {
      const check = checkPinValue(input);
      return check.ok ? null : /did you mean "([^"]+)"/.exec(check.message)?.[1] ?? null;
    };
    expect(suggestion("0.9")).toBe("0.9.0");
    expect(suggestion(" 0.9.0 ")).toBe("0.9.0");
    expect(suggestion("V0.9.0")).toBe("0.9.0");
    expect(suggestion("0.9.0+build.5")).toBe("0.9.0");
    expect(suggestion("01.2.3")).toBe("1.2.3");
    expect(suggestion(">=0.8")).toBe("0.8.0");
    expect(suggestion("chaperone v0.9.0")).toBe("0.9.0");
    expect(suggestion("nope")).toBeNull();
  });

  test('"latest" and empty values point at chaperone pin', () => {
    for (const input of ["latest", "", "*"]) {
      const check = checkPinValue(input);
      expect(!check.ok && check.message).toContain('run "chaperone pin"');
    }
  });

  test("a number or other non-string is an error", () => {
    const check = checkPinValue(0.1);
    expect(!check.ok && check.message).toBe(
      '"chaperoneVersion" must be a string with an exact version, such as "0.10.0" (got number)'
    );
    expect(checkPinValue(null).ok).toBe(false);
    expect(checkPinValue(["0.9.0"]).ok).toBe(false);
  });
});

describe("isMisspelledPinKey", () => {
  test("catches near misses of chaperoneVersion", () => {
    for (const key of ["chaperone_version", "chaperone-version", "ChaperoneVersion", "chaperoneversion", "chaperoneVerison", "chaperoneVersions", "chaperonVersion"]) {
      expect(isMisspelledPinKey(key)).toBe(true);
    }
  });

  test("leaves the real field and unrelated fields alone", () => {
    for (const key of ["chaperoneVersion", "version", "chaperone", "extends", "rules", "$schema", "description"]) {
      expect(isMisspelledPinKey(key)).toBe(false);
    }
  });
});

describe("readPin", () => {
  test("no field, no pin", () => {
    expect(readPin({ version: "1.0.0" })).toEqual({ kind: "none" });
    expect(readPin(null)).toEqual({ kind: "none" });
    expect(readPin([])).toEqual({ kind: "none" });
  });

  test("a valid field pins its normalized version", () => {
    expect(readPin({ chaperoneVersion: "v0.8.0" })).toEqual({ kind: "pinned", version: "0.8.0" });
  });

  test("an invalid value or a misspelled key is invalid, never 'no pin'", () => {
    expect(readPin({ chaperoneVersion: "latest" }).kind).toBe("invalid");
    const misspelled = readPin({ chaperone_version: "0.8.0" });
    expect(misspelled).toEqual({
      kind: "invalid",
      message: 'unknown field "chaperone_version" (did you mean "chaperoneVersion"?): a misspelled version pin pins nothing',
    });
  });

  test("the real field wins over a misspelled one", () => {
    expect(readPin({ chaperoneVersion: "0.8.0", chaperone_version: "0.7.0" })).toEqual({ kind: "pinned", version: "0.8.0" });
  });
});

describe("the hint to pin", () => {
  const none: PinState = { kind: "none" };
  const base = { pin: none, hasConfig: true, format: "text", quiet: false, stderrIsTTY: true };

  test("shows after a text report on a terminal when the config pins nothing", () => {
    expect(shouldShowPinHint(base)).toBe(true);
  });

  test("stays quiet for machine output, --quiet, pipes, pinned configs and missing configs", () => {
    expect(shouldShowPinHint({ ...base, format: "json" })).toBe(false);
    expect(shouldShowPinHint({ ...base, format: "ai" })).toBe(false);
    expect(shouldShowPinHint({ ...base, quiet: true })).toBe(false);
    expect(shouldShowPinHint({ ...base, stderrIsTTY: false })).toBe(false);
    expect(shouldShowPinHint({ ...base, hasConfig: false })).toBe(false);
    expect(shouldShowPinHint({ ...base, pin: { kind: "pinned", version: "0.9.0" } })).toBe(false);
    expect(shouldShowPinHint({ ...base, pin: { kind: "invalid", message: "x" } })).toBe(false);
  });

  test("is one line naming the command and the field", () => {
    const hint = formatPinHint("0.10.0", ".chaperone.json");
    expect(hint).toBe('Tip: pin Chaperone for this repository with "chaperone pin" (writes "chaperoneVersion": "0.10.0" to .chaperone.json).');
    expect(hint).not.toContain("\n");
  });
});
