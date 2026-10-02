import { describe, expect, test } from "bun:test";
import { formatMarker, isOwnMarker, parseMarker, type LaunchMarker } from "./marker";
import {
  compareVersionsDescending,
  defaultInUse,
  formatIgnoreNote,
  formatVersionLine,
  isTruthyEnv,
  planLaunch,
} from "./plan";
import { NO_DEFAULT, type MachineDefault, type PinState } from "./pin";

describe("the launch marker", () => {
  test("round-trips", () => {
    const marker: LaunchMarker = { version: "0.9.0", mode: "exec", pid: 4242 };
    expect(formatMarker(marker)).toBe("0.9.0 exec 4242");
    expect(parseMarker(formatMarker(marker))).toEqual(marker);
    expect(parseMarker("1.2.3-rc.1 spawn 7")).toEqual({ version: "1.2.3-rc.1", mode: "spawn", pid: 7 });
  });

  test("ignores anything else", () => {
    for (const value of [undefined, "", "1", "0.9.0 fork 1", "0.9.0 exec", "0.9.0 exec abc"]) {
      expect(parseMarker(value)).toBeNull();
    }
  });

  test("counts only in the process it was made for", () => {
    const exec: LaunchMarker = { version: "0.9.0", mode: "exec", pid: 100 };
    const spawn: LaunchMarker = { version: "0.9.0", mode: "spawn", pid: 100 };
    // exec: the pinned binary took over the launcher's pid
    expect(isOwnMarker(exec, { pid: 100, ppid: 1 })).toBe(true);
    // a child of the pinned binary (a command rule running chaperone) inherited it
    expect(isOwnMarker(exec, { pid: 101, ppid: 100 })).toBe(false);
    // spawn: the pinned binary is the launcher's child
    expect(isOwnMarker(spawn, { pid: 101, ppid: 100 })).toBe(true);
    expect(isOwnMarker(spawn, { pid: 102, ppid: 101 })).toBe(false);
  });
});

describe("planLaunch (the recursion guard)", () => {
  const pinned = (version: string): PinState => ({ kind: "pinned", version });
  const base = { selfVersion: "0.10.0", ownMarker: null, ignorePin: false, machineDefault: NO_DEFAULT };

  test("launches a pinned version that differs from this binary's", () => {
    expect(planLaunch({ ...base, pin: pinned("0.9.0") })).toEqual({ action: "launch", version: "0.9.0", source: "pin" });
  });

  test("never launches when the versions already match", () => {
    expect(planLaunch({ ...base, pin: pinned("0.10.0") })).toEqual({ action: "run-self", reason: "same-version" });
  });

  test("never launches from a process the launcher started", () => {
    const ownMarker: LaunchMarker = { version: "0.10.0", mode: "exec", pid: 1 };
    // Even if the config changed in between and now pins something else
    expect(planLaunch({ ...base, ownMarker, pin: pinned("0.11.0") })).toEqual({ action: "run-self", reason: "launched" });
  });

  test("fails when the launched binary is not the version it was launched as", () => {
    const ownMarker: LaunchMarker = { version: "0.9.0", mode: "exec", pid: 1 };
    const plan = planLaunch({ ...base, ownMarker, pin: pinned("0.9.0") });
    expect(plan.action).toBe("fail");
    expect(plan.action === "fail" && plan.message).toContain('launched as Chaperone 0.9.0, but it is 0.10.0');
    expect(plan.action === "fail" && plan.message).toContain('"chaperone cache clear 0.9.0"');
  });

  test("runs this binary without a usable pin", () => {
    expect(planLaunch({ ...base, pin: { kind: "none" } })).toEqual({ action: "run-self", reason: "no-pin" });
    expect(planLaunch({ ...base, pin: { kind: "invalid", message: "x" } })).toEqual({ action: "run-self", reason: "invalid-pin" });
  });

  test("CHAPERONE_IGNORE_PIN runs this binary", () => {
    expect(planLaunch({ ...base, ignorePin: true, pin: pinned("0.9.0") })).toEqual({ action: "run-self", reason: "ignored" });
  });
});

