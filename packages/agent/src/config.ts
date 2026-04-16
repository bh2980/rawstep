import {
  type AgentProvider,
  type LLMAgentOptions,
  type ResolvedAgentConfig
} from "./shared";

export function resolveAgentConfig(options: LLMAgentOptions = {}): ResolvedAgentConfig {
  const provider = resolveProvider(options);

  const apiKey = options.apiKey
    ?? process.env.AI_API_KEY;

  if (!apiKey) {
    if (provider === "anthropic") {
      throw new Error(
        "Anthropic provider requires an API key. Set AI_API_KEY."
      );
    }

    throw new Error(
      "OpenAI-compatible provider requires an API key. Set AI_API_KEY."
    );
  }

  if (provider === "anthropic") {
    const model =
      options.model
      ?? process.env.AI_MODEL;
    if (!model) {
      throw new Error(
        "Anthropic provider requires a model. Set AI_MODEL or rawstep.config.ts defaults.model."
      );
    }

    return {
      provider,
      apiKey,
      model,
      reasoningEffort: options.reasoningEffort
    };
  }

  const model = options.model ?? process.env.AI_MODEL;
  if (!model) {
    throw new Error(
      "OpenAI-compatible provider requires a model. Set AI_MODEL or pass --model."
    );
  }

  return {
    provider,
    apiKey,
    model,
    baseURL: resolveOpenAICompatibleBaseURL(options),
    reasoningEffort: options.reasoningEffort
  };
}

function resolveProvider(options: LLMAgentOptions): AgentProvider {
  const rawProvider =
    options.provider
    ?? options.backend
    ?? process.env.AI_PROVIDER;

  if (!rawProvider) {
    throw new Error(
      "Missing agent provider. Set rawstep.config.ts defaults.provider, AI_PROVIDER, or pass --provider."
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
  const baseURL = options.baseURL ?? process.env.AI_BASE_URL;
  if (!baseURL) {
    throw new Error(
      "OpenAI-compatible provider requires a base URL. Set AI_BASE_URL or rawstep.config.ts defaults.baseURL."
    );
  }

  return baseURL;
}
