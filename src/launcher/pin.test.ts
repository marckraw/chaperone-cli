import { describe, expect, test } from "bun:test";
import {
  checkPinValue,
  defaultFromConfigText,
  defaultFromEnv,
  formatPinHint,
  isMisspelledDefaultKey,
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

  test("names the machine default when it chose the version, and the version to pin", () => {
    const file = formatPinHint("0.10.1", ".chaperone.json", { origin: { kind: "file", label: "~/.config/chaperone/config.json" } });
    expect(file).toBe(
      'Tip: this repository runs the machine default (Chaperone 0.10.1, in ~/.config/chaperone/config.json); pin it with "chaperone pin 0.10.1" (writes "chaperoneVersion": "0.10.1" to .chaperone.json).'
    );
    const env = formatPinHint("0.10.1", ".chaperone.json", { origin: { kind: "env" } });
    expect(env).toContain("(Chaperone 0.10.1, from CHAPERONE_DEFAULT_VERSION)");
    expect(env).not.toContain("\n");
  });
});

describe("defaultFromEnv: CHAPERONE_DEFAULT_VERSION", () => {
  test("unset or empty: the config file decides", () => {
    expect(defaultFromEnv(undefined)).toBeNull();
    expect(defaultFromEnv("")).toBeNull();
  });

  test("an exact version, with or without a leading v", () => {
    expect(defaultFromEnv("0.7.1")).toEqual({ kind: "set", version: "0.7.1", origin: { kind: "env" } });
    expect(defaultFromEnv("v0.7.1")).toEqual({ kind: "set", version: "0.7.1", origin: { kind: "env" } });
  });

  test("anything else is invalid, by the pin's own parser, naming the variable", () => {
    expect(defaultFromEnv("latest")).toEqual({
      kind: "invalid",
      message: 'CHAPERONE_DEFAULT_VERSION must be an exact version, such as "0.10.0" (got "latest")',
      origin: { kind: "env" },
    });
    const range = defaultFromEnv("^0.7");
    expect(range?.kind === "invalid" && range.message).toBe(
      'CHAPERONE_DEFAULT_VERSION must be an exact version, such as "0.10.0", not a range (got "^0.7") (did you mean "0.7.0"?)'
    );
    expect(defaultFromEnv(" ")?.kind).toBe("invalid");
  });
});

describe("defaultFromConfigText: the machine config file", () => {
  const label = "~/.config/chaperone/config.json";
  const origin = { kind: "file", label } as const;
  const read = (config: unknown) => defaultFromConfigText(JSON.stringify(config), label);
  const message = (config: unknown) => {
    const result = read(config);
    return result.kind === "invalid" ? result.message : null;
  };

  test("no file, or no field: no default", () => {
    expect(defaultFromConfigText(null, label)).toEqual({ kind: "none" });
    expect(read({})).toEqual({ kind: "none" });
    expect(read({ someOtherSetting: true })).toEqual({ kind: "none" });
  });

  test("reads defaultVersion, keeping other fields out of it", () => {
    expect(read({ defaultVersion: "v0.7.1", someOtherSetting: true })).toEqual({ kind: "set", version: "0.7.1", origin });
  });

  test("an invalid value is invalid, with the pin parser's message for the field", () => {
    expect(message({ defaultVersion: "latest" })).toBe('"defaultVersion" must be an exact version, such as "0.10.0" (got "latest")');
    expect(message({ defaultVersion: "~0.7.1" })).toContain('not a range (got "~0.7.1") (did you mean "0.7.1"?)');
    expect(message({ defaultVersion: 0.7 })).toBe('"defaultVersion" must be a string with an exact version, such as "0.10.0" (got number)');
    expect(message({ defaultVersion: null })).toContain("(got null)");
  });

  test("a misspelled field, or the project's pin field, sets nothing and is invalid", () => {
    expect(message({ default_version: "0.7.1" })).toBe(
      'unknown field "default_version" (did you mean "defaultVersion"?): a misspelled machine default sets nothing'
    );
    expect(message({ chaperoneVersion: "0.7.1" })).toBe(
      'unknown field "chaperoneVersion" (did you mean "defaultVersion"?): "chaperoneVersion" pins a repository, in its own .chaperone.json'
    );
    // The real field wins over a misspelled one
    expect(read({ defaultVersion: "0.7.1", default_version: "0.6.0" })).toEqual({ kind: "set", version: "0.7.1", origin });
  });

  test("a file that is not a JSON object is invalid, never 'no default'", () => {
    const broken = defaultFromConfigText("{ nope", label);
    expect(broken).toMatchObject({ kind: "invalid", origin });
    expect(broken.kind === "invalid" && broken.message).toStartWith("the file is not valid JSON (");
    expect(defaultFromConfigText("", label).kind).toBe("invalid");
    expect(message(["0.7.1"])).toBe('the file must hold a JSON object, such as { "defaultVersion": "0.10.0" }');
    expect(message("0.7.1")).toContain("must hold a JSON object");
  });
});

describe("isMisspelledDefaultKey", () => {
  test("catches near misses of defaultVersion, and the project's pin field", () => {
    for (const key of ["default_version", "default-version", "DefaultVersion", "defaultversion", "defaultVerison", "defaultVersions", "chaperoneVersion", "chaperone_version"]) {
      expect(isMisspelledDefaultKey(key)).toBe(true);
    }
  });

  test("leaves the real field and unrelated fields alone", () => {
    for (const key of ["defaultVersion", "version", "default", "defaults", "cacheDir", "$schema", "releasesUrl"]) {
      expect(isMisspelledDefaultKey(key)).toBe(false);
    }
  });
});
