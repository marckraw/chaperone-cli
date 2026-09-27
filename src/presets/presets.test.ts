import { afterEach, describe, expect, test } from "bun:test";
import { check } from "../check";
import { validateConfigShape, validateRule } from "../check/config-schema";
import { cleanupProjects, makeProject } from "../testing/fixtures";
import { getBuiltInPreset, listBuiltInPresets } from "./index";

afterEach(cleanupProjects);

/** Run `chaperone check` with a config that extends one preset; returns "rule-id file" pairs. */
async function violations(preset: string, files: Record<string, string>): Promise<string[]> {
  const cwd = makeProject({
    ".chaperone.json": JSON.stringify({ version: "1.0.0", extends: [`chaperone/${preset}`] }),
    ...files,
  });
  const summary = await check({ cwd, format: "json" });
  return summary.results
    .filter((result) => result.source === "custom")
    .map((result) => `${result.rule} ${result.file}`)
    .sort();
}

describe("built-in presets", () => {
  test.each(listBuiltInPresets().map((name) => [name]))("%s passes validation", (name) => {
    const preset = getBuiltInPreset(name)!;
    expect(validateConfigShape(preset, `chaperone/${name}`)).toEqual([]);
    (preset.rules?.custom ?? []).forEach((rule, index) => {
      expect(validateRule(rule, `chaperone/${name}`, ["rules", "custom", index]).diagnostics).toEqual([]);
    });
  });

  test("pure-functions", async () => {
    expect(
      await violations("pure-functions", {
        "src/ok.pure.ts": "export const add = (a: number, b: number) => a + b;\n",
        "src/ok.pure.test.ts": "",
        "src/untested.pure.ts": 'import { get } from "./user.api";\nconsole.log(get);\n',
        "src/orphan.pure.test.ts": "",
      })
    ).toEqual([
      "file-contract/preset/pure-no-side-effects src/untested.pure.ts",
      "file-pairing/preset/pure-files-need-tests src/untested.pure.ts",
      "file-pairing/preset/pure-tests-need-source src/orphan.pure.test.ts",
      "regex/preset/pure-no-api-imports src/untested.pure.ts",
    ]);
  });

  test("presentational-components", async () => {
    expect(
      await violations("presentational-components", {
        "src/Card.presentational.tsx": "export const Card = () => <div />;\n",
        "src/List.presentational.tsx": "useEffect(() => {});\nconst [a] = useState(0);\n",
      })
    ).toEqual([
      "file-contract/preset/presentational-no-side-effects src/List.presentational.tsx",
      "file-contract/preset/presentational-no-stateful-hooks src/List.presentational.tsx",
    ]);
  });

  test("single-react-component-per-file skips test and story files", async () => {
    const two = "export function A() { return <a />; }\nexport function B() { return <b />; }\n";
    expect(
      await violations("single-react-component-per-file", {
        "src/Card.tsx": two,
        "src/Card.test.tsx": two,
        "src/Card.spec.jsx": two,
        "src/Card.stories.tsx": two,
        "src/Card.story.tsx": two,
        "src/Single.tsx": "export function Single() { return <a />; }\n",
      })
    ).toEqual(["react-component-count/preset/single-react-component-per-file src/Card.tsx"]);
  });

  test("package-essentials", async () => {
    expect(
      await violations("package-essentials", {
        "package.json": JSON.stringify({ scripts: { dev: "x", build: "x", test: "x" } }),
      })
    ).toEqual(["package-fields/preset/required-scripts package.json"]);
  });

  test("layered-architecture", async () => {
    expect(
      await violations("layered-architecture", {
        "src/shared/lib/format.ts": 'import { login } from "../../features/auth";\n',
        "src/features/auth/index.ts": 'export { login } from "./model/login";\n',
        "src/features/auth/model/login.ts": "export const login = 1;\n",
        "src/app/main.ts": 'import { login } from "../features/auth/model/login";\n',
        "src/components/Old.tsx": "",
      })
    ).toEqual([
      "import-boundary/preset/layer-boundaries src/shared/lib/format.ts",
      "public-api/preset/feature-public-api src/app/main.ts",
      "retired-path/preset/no-legacy-dirs src/components/Old.tsx",
    ]);
  });

  test("react-layered", async () => {
    expect(
      await violations("react-layered", {
        "src/entities/user/model.ts": 'import { x } from "../../widgets/header";\n',
        "src/widgets/header/index.ts": "export const x = 1;\n",
        "src/shared/ui/Card.presentational.tsx": "useState(0);\n",
        "src/shared/lib/date.pure.ts": "setTimeout(() => {}, 1);\n",
      })
    ).toEqual([
      "file-contract/preset/presentational-purity src/shared/ui/Card.presentational.tsx",
      "file-contract/preset/pure-file-purity src/shared/lib/date.pure.ts",
      "file-pairing/preset/pure-files-need-tests src/shared/lib/date.pure.ts",
      "import-boundary/preset/fsd-layers src/entities/user/model.ts",
    ]);
  });

  test("react-native-expo", async () => {
    expect(
      await violations("react-native-expo", {
        "src/screen.ts": "export const S = () => <View />;\n",
        "src/types.d.ts": "declare const X: <T>() => <Foo />;\n",
        "src/log.tsx": 'console.log("x");\nexport const A = () => <View style={{ flex: 1 }} />;\n',
        "src/log.test.tsx": 'console.log("x");\n',
      })
    ).toEqual([
      "regex/preset/no-console-log src/log.tsx",
      "regex/preset/no-inline-style-objects src/log.tsx",
      "regex/preset/require-tsx-for-jsx src/screen.ts",
    ]);
  });

  test("react-server-components", async () => {
    expect(
      await violations("react-server-components", {
        "src/button.tsx": '"use client";\nexport function Button() {}\nexport const buttonVariants = {};\n',
        "src/server.tsx": "export const helpers = {};\n",
      })
    ).toEqual(["directive-export-pattern/preset/use-client-exports src/button.tsx"]);
  });
});
