import type { ProjectConfig } from "./shared";

export type RawstepConfig = ProjectConfig;

export function defineConfig(config: RawstepConfig): RawstepConfig {
  return config;
}
