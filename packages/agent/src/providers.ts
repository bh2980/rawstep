import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Observation } from "@rawstep/definition";
import { generateText } from "ai";
import { toLanguageModelContent } from "./provider-content";
import {
  DEFAULT_MAX_TOKENS,
  type AgentCompletionClient,
  type AnthropicAgentConfig,
  type OpenAICompatibleAgentConfig,
  type ProviderDecisionInput,
  type ResolvedAgentConfig
} from "./shared";

export function createCompletionClient(
  config: ResolvedAgentConfig
): AgentCompletionClient {
  if (config.provider === "anthropic") {
    return new AISDKCompletionClient(createAnthropicModel(config), config.model, config);
  }

  return new AISDKCompletionClient(createOpenAICompatibleModel(config), config.model, config);
}

export function normalizeProviderError(error: unknown, obs: Observation): Error {
  const message = buildProviderErrorMessage(error);

  if (obs.kind === "keyboard" && looksLikeImageCapabilityError(message)) {
    return new Error(
      "The selected provider or model does not support the image input required for keyboard mode."
    );
  }

  if (error instanceof Error) {
    const normalized = new Error(message);
    normalized.name = error.name;
    return normalized;
  }

  return new Error(message);
}

export function isRetryableProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;

  if (
    message === "Invalid JSON response"
    || message === "Response body is empty"
  ) {
    return true;
  }

  if (statusCode === 408 || statusCode === 429) {
    return true;
  }

  return typeof statusCode === "number" && statusCode >= 500;
}

class AISDKCompletionClient implements AgentCompletionClient {
  constructor(
    private readonly model: unknown,
    readonly modelId: string,
    private readonly config: ResolvedAgentConfig
  ) {}

  async complete(input: ProviderDecisionInput): Promise<string> {
    const result = await generateText({
      model: this.model as never,
      system: input.systemPrompt,
      maxOutputTokens: DEFAULT_MAX_TOKENS,
      providerOptions: buildProviderOptions(this.config) as never,
      messages: [
        {
          role: "user",
          content: toLanguageModelContent(input.promptParts) as never
        }
      ]
    });

    return result.text.trim();
  }
}

function createAnthropicModel(config: AnthropicAgentConfig): unknown {
  return createAnthropic({
    apiKey: config.apiKey
  })(config.model);
}

function createOpenAICompatibleModel(config: OpenAICompatibleAgentConfig): unknown {
  const provider = createOpenAICompatible({
    name: "openai-compatible",
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  return provider(config.model);
}

export function buildProviderOptions(
  config: ResolvedAgentConfig
): Record<string, Record<string, unknown>> | undefined {
  if (config.provider !== "openai-compatible" || !config.reasoningEffort) {
    return undefined;
  }

  return {
    openaiCompatible: {
      reasoningEffort: config.reasoningEffort
    }
  };
}

function looksLikeImageCapabilityError(message: string): boolean {
  return [
    /image/i,
    /vision/i,
    /multimodal/i,
    /does not support.*image/i,
    /input_image/i,
    /image_url/i
  ].some((pattern) => pattern.test(message));
}

function buildProviderErrorMessage(error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error);
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
  const responseBody = typeof (error as { responseBody?: unknown })?.responseBody === "string"
    ? (error as { responseBody: string }).responseBody
    : undefined;

  if (!responseBody) {
    return withStatusSuffix(fallback, statusCode);
  }

  const parsedBody = tryParseJson(responseBody);
  const providerName = getNestedString(parsedBody, ["error", "metadata", "provider_name"]);
  const rawMetadata = getNestedString(parsedBody, ["error", "metadata", "raw"]);
  const parsedRawMetadata = rawMetadata ? tryParseJson(rawMetadata) : undefined;
  const rawMessage =
    getNestedString(parsedRawMetadata, ["error", "message"])
    ?? rawMetadata;
  const bodyMessage = getNestedString(parsedBody, ["error", "message"]);
  const resolvedMessage = rawMessage && rawMessage !== bodyMessage
    ? rawMessage
    : bodyMessage;

  if (!resolvedMessage || resolvedMessage === fallback) {
    return withStatusSuffix(fallback, statusCode, providerName);
  }

  return withStatusSuffix(resolvedMessage, statusCode, providerName);
}

function withStatusSuffix(
  message: string,
  statusCode?: number,
  providerName?: string
): string {
  const suffixParts = [
    providerName ? `provider ${providerName}` : undefined,
    typeof statusCode === "number" ? `status ${statusCode}` : undefined
  ].filter((part): part is string => Boolean(part));

  if (suffixParts.length === 0) {
    return message;
  }

  return `${message} (${suffixParts.join(", ")})`;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getNestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim().length > 0
    ? current.trim()
    : undefined;
}
