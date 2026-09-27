import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runReactComponentCountRule } from "./react-component-count";

const tempDirs: string[] = [];

function makeProject(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "chaperone-react-component-count-"));
  tempDirs.push(cwd);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(cwd, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }

  return cwd;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("runReactComponentCountRule", () => {
  test("passes when a file contains only one React component", async () => {
    const cwd = makeProject({
      "src/button.tsx": `export function Button() {\n  return <button />;\n}\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
        maxComponents: 1,
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(0);
  });

  test("flags files with multiple top-level React components", async () => {
    const cwd = makeProject({
      "src/button.tsx": `export function Button() {\n  return <button />;\n}\n\nfunction ButtonIcon() {\n  return <svg />;\n}\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
        maxComponents: 1,
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.line).toBe(5);
    expect(result.results[0]?.context?.actualValue).toContain("Button");
    expect(result.results[0]?.context?.actualValue).toContain("ButtonIcon");
  });

  test("ignores hooks and PascalCase values that are not React components", async () => {
    const cwd = makeProject({
      "src/button.tsx": `const APIUrl = "https://example.com";\n\nexport function useButtonState() {\n  return { APIUrl };\n}\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(0);
  });

  test("counts memo and forwardRef component declarations", async () => {
    const cwd = makeProject({
      "src/button.tsx": `import { forwardRef, memo } from "react";\n\nconst Button = memo(function Button() {\n  return <button />;\n});\n\nconst ButtonIcon = forwardRef(function ButtonIcon(_props, ref) {\n  return <svg ref={ref} />;\n});\n`,
    });

    const result = await runReactComponentCountRule(
      {
        type: "react-component-count",
        id: "single-react-component",
        severity: "error",
        files: "src/**/*.{tsx,jsx}",
        maxComponents: 1,
      },
      {
        cwd,
        include: ["src/**/*"],
        exclude: [],
      }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.context?.actualValue).toContain("Button");
    expect(result.results[0]?.context?.actualValue).toContain("ButtonIcon");
  });
});

describe("runReactComponentCountRule: component detection", () => {
  const RULE = {
    type: "react-component-count" as const,
    id: "single-react-component",
    severity: "error" as const,
    files: "src/**/*.{tsx,jsx}",
    maxComponents: 1,
  };

  async function componentsIn(source: string): Promise<string[]> {
    const cwd = makeProject({ "src/file.tsx": source });
    const result = await runReactComponentCountRule({ ...RULE, maxComponents: 99 }, {
      cwd,
      include: [],
      exclude: [],
    });
    expect(result.results).toEqual([]);
    const strict = await runReactComponentCountRule({ ...RULE, maxComponents: 1 }, { cwd, include: [], exclude: [] });
    return (strict.results[0]?.context?.detectedPatterns as string[] | undefined) ?? [];
  }

  test("destructured props are not mistaken for the component body", async () => {
    const cwd = makeProject({
      "src/card.tsx": `export function Card({ title }: { title: string }) {\n  return <div>{title}</div>;\n}\n\nfunction CardHeader({ title }) {\n  return <h2>{title}</h2>;\n}\n`,
    });

    const result = await runReactComponentCountRule(RULE, { cwd, include: [], exclude: [] });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.line).toBe(5);
    expect(result.results[0]?.context?.actualValue).toBe("2: Card, CardHeader");
  });

  test("handles return type annotations, default exports and JSX text with apostrophes", async () => {
    expect(
      await componentsIn(
        `export default function ({ a }: Props): JSX.Element {\n  return <p>Don't {a}</p>;\n}\nfunction Second(): { node: unknown } | null {\n  return null;\n}\nfunction Third(props: Props): React.ReactNode {\n  return <span>it's "fine"</span>;\n}\n`
      )
    ).toEqual(["default export", "Third"]);
  });

  test("counts class components, arrows and memo/forwardRef wrappers, but not nested helpers", async () => {
    expect(
      await componentsIn(
        `class Legacy extends React.Component {\n  render() { return <div />; }\n}\n` +
          `export const Arrow = ({ x }: Props) => <span>{x}</span>;\n` +
          `const Generic = <T,>({ items }: { items: T[] }) => <ul>{items.length}</ul>;\n` +
          `const Wrapped = memo(function Wrapped() { return <b />; });\n` +
          `export function Parent() {\n  function Nested() { return <i />; }\n  const Inner = () => <em />;\n  return <Nested />;\n}\n`
      )
    ).toEqual(["Legacy", "Arrow", "Generic", "Wrapped", "Parent"]);
  });

  test("ignores constants and functions that do not render", async () => {
    expect(
      await componentsIn(
        `const Title = "x"\nconst Config = { a: 1 }\nexport function Compute(a: number) {\n  return a < 2 ? a : 2;\n}\nexport function Only() {\n  return <div />;\n}\n`
      )
    ).toEqual([]);
  });
});
