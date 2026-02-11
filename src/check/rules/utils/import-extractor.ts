export interface ImportEntry {
  source: string; // Import specifier (e.g., "@tauri-apps/api", "./utils")
  line: number; // Line number
  isTypeImport: boolean; // `import type` statement
  isDynamic: boolean; // import() expression
  isRequire: boolean; // require() call
}

export interface ExtractOptions {
  includeTypeImports?: boolean; // default: true
  includeDynamicImports?: boolean; // default: true
  includeRequire?: boolean; // default: true
}

/**
 * Strip single-line comments from content before scanning for imports.
 * Block comments and string literals are intentionally not handled — accepted tradeoff.
 */
function stripSingleLineComments(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      // Naive: strip from // to end of line
      return line.slice(0, idx);
    })
    .join("\n");
}

export function extractImports(
  content: string,
  options?: ExtractOptions
): ImportEntry[] {
  const includeTypeImports = options?.includeTypeImports ?? true;
  const includeDynamicImports = options?.includeDynamicImports ?? true;
  const includeRequire = options?.includeRequire ?? true;

  const entries: ImportEntry[] = [];
  const cleaned = stripSingleLineComments(content);
  const lines = content.split("\n");

  // Helper to find line number for a character offset in cleaned content
  function lineNumberAt(offset: number): number {
    const before = cleaned.slice(0, offset);
    return before.split("\n").length;
  }

  // ES6 static imports (including multiline destructuring)
  // Matches: import ... from 'source' and import 'source'
  const es6Regex =
    /^\s*import\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;

  while ((match = es6Regex.exec(cleaned)) !== null) {
    const isType = !!match[1];
    if (isType && !includeTypeImports) continue;
    entries.push({
      source: match[2],
      line: lineNumberAt(match.index),
      isTypeImport: isType,
      isDynamic: false,
      isRequire: false,
    });
  }

  // Re-exports: export * from 'source' and export { ... } from 'source'
  const reExportRegex =
    /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/gm;
  while ((match = reExportRegex.exec(cleaned)) !== null) {
    entries.push({
      source: match[1],
      line: lineNumberAt(match.index),
      isTypeImport: false,
      isDynamic: false,
      isRequire: false,
    });
  }

  // Dynamic imports: import('source')
  if (includeDynamicImports) {
    const dynamicRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicRegex.exec(cleaned)) !== null) {
      entries.push({
        source: match[1],
        line: lineNumberAt(match.index),
        isTypeImport: false,
        isDynamic: true,
        isRequire: false,
      });
    }
  }

  // Require calls: require('source')
  if (includeRequire) {
    const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(cleaned)) !== null) {
      entries.push({
        source: match[1],
        line: lineNumberAt(match.index),
        isTypeImport: false,
        isDynamic: false,
        isRequire: true,
      });
    }
  }

  return entries;
}
