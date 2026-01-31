/**
 * Chaperone - Code enforcer library
 *
 * Programmatic API for running code convention checks
 */

export { VERSION } from "./version";

// Init command exports
export { runInit, detectProjectTools } from "./init";
export type {
  ChaperoneConfig,
  DetectionResult,
  InitOptions,
  TypeScriptDetection,
  ESLintDetection,
  PrettierDetection,
  PackageManagerDetection,
} from "./init";

export interface CheckResult {
  file: string;
  rule: string;
  message: string;
  line?: number;
  column?: number;
  severity: "error" | "warning";
}

export interface CheckOptions {
  cwd?: string;
  config?: string;
}

export interface CheckReport {
  files: number;
  violations: CheckResult[];
  passed: boolean;
}

/**
 * Run code convention checks
 */
export async function check(_options: CheckOptions = {}): Promise<CheckReport> {
  // Placeholder implementation
  return {
    files: 0,
    violations: [],
    passed: true,
  };
}
