import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Observation } from "@rawstep/core";
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
    return new AISDKCompletionClient(createAnthropicModel(config), config.model);
  }

  return new AISDKCompletionClient(createOpenAICompatibleModel(config), config.model);
}

export function normalizeProviderError(error: unknown, obs: Observation): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (obs.kind === "keyboard" && looksLikeImageCapabilityError(message)) {
    return new Error(
      "The selected provider or model does not support the image input required for keyboard mode."
    );
  }

  return error instanceof Error ? error : new Error(message);
}

class AISDKCompletionClient implements AgentCompletionClient {
  constructor(
    private readonly model: unknown,
    readonly modelId: string
  ) {}

  async complete(input: ProviderDecisionInput): Promise<string> {
    const result = await generateText({
      model: this.model as never,
      system: input.systemPrompt,
      maxOutputTokens: DEFAULT_MAX_TOKENS,
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
