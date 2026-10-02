import { describe, expect, test } from "bun:test";
import { formatMarker, isOwnMarker, parseMarker, type LaunchMarker } from "./marker";
import { compareVersionsDescending, formatVersionLine, isTruthyEnv, planLaunch } from "./plan";
import type { PinState } from "./pin";

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
  const base = { selfVersion: "0.10.0", ownMarker: null, ignorePin: false };

  test("launches a pinned version that differs from this binary's", () => {
    expect(planLaunch({ ...base, pin: pinned("0.9.0") })).toEqual({ action: "launch", version: "0.9.0" });
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
  const base = { selfVersion: "0.10.0", configLabel: ".chaperone.json", cached: true, ignorePin: false };

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
