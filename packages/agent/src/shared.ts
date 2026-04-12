import type {
  AgentContext,
  AgentMemoryEntry,
  Observation,
  TaskInput
} from "@a11y-task/core";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MAX_TOKENS = 800;

export type AgentProvider = "anthropic" | "openai-compatible" | "stub";
export type AgentBackend = AgentProvider;

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/png"; base64: string };

export type PromptLogEntry = {
  kind: "decision" | "experience-summary";
  sequence: number;
  provider: AgentProvider;
  model: string;
  systemPrompt: string;
  userPromptText: string;
  imageCount: number;
};

export type LLMAgentOptions = {
  provider?: AgentProvider;
  backend?: AgentBackend;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  taskInput?: TaskInput;
  fetchImpl?: typeof fetch;
};

export type AnthropicAgentConfig = {
  provider: "anthropic";
  apiKey: string;
  model: string;
};

export type OpenAICompatibleAgentConfig = {
  provider: "openai-compatible";
  apiKey: string;
  model: string;
  baseURL: string;
};

export type StubAgentConfig = {
  provider: "stub";
};

export type ResolvedAgentConfig =
  | AnthropicAgentConfig
  | OpenAICompatibleAgentConfig
  | StubAgentConfig;

export type ProviderDecisionInput = {
  systemPrompt: string;
  promptParts: PromptPart[];
  ctx?: AgentContext;
  obs?: Observation;
  fullMemory?: AgentMemoryEntry[];
};

export interface AgentProviderClient {
  complete(input: ProviderDecisionInput): Promise<string>;
}
