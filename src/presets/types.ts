import type { CustomRule, ToolConfig } from "../check/types";

export interface IntegrationsConfig {
  respectEslintIgnore?: boolean;
  respectPrettierIgnore?: boolean;
  useTypescriptPaths?: boolean;
}

export interface ChaperonePreset {
  name: string;
  description: string;
  extends?: string[];
  rules?: {
    typescript?: ToolConfig;
    eslint?: ToolConfig;
    prettier?: ToolConfig;
    custom?: CustomRule[];
  };
  include?: string[];
  exclude?: string[];
  integrations?: IntegrationsConfig;
}
