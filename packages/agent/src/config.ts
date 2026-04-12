import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_PROVIDER,
  type AgentProvider,
  type LLMAgentOptions,
  type ResolvedAgentConfig
} from "./shared";

export function resolveAgentConfig(options: LLMAgentOptions = {}): ResolvedAgentConfig {
  const provider = resolveProvider(options);

  if (provider === "stub") {
    return { provider };
  }

  const apiKey = options.apiKey
    ?? process.env.A11Y_TASK_AGENT_API_KEY
    ?? (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined);

  if (!apiKey) {
    if (provider === "anthropic") {
      throw new Error(
        "Anthropic provider requires an API key. Set A11Y_TASK_AGENT_API_KEY or ANTHROPIC_API_KEY. Set A11Y_TASK_AGENT_PROVIDER=stub for local fixture smoke tests."
      );
    }

    throw new Error(
      "OpenAI-compatible provider requires an API key. Set A11Y_TASK_AGENT_API_KEY."
    );
  }

  if (provider === "anthropic") {
    return {
      provider,
      apiKey,
      model: options.model
        ?? process.env.A11Y_TASK_AGENT_MODEL
        ?? process.env.A11Y_TASK_ANTHROPIC_MODEL
        ?? DEFAULT_ANTHROPIC_MODEL
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
    baseURL: options.baseURL
      ?? process.env.A11Y_TASK_AGENT_BASE_URL
      ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL
  };
}

function resolveProvider(options: LLMAgentOptions): AgentProvider {
  const rawProvider =
    options.provider
    ?? options.backend
    ?? process.env.A11Y_TASK_AGENT_PROVIDER
    ?? process.env.A11Y_TASK_AGENT_MODE
    ?? DEFAULT_PROVIDER;

  if (
    rawProvider === "anthropic"
    || rawProvider === "openai-compatible"
    || rawProvider === "stub"
  ) {
    return rawProvider;
  }

  throw new Error(
    `Unsupported agent provider: ${rawProvider}. Expected one of anthropic, openai-compatible, stub.`
  );
}
