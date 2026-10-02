import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cachedBinaryPath, findChecksum, releaseAsset, releaseFileUrl, resolveCacheRoot } from "./paths";

describe("resolveCacheRoot", () => {
  const home = "/home/ada";
  const cwd = "/work/project";

  test("defaults to ~/.cache/chaperone on Linux and macOS", () => {
    expect(resolveCacheRoot({ env: {}, platform: "linux", home, cwd })).toBe("/home/ada/.cache/chaperone");
    expect(resolveCacheRoot({ env: {}, platform: "darwin", home: "/Users/ada", cwd })).toBe("/Users/ada/.cache/chaperone");
  });

  test("follows an absolute XDG_CACHE_HOME and ignores a relative one", () => {
    expect(resolveCacheRoot({ env: { XDG_CACHE_HOME: "/var/cache/ada" }, platform: "linux", home, cwd })).toBe(
      "/var/cache/ada/chaperone"
    );
    expect(resolveCacheRoot({ env: { XDG_CACHE_HOME: "relative" }, platform: "linux", home, cwd })).toBe(
      "/home/ada/.cache/chaperone"
    );
  });

  test("CHAPERONE_CACHE_DIR wins, and a relative one resolves against the working directory", () => {
    const env = { CHAPERONE_CACHE_DIR: "/tmp/pins", XDG_CACHE_HOME: "/var/cache/ada" };
    expect(resolveCacheRoot({ env, platform: "linux", home, cwd })).toBe("/tmp/pins");
    expect(resolveCacheRoot({ env: { CHAPERONE_CACHE_DIR: "pins" }, platform: "linux", home, cwd })).toBe("/work/project/pins");
  });

  test("uses %LOCALAPPDATA% on Windows", () => {
    expect(
      resolveCacheRoot({ env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, platform: "win32", home: "C:\\Users\\ada", cwd: "C:\\" })
    ).toBe("C:\\Users\\ada\\AppData\\Local\\chaperone\\cache");
    expect(resolveCacheRoot({ env: {}, platform: "win32", home: "C:\\Users\\ada", cwd: "C:\\" })).toBe(
      "C:\\Users\\ada\\AppData\\Local\\chaperone\\cache"
    );
  });
});

describe("cachedBinaryPath", () => {
  test("keeps one directory per version", () => {
    expect(cachedBinaryPath("/c", "0.9.0", "chaperone-linux-x64", "linux")).toBe("/c/0.9.0/chaperone-linux-x64");
    expect(cachedBinaryPath("C:\\c", "0.9.0", "chaperone-windows-x64.exe", "win32")).toBe(
      "C:\\c\\0.9.0\\chaperone-windows-x64.exe"
    );
  });
});

describe("releaseAsset", () => {
  test("names the asset each platform downloads", () => {
    expect(releaseAsset("darwin", "arm64")).toBe("chaperone-darwin-arm64");
    expect(releaseAsset("darwin", "x64")).toBe("chaperone-darwin-x64");
    expect(releaseAsset("linux", "x64")).toBe("chaperone-linux-x64");
    expect(releaseAsset("linux", "arm64")).toBe("chaperone-linux-arm64");
    expect(releaseAsset("win32", "x64")).toBe("chaperone-windows-x64.exe");
  });

  test("returns null where no binary is published", () => {
    expect(releaseAsset("win32", "arm64")).toBeNull();
    expect(releaseAsset("freebsd", "x64")).toBeNull();
    expect(releaseAsset("linux", "ia32")).toBeNull();
  });

  test("matches every target build.ts publishes", () => {
    const build = readFileSync(join(import.meta.dir, "..", "..", "build.ts"), "utf-8");
    const targets = [...build.matchAll(/name: "([a-z]+)-([a-z0-9]+)", target: "[^"]+", extension: "([^"]*)"/g)];
    expect(targets.length).toBe(5);
    for (const [, os, cpu, extension] of targets) {
      const platform = os === "windows" ? "win32" : os!;
      expect(releaseAsset(platform, cpu!)).toBe(`chaperone-${os}-${cpu}${extension}`);
    }
  });
});

describe("releaseFileUrl", () => {
  test("uses the v-prefixed tag", () => {
    expect(releaseFileUrl("https://github.com/marckraw/chaperone-cli/releases/download", "0.9.0", "SHA256SUMS.txt")).toBe(
      "https://github.com/marckraw/chaperone-cli/releases/download/v0.9.0/SHA256SUMS.txt"
    );
    expect(releaseFileUrl("http://mirror.local/chaperone/", "0.9.0", "chaperone-linux-x64")).toBe(
      "http://mirror.local/chaperone/v0.9.0/chaperone-linux-x64"
    );
  });
});

describe("findChecksum", () => {
  const a = "a".repeat(64);
  const b = "B".repeat(64);
  const sums = `${a}  chaperone-darwin-arm64\n${b} *chaperone-linux-x64\r\n${"c".repeat(64)}  chaperone-linux-x64-baseline\n`;

  test("finds the entry for exactly that asset", () => {
    expect(findChecksum(sums, "chaperone-darwin-arm64")).toBe(a);
    expect(findChecksum(sums, "chaperone-linux-x64")).toBe("b".repeat(64));
  });

  test("returns null when the asset has no entry", () => {
    expect(findChecksum(sums, "chaperone-windows-x64.exe")).toBeNull();
    expect(findChecksum("not a checksum file", "chaperone-darwin-arm64")).toBeNull();
  });
});