describe("formatVersionLine", () => {
  const base = { selfVersion: "0.10.0", configLabel: ".chaperone.json", cached: true, ignorePin: false, machineDefault: NO_DEFAULT };

  test("without a config: the version alone, as before", () => {
    expect(formatVersionLine({ ...base, configLabel: null, pin: { kind: "none" } })).toBe("chaperone v0.10.0");
  });

  test("with a config that pins nothing: says how to pin", () => {
    expect(formatVersionLine({ ...base, pin: { kind: "none" } })).toBe(
      'chaperone v0.10.0 (not pinned: "chaperone pin" pins it in .chaperone.json)'
    );
  });

  test("pinned to this version", () => {
    expect(formatVersionLine({ ...base, pin: { kind: "pinned", version: "0.10.0" } })).toBe(
      "chaperone v0.10.0 (pinned in .chaperone.json)"
    );
  });

  test("pinned to another version: that version first, then the launcher's", () => {
    expect(formatVersionLine({ ...base, pin: { kind: "pinned", version: "0.9.0" } })).toBe(
      "chaperone v0.9.0 (pinned in .chaperone.json, launched by v0.10.0)"
    );
    expect(formatVersionLine({ ...base, cached: false, pin: { kind: "pinned", version: "0.9.0" } })).toBe(
      "chaperone v0.9.0 (pinned in .chaperone.json, launched by v0.10.0; downloaded on first use)"
    );
  });

  test("an invalid pin and an ignored pin say so", () => {
    expect(formatVersionLine({ ...base, pin: { kind: "invalid", message: "bad" } })).toBe("chaperone v0.10.0 (.chaperone.json: bad)");
    expect(formatVersionLine({ ...base, ignorePin: true, pin: { kind: "pinned", version: "0.9.0" } })).toBe(
      "chaperone v0.10.0 (CHAPERONE_IGNORE_PIN is set: ignoring v0.9.0, pinned in .chaperone.json)"
    );
  });
});

const FILE = { kind: "file", label: "~/.config/chaperone/config.json" } as const;
const ENV = { kind: "env" } as const;
const fileDefault = (version: string): MachineDefault => ({ kind: "set", version, origin: FILE });
const envDefault = (version: string): MachineDefault => ({ kind: "set", version, origin: ENV });

