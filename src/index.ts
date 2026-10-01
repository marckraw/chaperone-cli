/**
 * Chaperone - Code enforcer library
 *
 * Programmatic API for running code convention checks
 */

export { VERSION } from "./version";

// Init command exports
export { runInit, detectProjectTools } from "./init";
export type {
  ChaperoneConfig as InitChaperoneConfig,
  DetectionResult,
  InitOptions,
  TypeScriptDetection,
  ESLintDetection,
  PrettierDetection,
  PackageManagerDetection,
} from "./init";

// Check command exports
export {
  check,
  checkAndFormat,
  createCheckOptions,
  loadConfig,
  loadConfigWithDiagnostics,
  validateConfig,
  ConfigError,
  getEffectivePatterns,
  runAllTools,
  runAllRules,
  format,
  formatText,
  formatJson,
  formatAI,
} from "./check";

export type {
  CheckResult,
  CheckSummary,
  CheckOptions,
  ConfigDiagnostic,
  RuleSummary,
  RunnerSummary,
  LoadedConfig,
  ChaperoneConfig,
  CustomRule,
  FilePairingRule,
  FileContractRule,
  RegexRule,
  PackageFieldsRule,
  ComponentLocationRule,
  ReactComponentCountRule,
  CommandRule,
  SymbolReferenceRule,
  RetiredPathRule,
  ForbiddenImportRule,
  ImportBoundaryRule,
  PublicApiRule,
  DirectiveExportPatternRule,
  RepeatedLiteralRule,
  AIGeneratedMetadata,
  AIInstructionFile,
  ToolConfig,
  RulesConfig,
} from "./check";

// Analyze command exports
export { analyze, runAnalyze, formatAnalyzeResult } from "./analyze";
export type { AnalyzeOptions, AnalyzeResult, SkippedInstruction } from "./analyze";

// Utils exports
export { execCommand, findNpmBinary, commandExists } from "./utils/process";
export { globSync, matchGlob, getAllFiles } from "./utils/glob";
export { fileExists, readJsonFile, readTextFile, findFirstExisting, joinPath } from "./utils/fs";
export { copyToClipboard } from "./utils/clipboard";
