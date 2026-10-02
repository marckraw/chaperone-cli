import { describe, expect, test } from "bun:test";
import { setPinInConfigText } from "./config-text";

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