describe("planLaunch with a machine default", () => {
  const base = { selfVersion: "0.10.1", ownMarker: null, ignorePin: false, pin: { kind: "none" } as PinState };

  test("where nothing is pinned, launches the machine default", () => {
    expect(planLaunch({ ...base, machineDefault: fileDefault("0.7.1") })).toEqual({
      action: "launch",
      version: "0.7.1",
      source: "default",
    });
    expect(planLaunch({ ...base, machineDefault: envDefault("0.8.0") })).toEqual({
      action: "launch",
      version: "0.8.0",
      source: "default",
    });
  });

  test("a repository's own pin always wins", () => {
    const machineDefault = fileDefault("0.7.1");
    expect(planLaunch({ ...base, machineDefault, pin: { kind: "pinned", version: "0.9.0" } })).toEqual({
      action: "launch",
      version: "0.9.0",
      source: "pin",
    });
    expect(planLaunch({ ...base, machineDefault, pin: { kind: "pinned", version: "0.10.1" } })).toEqual({
      action: "run-self",
      reason: "same-version",
    });
    // An invalid pin is reported by loading the config (exit 2): the default never stands in for it
    expect(planLaunch({ ...base, machineDefault, pin: { kind: "invalid", message: "x" } })).toEqual({
      action: "run-self",
      reason: "invalid-pin",
    });
  });

  test("a default that names this binary's version runs it", () => {
    expect(planLaunch({ ...base, machineDefault: fileDefault("0.10.1") })).toEqual({ action: "run-self", reason: "same-version" });
  });

  test("an invalid default fails (exit code 2), saying where it came from", () => {
    const fromFile = planLaunch({ ...base, machineDefault: { kind: "invalid", message: "bad value", origin: FILE } });
    expect(fromFile.action === "fail" && fromFile.error).toBe("invalid-machine-default");
    expect(fromFile.action === "fail" && fromFile.message).toStartWith(
      "the machine default in ~/.config/chaperone/config.json is invalid: bad value\n"
    );
    expect(fromFile.action === "fail" && fromFile.message).toContain('"chaperone default --clear"');
    expect(fromFile.action === "fail" && fromFile.message).toEndWith("Nothing ran.");

    const fromEnv = planLaunch({ ...base, machineDefault: { kind: "invalid", message: "bad value", origin: ENV } });
    expect(fromEnv.action === "fail" && fromEnv.message).toStartWith(
      "the machine default from CHAPERONE_DEFAULT_VERSION is invalid: bad value\n"
    );
    expect(fromEnv.action === "fail" && fromEnv.message).toContain("set CHAPERONE_DEFAULT_VERSION to an exact version, or unset it");
  });

  test("CHAPERONE_IGNORE_PIN ignores the machine default, valid or not", () => {
    expect(planLaunch({ ...base, ignorePin: true, machineDefault: fileDefault("0.7.1") })).toEqual({
      action: "run-self",
      reason: "ignored",
    });
    expect(planLaunch({ ...base, ignorePin: true, machineDefault: { kind: "invalid", message: "x", origin: ENV } })).toEqual({
      action: "run-self",
      reason: "ignored",
    });
  });

  test("a process the launcher started never launches again, whatever the default says", () => {
    const ownMarker: LaunchMarker = { version: "0.10.1", mode: "exec", pid: 1 };
    expect(planLaunch({ ...base, ownMarker, machineDefault: fileDefault("0.7.1") })).toEqual({ action: "run-self", reason: "launched" });
    const wrong: LaunchMarker = { version: "0.7.1", mode: "exec", pid: 1 };
    const plan = planLaunch({ ...base, ownMarker: wrong, machineDefault: fileDefault("0.7.1") });
    expect(plan.action === "fail" && plan.message).toContain("launched as Chaperone 0.7.1, but it is 0.10.1");
  });
});

describe("defaultInUse (for the hint and the update notice)", () => {
  const base = { selfVersion: "0.10.1", ignorePin: false, pin: { kind: "none" } as PinState };

  test("is the default when it chose this binary's version", () => {
    expect(defaultInUse({ ...base, machineDefault: envDefault("0.10.1") })).toEqual({ version: "0.10.1", origin: ENV });
  });

  test("is null when a pin decides, the default names another version, it is ignored, or there is none", () => {
    expect(defaultInUse({ ...base, pin: { kind: "pinned", version: "0.10.1" }, machineDefault: fileDefault("0.10.1") })).toBeNull();
    expect(defaultInUse({ ...base, machineDefault: fileDefault("0.7.1") })).toBeNull();
    expect(defaultInUse({ ...base, ignorePin: true, machineDefault: fileDefault("0.10.1") })).toBeNull();
    expect(defaultInUse({ ...base, machineDefault: NO_DEFAULT })).toBeNull();
  });
});

