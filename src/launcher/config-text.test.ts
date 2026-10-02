import { describe, expect, test } from "bun:test";
import { setDefaultInConfigText, setPinInConfigText } from "./config-text";

describe("setDefaultInConfigText (the machine config file)", () => {
  test("creates the file's content when there is none", () => {
    expect(setDefaultInConfigText(null, "0.7.1")).toEqual({
      text: '{\n  "defaultVersion": "0.7.1"\n}\n',
      previous: undefined,
      replacedKey: null,
      removed: [],
      unchanged: false,
    });
  });

  test("keeps every other field, in the file's own indentation", () => {
    const text = '{\n    "someOtherSetting": { "keep": [1, 2] },\n    "defaultVersion": "0.6.0"\n}\n';
    const edit = setDefaultInConfigText(text, "0.7.1");
    expect(edit.text).toBe('{\n    "someOtherSetting": {\n        "keep": [\n            1,\n            2\n        ]\n    },\n    "defaultVersion": "0.7.1"\n}\n');
    expect(edit.previous).toBe("0.6.0");
    expect(JSON.parse(setDefaultInConfigText('{"a":1}', "0.7.1").text)).toEqual({ defaultVersion: "0.7.1", a: 1 });
  });

  test("replaces a misspelled field when the real one is missing", () => {
    const edit = setDefaultInConfigText('{ "a": 1, "default_version": "0.6.0" }', "0.7.1");
    expect(JSON.parse(edit.text)).toEqual({ a: 1, defaultVersion: "0.7.1" });
    expect(Object.keys(JSON.parse(edit.text))).toEqual(["a", "defaultVersion"]);
    expect(edit.replacedKey).toBe("default_version");
  });

  test("leaves the file alone when it already says this", () => {
    const text = '{"defaultVersion":"0.7.1"}';
    expect(setDefaultInConfigText(text, "0.7.1")).toMatchObject({ text, unchanged: true });
  });

  test("clearing removes the field and its misspellings, and keeps the rest", () => {
    const edit = setDefaultInConfigText('{\n  "defaultVersion": "0.7.1",\n  "default_version": "0.6.0",\n  "a": 1\n}\n', null);
    expect(edit.text).toBe('{\n  "a": 1\n}\n');
    expect(edit.removed).toEqual(["defaultVersion", "default_version"]);
    expect(edit.previous).toBe("0.7.1");

    const nothing = setDefaultInConfigText('{ "a": 1 }', null);
    expect(nothing).toMatchObject({ text: '{ "a": 1 }', removed: [], unchanged: true });
  });

  test("keeps a __proto__ key as data", () => {
    const edit = setDefaultInConfigText('{ "__proto__": { "x": 1 } }', "0.7.1");
    expect(edit.text).toContain('"__proto__"');
  });

  test("throws on invalid JSON or a file that is not an object", () => {
    expect(() => setDefaultInConfigText("{ nope", "0.7.1")).toThrow(SyntaxError);
    expect(() => setDefaultInConfigText("[]", null)).toThrow("not a JSON object");
  });
});

describe("setPinInConfigText", () => {
  test("adds the pin as the first key, in the file's own indentation", () => {
    const text = '{\n    "version": "1.0.0",\n    "rules": { "custom": [] }\n}\n';
    expect(setPinInConfigText(text, "0.10.0").text).toBe(
      '{\n    "chaperoneVersion": "0.10.0",\n    "version": "1.0.0",\n    "rules": { "custom": [] }\n}\n'
    );
  });

  test("goes after $schema", () => {
    const text = '{\n  "$schema": "./schema.json",\n  "version": "1.0.0"\n}\n';
    expect(setPinInConfigText(text, "0.10.0").text).toBe(
      '{\n  "$schema": "./schema.json",\n  "chaperoneVersion": "0.10.0",\n  "version": "1.0.0"\n}\n'
    );
    expect(setPinInConfigText('{ "$schema": "x" }', "0.10.0").text).toBe('{ "$schema": "x", "chaperoneVersion": "0.10.0" }');
  });

  test("replaces an existing pin in place, keeping everything else byte for byte", () => {
    const text = '{\n  "version": "1.0.0",\n  "chaperoneVersion":"0.8.0" ,\n  "exclude": ["a"]\n}';
    const edit = setPinInConfigText(text, "0.10.0");
    expect(edit.text).toBe('{\n  "version": "1.0.0",\n  "chaperoneVersion": "0.10.0" ,\n  "exclude": ["a"]\n}');
    expect(edit.previous).toBe("0.8.0");
    expect(edit.replacedKey).toBeNull();
  });

  test("replaces a pin of the wrong type", () => {
    expect(setPinInConfigText('{"chaperoneVersion": 0.9, "version": "1.0.0"}', "0.9.0").text).toBe(
      '{"chaperoneVersion": "0.9.0", "version": "1.0.0"}'
    );
  });

  test("fixes a misspelled pin key", () => {
    const edit = setPinInConfigText('{\n  "chaperone_version": "0.8.0",\n  "version": "1.0.0"\n}\n', "0.10.0");
    expect(edit.text).toBe('{\n  "chaperoneVersion": "0.10.0",\n  "version": "1.0.0"\n}\n');
    expect(edit.replacedKey).toBe("chaperone_version");
  });

  test("leaves nested keys and strings that look like the pin alone", () => {
    const text = JSON.stringify(
      { version: "1.0.0", project: { chaperoneVersion: "x" }, rules: { custom: [{ message: '"chaperoneVersion": "1.0.0"' }] } },
      null,
      2
    );
    const edited = JSON.parse(setPinInConfigText(text, "0.10.0").text);
    expect(edited.chaperoneVersion).toBe("0.10.0");
    expect(edited.project).toEqual({ chaperoneVersion: "x" });
    expect(edited.rules.custom[0].message).toBe('"chaperoneVersion": "1.0.0"');
  });

  test("handles an empty object and minified JSON", () => {
    expect(JSON.parse(setPinInConfigText("{}", "0.10.0").text)).toEqual({ chaperoneVersion: "0.10.0" });
    expect(setPinInConfigText('{"version":"1.0.0"}', "0.10.0").text).toBe('{"chaperoneVersion": "0.10.0","version":"1.0.0"}');
  });

  test("returns the same text when the pin is already there", () => {
    const text = '{\n  "chaperoneVersion": "0.10.0"\n}\n';
    expect(setPinInConfigText(text, "0.10.0").text).toBe(text);
  });

  test("throws on invalid JSON or a config that is not an object", () => {
    expect(() => setPinInConfigText("{ nope", "0.10.0")).toThrow();
    expect(() => setPinInConfigText("[]", "0.10.0")).toThrow("not a JSON object");
  });
});
