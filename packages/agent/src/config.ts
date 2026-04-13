import {
  type AgentProvider,
  type LLMAgentOptions,
  type ResolvedAgentConfig
} from "./shared";

export function resolveAgentConfig(options: LLMAgentOptions = {}): ResolvedAgentConfig {
  const provider = resolveProvider(options);

  const apiKey = options.apiKey
    ?? process.env.A11Y_TASK_AGENT_API_KEY
    ?? (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined);

  if (!apiKey) {
    if (provider === "anthropic") {
      throw new Error(
        "Anthropic provider requires an API key. Set A11Y_TASK_AGENT_API_KEY or ANTHROPIC_API_KEY."
      );
    }

    throw new Error(
      "OpenAI-compatible provider requires an API key. Set A11Y_TASK_AGENT_API_KEY."
    );
  }

  if (provider === "anthropic") {
    const model =
      options.model
      ?? process.env.A11Y_TASK_AGENT_MODEL
      ?? process.env.A11Y_TASK_ANTHROPIC_MODEL;
    if (!model) {
      throw new Error(
        "Anthropic provider requires a model. Set A11Y_TASK_AGENT_MODEL, A11Y_TASK_ANTHROPIC_MODEL, or rawstep.config.ts defaults.model."
      );
    }

    return {
      provider,
      apiKey,
      model
    };
  }

  const model = options.model ?? process.env.A11Y_TASK_AGENT_MODEL;
  if (!model) {
    throw new Error(
      "OpenAI-compatible provider requires a model. Set A11Y_TASK_AGENT_MODEL or pass --model."
    );
  }

  return {
    provider,
    apiKey,
    model,
    baseURL: resolveOpenAICompatibleBaseURL(options)
  };
}

function resolveProvider(options: LLMAgentOptions): AgentProvider {
  const rawProvider =
    options.provider
    ?? options.backend
    ?? process.env.A11Y_TASK_AGENT_PROVIDER;

  if (!rawProvider) {
    throw new Error(
      "Missing agent provider. Set rawstep.config.ts defaults.provider, A11Y_TASK_AGENT_PROVIDER, or pass --provider."
    );
  }

  if (
    rawProvider === "anthropic"
    || rawProvider === "openai-compatible"
  ) {
    return rawProvider;
  }

  throw new Error(
    `Unsupported agent provider: ${rawProvider}. Expected one of anthropic, openai-compatible.`
  );
}

function resolveOpenAICompatibleBaseURL(options: LLMAgentOptions): string {
  const baseURL = options.baseURL ?? process.env.A11Y_TASK_AGENT_BASE_URL;
  if (!baseURL) {
    throw new Error(
      "OpenAI-compatible provider requires a base URL. Set A11Y_TASK_AGENT_BASE_URL or rawstep.config.ts defaults.baseURL."
    );
  }

  return baseURL;
}
