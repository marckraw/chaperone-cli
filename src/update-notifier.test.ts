import { describe, expect, test } from "bun:test";
import {
  compareSemver,
  evaluateCache,
  isCacheStale,
  formatUpdateNotice,
  type UpdateCache,
} from "./update-notifier";

describe("compareSemver", () => {
  test("equal versions return 0", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  test("a greater than b returns positive", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.1", "1.0.0")).toBeGreaterThan(0);
  });

  test("a less than b returns negative", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  test("strips v prefix", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3", "v1.2.3")).toBe(0);
    expect(compareSemver("v2.0.0", "v1.0.0")).toBeGreaterThan(0);
  });

  test("handles missing patch version", () => {
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
    expect(compareSemver("1", "1.0.0")).toBe(0);
  });
});

describe("evaluateCache", () => {
  test("returns null for null cache", () => {
    expect(evaluateCache(null, "1.0.0")).toBeNull();
  });

  test("returns null when versions are equal", () => {
    const cache: UpdateCache = {
      lastChecked: Date.now(),
      latestVersion: "1.0.0",
      currentVersion: "1.0.0",
    };
    expect(evaluateCache(cache, "1.0.0")).toBeNull();
  });

  test("returns update info when newer version available", () => {
    const cache: UpdateCache = {
      lastChecked: Date.now(),
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
    };
    expect(evaluateCache(cache, "1.0.0")).toEqual({
      current: "1.0.0",
      latest: "2.0.0",
    });
  });

  test("returns null when current is newer than latest", () => {
    const cache: UpdateCache = {
      lastChecked: Date.now(),
      latestVersion: "1.0.0",
      currentVersion: "2.0.0",
    };
    expect(evaluateCache(cache, "2.0.0")).toBeNull();
  });
});

describe("isCacheStale", () => {
  test("returns true for null cache", () => {
    expect(isCacheStale(null)).toBe(true);
  });

  test("returns false for fresh cache", () => {
    const cache: UpdateCache = {
      lastChecked: Date.now(),
      latestVersion: "1.0.0",
      currentVersion: "1.0.0",
    };
    expect(isCacheStale(cache)).toBe(false);
  });

  test("returns true for stale cache", () => {
    const cache: UpdateCache = {
      lastChecked: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      latestVersion: "1.0.0",
      currentVersion: "1.0.0",
    };
    expect(isCacheStale(cache)).toBe(true);
  });

  test("respects custom TTL", () => {
    const cache: UpdateCache = {
      lastChecked: Date.now() - 5000, // 5 seconds ago
      latestVersion: "1.0.0",
      currentVersion: "1.0.0",
    };
    expect(isCacheStale(cache, 3000)).toBe(true);
    expect(isCacheStale(cache, 10000)).toBe(false);
  });
});

describe("formatUpdateNotice", () => {
  test("contains both versions", () => {
    const notice = formatUpdateNotice("1.0.0", "2.0.0");
    expect(notice).toContain("1.0.0");
    expect(notice).toContain("2.0.0");
  });

  test("contains download URL", () => {
    const notice = formatUpdateNotice("1.0.0", "2.0.0");
    expect(notice).toContain(
      "https://github.com/marckraw/chaperone-cli/releases/latest",
    );
  });
});