describe("formatVersionLine with a machine default", () => {
  const base = { selfVersion: "0.10.1", configLabel: ".chaperone.json", cached: true, ignorePin: false, pin: { kind: "none" } as PinState };

  test("names the default first, where it comes from, and the launcher", () => {
    expect(formatVersionLine({ ...base, machineDefault: fileDefault("0.7.1") })).toBe(
      "chaperone v0.7.1 (machine default in ~/.config/chaperone/config.json, launched by v0.10.1)"
    );
    expect(formatVersionLine({ ...base, machineDefault: envDefault("0.7.1") })).toBe(
      "chaperone v0.7.1 (machine default from CHAPERONE_DEFAULT_VERSION, launched by v0.10.1)"
    );
    expect(formatVersionLine({ ...base, cached: false, machineDefault: fileDefault("0.7.1") })).toBe(
      "chaperone v0.7.1 (machine default in ~/.config/chaperone/config.json, launched by v0.10.1; downloaded on first use)"
    );
  });

  test("also where there is no config at all", () => {
    expect(formatVersionLine({ ...base, configLabel: null, machineDefault: envDefault("0.7.1") })).toBe(
      "chaperone v0.7.1 (machine default from CHAPERONE_DEFAULT_VERSION, launched by v0.10.1)"
    );
  });

  test("a default of this binary's version, an ignored default and an invalid one", () => {
    expect(formatVersionLine({ ...base, machineDefault: fileDefault("0.10.1") })).toBe(
      "chaperone v0.10.1 (machine default in ~/.config/chaperone/config.json)"
    );
    expect(formatVersionLine({ ...base, ignorePin: true, machineDefault: fileDefault("0.7.1") })).toBe(
      "chaperone v0.10.1 (CHAPERONE_IGNORE_PIN is set: ignoring v0.7.1, the machine default in ~/.config/chaperone/config.json)"
    );
    expect(formatVersionLine({ ...base, machineDefault: { kind: "invalid", message: "bad value", origin: ENV } })).toBe(
      "chaperone v0.10.1 (machine default from CHAPERONE_DEFAULT_VERSION: bad value)"
    );
  });

  test("a pinned repository names its pin, never the default", () => {
    expect(formatVersionLine({ ...base, pin: { kind: "pinned", version: "0.9.0" }, machineDefault: fileDefault("0.7.1") })).toBe(
      "chaperone v0.9.0 (pinned in .chaperone.json, launched by v0.10.1)"
    );
  });
});

describe("formatIgnoreNote", () => {
  const base = { selfVersion: "0.10.1", configLabel: ".chaperone.json" };
  const none: PinState = { kind: "none" };

  test("names what CHAPERONE_IGNORE_PIN set aside: the pin, or the machine default", () => {
    expect(formatIgnoreNote({ ...base, pin: { kind: "pinned", version: "0.9.0" }, machineDefault: NO_DEFAULT })).toBe(
      "CHAPERONE_IGNORE_PIN is set: running 0.10.1, not 0.9.0 (pinned in .chaperone.json)."
    );
    expect(formatIgnoreNote({ ...base, pin: none, machineDefault: fileDefault("0.7.1") })).toBe(
      "CHAPERONE_IGNORE_PIN is set: running 0.10.1, not 0.7.1 (the machine default in ~/.config/chaperone/config.json)."
    );
    expect(formatIgnoreNote({ ...base, pin: none, machineDefault: { kind: "invalid", message: "bad value", origin: ENV } })).toBe(
      "CHAPERONE_IGNORE_PIN is set: running 0.10.1, ignoring the machine default from CHAPERONE_DEFAULT_VERSION, which is invalid: bad value"
    );
  });

  test("says nothing when nothing was set aside", () => {
    expect(formatIgnoreNote({ ...base, pin: none, machineDefault: NO_DEFAULT })).toBeNull();
    expect(formatIgnoreNote({ ...base, pin: none, machineDefault: fileDefault("0.10.1") })).toBeNull();
  });
});

describe("helpers", () => {
  test("isTruthyEnv", () => {
    expect(["1", "true", "yes"].map(isTruthyEnv)).toEqual([true, true, true]);
    expect([undefined, "", "0", "false", "FALSE"].map(isTruthyEnv)).toEqual([false, false, false, false, false]);
  });

  test("compareVersionsDescending sorts newest first", () => {
    expect(["0.9.0", "0.10.0", "0.10.0-rc.1", "0.8.12", "1.0.0"].sort(compareVersionsDescending)).toEqual([
      "1.0.0",
      "0.10.0",
      "0.10.0-rc.1",
      "0.9.0",
      "0.8.12",
    ]);
  });
});
