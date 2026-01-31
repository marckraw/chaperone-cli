import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "../../utils/glob";
import type { CheckResult, ComponentLocationRule } from "../types";
import type { RuleResult, RuleRunnerOptions } from "./types";

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

  for (let i = 0; i < STATEFUL_PATTERNS.length; i++) {
    if (STATEFUL_PATTERNS[i].test(content)) {
      detectedPatterns.push(patternNames[i] || `pattern-${i}`);
    }
  }

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
  const { cwd, exclude } = options;
  const results: CheckResult[] = [];

  // Merge global excludes with rule-specific excludes
  const allExcludes = [...exclude, ...(rule.exclude ?? [])];

  // Find all component files
  const files = globSync(rule.files, {
    cwd,
    ignore: allExcludes,
  });

  for (const file of files) {
    const fullPath = join(cwd, file);

    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
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

  return { ruleId: rule.id, results };
}

/**
 * Check if a file path matches a location pattern (glob-like)
 */
function matchesLocationPattern(filePath: string, locationPattern: string): boolean {
  // Simple prefix matching for now
  // e.g., "src/components/ui/" matches "src/components/ui/Button.tsx"
  if (locationPattern.endsWith("/")) {
    return filePath.startsWith(locationPattern);
  }

  // Glob pattern matching
  const regexPattern = locationPattern
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\//g, "\\/");

  const regex = new RegExp(`^${regexPattern}`);
  return regex.test(filePath);
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
