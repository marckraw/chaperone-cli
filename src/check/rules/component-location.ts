import { compileGlob, hasGlobSyntax, normalizeGlob } from "../../utils/glob";
import type { CheckResult, ComponentLocationRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";
import { getRuleContext } from "./utils/rule-context";

/**
 * Patterns that indicate a component has state/side effects (NOT presentational)
 */
const STATEFUL_PATTERNS = [
  // React hooks that indicate state
  /\buseState\s*\(/,
  /\buseReducer\s*\(/,
  /\buseContext\s*\(/,
  // Side effect hooks
  /\buseEffect\s*\(/,
  /\buseLayoutEffect\s*\(/,
  /\buseMemo\s*\(/,
  /\buseCallback\s*\(/,
  // Data fetching
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\buseQuery\s*\(/,
  /\buseMutation\s*\(/,
  /\buseSWR\s*\(/,
  // Redux/state management
  /\buseSelector\s*\(/,
  /\buseDispatch\s*\(/,
  /\buseStore\s*\(/,
  // Router hooks (often indicate container behavior)
  /\buseNavigate\s*\(/,
  /\buseParams\s*\(/,
  /\buseLocation\s*\(/,
];

/**
 * Patterns that indicate a component is presentational (pure)
 */
const PRESENTATIONAL_INDICATORS = [
  // Props-only patterns
  /^(?:export\s+)?(?:default\s+)?function\s+\w+\s*\(\s*(?:\{\s*[\w,\s]+\s*\}|props)\s*(?::\s*\w+)?\s*\)/m,
  /^(?:export\s+)?const\s+\w+\s*(?::\s*\w+)?\s*=\s*\(\s*(?:\{\s*[\w,\s]+\s*\}|props)\s*(?::\s*\w+)?\s*\)\s*=>/m,
];

/**
 * Result of component analysis
 */
interface ComponentAnalysis {
  isComponent: boolean;
  isPresentational: boolean;
  isStateful: boolean;
  detectedPatterns: string[];
}

/**
 * Analyze a file to determine component type
 */
function analyzeComponent(content: string): ComponentAnalysis {
  const hasJSX = /<\w+[\s>]/.test(content) || /return\s*\(?\s*</.test(content);

  if (!hasJSX) {
    return { isComponent: false, isPresentational: false, isStateful: false, detectedPatterns: [] };
  }

  const detectedPatterns: string[] = [];

  // Check for stateful patterns
  const patternNames = [
    "useState", "useReducer", "useContext",
    "useEffect", "useLayoutEffect", "useMemo", "useCallback",
    "fetch", "axios", "useQuery", "useMutation", "useSWR",
    "useSelector", "useDispatch", "useStore",
    "useNavigate", "useParams", "useLocation",
  ];

  STATEFUL_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(content)) {
      detectedPatterns.push(patternNames[index] ?? `pattern-${index}`);
    }
  });

  const isStateful = detectedPatterns.length > 0;

  return {
    isComponent: true,
    isPresentational: !isStateful,
    isStateful,
    detectedPatterns,
  };
}

/**
 * Check if a file contains a presentational (pure) component
 */
function isPresentationalComponent(content: string): boolean {
  const analysis = analyzeComponent(content);
  return analysis.isComponent && analysis.isPresentational;
}

/**
 * Check if a file contains a stateful/container component
 */
function isStatefulComponent(content: string): boolean {
  const analysis = analyzeComponent(content);
  return analysis.isComponent && analysis.isStateful;
}

/**
 * Run component-location rule
 */
export async function runComponentLocationRule(
  rule: ComponentLocationRule,
  options: RuleRunnerOptions
): Promise<RuleResult> {
  const { index } = getRuleContext(options);
  const results: CheckResult[] = [];

  // Find all component files
  const files = index.glob(rule.files, rule.exclude ?? []);

  for (const file of files) {
    const content = index.read(file);
    if (content === null) {
      continue;
    }

    // Analyze the component
    const analysis = analyzeComponent(content);

    if (!analysis.isComponent) {
      continue;
    }

    // Determine if this is the target component type
    let isTargetComponent = false;
    if (rule.componentType === "presentational") {
      isTargetComponent = analysis.isPresentational;
    } else if (rule.componentType === "stateful") {
      isTargetComponent = analysis.isStateful;
    }

    if (!isTargetComponent) {
      continue;
    }

    // Check if file is in the required location
    const isInRequiredLocation = matchesLocationPattern(file, rule.requiredLocation);

    if (rule.mustBeIn && !isInRequiredLocation) {
      // Component MUST be in the required location but isn't
      results.push({
        file,
        rule: `component-location/${rule.id}`,
        message:
          rule.message ||
          `${rule.componentType} component should be in "${rule.requiredLocation}"`,
        severity: rule.severity,
        source: "custom",
        suggestion: `Move this ${rule.componentType} component to ${rule.requiredLocation}`,
        context: {
          componentType: rule.componentType,
          detectedPatterns: analysis.detectedPatterns.length > 0
            ? analysis.detectedPatterns
            : ["none (pure component)"],
          expectedValue: `Should be in: ${rule.requiredLocation}`,
          actualValue: `Currently at: ${file}`,
        },
      });
    } else if (!rule.mustBeIn && isInRequiredLocation) {
      // Component must NOT be in this location but is
      results.push({
        file,
        rule: `component-location/${rule.id}`,
        message:
          rule.message ||
          `${rule.componentType} component should not be in "${rule.requiredLocation}"`,
        severity: rule.severity,
        source: "custom",
        suggestion: `Move this ${rule.componentType} component out of ${rule.requiredLocation}`,
        context: {
          componentType: rule.componentType,
          detectedPatterns: analysis.detectedPatterns.length > 0
            ? analysis.detectedPatterns
            : ["none (pure component)"],
          expectedValue: `Should NOT be in: ${rule.requiredLocation}`,
          actualValue: `Currently at: ${file}`,
        },
      });
    }
  }

  return { ruleId: rule.id, results, filesChecked: files.length };
}

/**
 * Check if a file lives in a location:
 * - "src/components/ui/" or "src/components/ui": the file is inside that directory;
 * - a glob ("src/components/ui/**", "src/features/*\/ui"): the glob matches the file
 *   or one of its parent directories.
 */
export function matchesLocationPattern(filePath: string, locationPattern: string): boolean {
  const location = normalizeGlob(locationPattern).replace(/\/+$/, "");
  if (location === "") {
    return true;
  }

  if (!hasGlobSyntax(location)) {
    return filePath === location || filePath.startsWith(`${location}/`);
  }

  const matcher = compileGlob(location);
  if (matcher(filePath)) {
    return true;
  }
  const segments = filePath.split("/");
  for (let length = segments.length - 1; length > 0; length--) {
    if (matcher(segments.slice(0, length).join("/"))) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a rule is a ComponentLocationRule
 */
export function isComponentLocationRule(rule: unknown): rule is ComponentLocationRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as ComponentLocationRule).type === "component-location"
  );
}
