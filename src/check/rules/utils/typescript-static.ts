/** Static TypeScript reads only: never import or execute the project's modules. */
import { relative, resolve } from "node:path";
import ts from "typescript";

export class StaticReadError extends Error {
  constructor(message: string, readonly file: string, readonly line?: number, readonly column?: number) {
    super(message);
  }
}

export function nodeLocation(node: ts.Node): { file: string; line: number; column: number } {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: position.line + 1, column: position.character + 1 };
}

export function staticError(node: ts.Node, message: string): never {
  const { file, line, column } = nodeLocation(node);
  throw new StaticReadError(message, file, line, column);
}

export function relativeFile(root: string, file: string): string {
  return relative(root, file).split("\\").join("/");
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

export function createStaticProject(root: string, files: readonly string[]) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  let configured: ts.CompilerOptions = {};
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new StaticReadError(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"), configPath);
    configured = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(configPath, "..")).options;
  }
  const program = ts.createProgram(files.map((file) => resolve(root, file)), {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...configured,
    allowJs: true,
    noEmit: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const checked = new Set<ts.SourceFile>();

  const assertParsed = (source: ts.SourceFile): void => {
    if (checked.has(source)) return;
    const diagnostic = program.getSyntacticDiagnostics(source)[0];
    if (diagnostic) {
      const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      throw new StaticReadError(`Cannot parse TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
        source.fileName, position.line + 1, position.character + 1);
    }
    checked.add(source);
  };
  const source = (file: string): ts.SourceFile => {
    const result = program.getSourceFile(resolve(root, file));
    if (!result) throw new StaticReadError("Cannot read TypeScript file", resolve(root, file));
    assertParsed(result);
    return result;
  };
  const unalias = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const exportsOf = (file: ts.SourceFile): ts.Symbol[] => {
    assertParsed(file);
    const symbol = checker.getSymbolAtLocation(file);
    return symbol ? checker.getExportsOfModule(symbol) : [];
  };
  const expressionOf = (symbol: ts.Symbol, at: ts.Node): ts.Expression => {
    const actual = unalias(symbol);
    const declaration = actual.valueDeclaration ?? actual.declarations?.[0];
    if (declaration) {
      assertParsed(declaration.getSourceFile());
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return declaration.initializer;
      if (ts.isExportAssignment(declaration)) return declaration.expression;
      if (ts.isPropertyAssignment(declaration)) return declaration.initializer;
      if (ts.isShorthandPropertyAssignment(declaration)) {
        const value = checker.getShorthandAssignmentValueSymbol(declaration);
        if (value) return expressionOf(value, declaration);
      }
    }
    return staticError(at, `Cannot statically resolve "${symbol.name}" to an initialized value`);
  };
  const exportedExpression = (file: string, exportName?: string): ts.Expression => {
    const module = source(file);
    const exports = exportsOf(module).filter((symbol) => Boolean(unalias(symbol).flags & ts.SymbolFlags.Value));
    const selected = exportName ? exports.find((symbol) => symbol.name === exportName)
      : exports.find((symbol) => symbol.name === "default") ?? (exports.length === 1 ? exports[0] : undefined);
    if (!selected) {
      return staticError(module, exportName ? `Export "${exportName}" was not found`
        : "Expected a default export or a sole named value export; select one with mapExport/schemaExport");
    }
    return expressionOf(selected, module);
  };
  const resolveReference = (expression: ts.Expression): ts.Expression => {
    const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
    return symbol ? expressionOf(symbol, expression) : staticError(expression, `Cannot resolve "${expression.getText()}"`);
  };
  const withExpression = <T>(expression: ts.Expression, seen: Set<ts.Node>, read: (value: ts.Expression, next: Set<ts.Node>) => T): T => {
    const value = unwrapExpression(expression);
    assertParsed(value.getSourceFile());
    if (seen.has(value)) return staticError(value, "Circular reference in static value");
    const next = new Set(seen).add(value);
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
      return withExpression(resolveReference(value), next, read);
    }
    return read(value, next);
  };
  const stringValue = (expression: ts.Expression, seen = new Set<ts.Node>()): string =>
    withExpression(expression, seen, (value) => {
      if (ts.isStringLiteralLike(value)) return value.text;
      return staticError(value, "Expected a statically known string literal");
    });
  const propertyName = (name: ts.PropertyName): string => {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return stringValue(name.expression);
    return staticError(name, "Cannot resolve object property name");
  };
  const objectEntries = (expression: ts.Expression, seen = new Set<ts.Node>()): Map<string, ts.Expression | undefined> => {
    const reference = unwrapExpression(expression);
    if (ts.isIdentifier(reference) || ts.isPropertyAccessExpression(reference)) {
      if (seen.has(reference)) return staticError(reference, "Circular reference in static value");
      const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(reference) ? reference.name : reference);
      const actual = symbol ? unalias(symbol) : undefined;
      const declaration = actual?.valueDeclaration;
      // Installed packages commonly expose a component map in declarations. A
      // finite object type supplies its keys without needing runtime initializers.
      if (declaration && ts.isVariableDeclaration(declaration) && !declaration.initializer && declaration.type) {
        assertParsed(declaration.getSourceFile());
        const type = checker.getTypeAtLocation(declaration.type);
        if (!(type.flags & ts.TypeFlags.Object) || checker.getIndexInfosOfType(type).length > 0) {
          return staticError(reference, "Cannot enumerate keys of a declaration with an open or unknown object type");
        }
        return new Map(checker.getPropertiesOfType(type).map((property) => [property.name, undefined]));
      }
      return objectEntries(resolveReference(reference), new Set(seen).add(reference));
    }
    return withExpression(expression, seen, (value, next) => {
      if (!ts.isObjectLiteralExpression(value)) return staticError(value, "Expected a statically known object literal (dynamic calls are not evaluated)");
      const entries = new Map<string, ts.Expression | undefined>();
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          for (const [key, initializer] of objectEntries(property.expression, next)) entries.set(key, initializer);
        } else {
          const key = propertyName(property.name);
          entries.set(key, ts.isPropertyAssignment(property) ? property.initializer
            : ts.isShorthandPropertyAssignment(property) ? property.name : undefined);
        }
      }
      return entries;
    });
  };

  return { program, checker, source, exportsOf, exportedExpression, objectEntries, stringValue, assertParsed };
}
