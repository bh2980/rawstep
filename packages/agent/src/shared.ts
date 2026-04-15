import type {
  KeyboardActionDescriptor,
  ScreenReaderActionDescriptor,
  ScreenReaderCapabilities
} from "@rawstep/action-catalog";
import type {
  AgentContext,
  AgentMemoryEntry,
  Observation,
  TaskInput
} from "@rawstep/definition";

export const DEFAULT_MAX_TOKENS = 800;

export type AgentProvider = "anthropic" | "openai-compatible";
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
  promptDir?: string;
  keyboardActions?: readonly KeyboardActionDescriptor[];
  screenReaderActions?: readonly ScreenReaderActionDescriptor[];
  screenReaderCapabilities?: ScreenReaderCapabilities;
  completionClient?: AgentCompletionClient;
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

export type ResolvedAgentConfig =
  | AnthropicAgentConfig
  | OpenAICompatibleAgentConfig;

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

export interface AgentCompletionClient {
  complete(input: ProviderDecisionInput): Promise<string>;
}
