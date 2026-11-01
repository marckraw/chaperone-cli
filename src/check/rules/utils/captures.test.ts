import { describe, expect, test } from "bun:test";
import { captureGroupsOf, replaceWithTransforms, splitWords, transformCase } from "./captures";

describe("transformCase", () => {
  test.each(["fan-stack", "fan_stack", "fanStack", "FanStack", "FAN_STACK", "fan stack"])("%s in every case", (value) => {
    expect(transformCase(value, "pascal")).toBe("FanStack");
    expect(transformCase(value, "camel")).toBe("fanStack");
    expect(transformCase(value, "kebab")).toBe("fan-stack");
    expect(transformCase(value, "snake")).toBe("fan_stack");
  });

  test("acronyms and digits stay in their word", () => {
    expect(splitWords("HTMLParser")).toEqual(["html", "parser"]);
    expect(transformCase("hero-2-col", "pascal")).toBe("Hero2Col");
    expect(transformCase("hero2col", "kebab")).toBe("hero2col");
    // The edges the README documents
    expect(transformCase("sb-2col-grid", "pascal")).toBe("Sb2colGrid");
    expect(transformCase("HTMLParser", "pascal")).toBe("HtmlParser");
  });
});

describe("replaceWithTransforms", () => {
  const FROM = /^src\/components\/[^/]+\/([a-z0-9-]+)\.sb\.ts$/;

  test("transforms the groups it names, and only those", () => {
    const from = /^src\/components\/[^/]+\/((?<base>[a-z0-9-]+))\.sb\.ts$/;
    const to = "src/components/$1/$<base>.sb.ts";
    expect(replaceWithTransforms("src/components/Old/fan-stack.sb.ts", from, to, { 1: "pascal" })).toBe(
      "src/components/FanStack/fan-stack.sb.ts"
    );
    expect(replaceWithTransforms("src/components/Old/fan-stack.sb.ts", from, to, { base: "snake" })).toBe(
      "src/components/fan-stack/fan_stack.sb.ts"
    );
    // A single transform applies to every group
    expect(replaceWithTransforms("src/components/Old/fan-stack.sb.ts", FROM, "$1/$1", "camel")).toBe("fanStack/fanStack");
  });

  test.each([
    ["src/components/X/fan-stack.sb.ts", FROM, "$$1 $& [$`] [$'] $0 $2 $10 $<name>"],
    ["a-b.ts", /(a)-(b)/, "$12|$2$1|$<x>"],
    ["a-b.ts", /(?<first>a)-(?<second>b)/, "$<second>$<first>$<missing>|$1"],
    ["no match", FROM, "$1"],
  ] as const)("without a transform, replaces exactly like String.prototype.replace: %s", (value, regex, to) => {
    expect(replaceWithTransforms(value, regex, to, {})).toBe(value.replace(regex, to));
  });
});

test("captureGroupsOf counts groups and names", () => {
  expect(captureGroupsOf(/(a)(?<b>b)(?:c)/)).toEqual({ count: 2, names: ["b"] });
  expect(captureGroupsOf(/abc/)).toEqual({ count: 0, names: [] });
});
