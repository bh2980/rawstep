import Anthropic from "@anthropic-ai/sdk";
import type { Observation } from "@a11y-task/core";
import { decideWithStub } from "./stub";
import {
  DEFAULT_MAX_TOKENS,
  type AgentProviderClient,
  type AnthropicAgentConfig,
  type LLMAgentOptions,
  type OpenAICompatibleAgentConfig,
  type ProviderDecisionInput,
  type ResolvedAgentConfig
} from "./shared";
import {
  toAnthropicMessageContent,
  toOpenAICompatibleMessageContent
} from "./provider-content";

export function createProviderClient(
  config: ResolvedAgentConfig,
  options: LLMAgentOptions
): AgentProviderClient {
  if (config.provider === "stub") {
    return new StubProviderClient(options.includeRationale ?? false);
  }

  if (config.provider === "anthropic") {
    return new AnthropicProviderClient(config);
  }

  return new OpenAICompatibleProviderClient(config, options.fetchImpl ?? fetch);
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

class AnthropicProviderClient implements AgentProviderClient {
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicAgentConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async complete(input: ProviderDecisionInput): Promise<string> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: input.systemPrompt,
      messages: [
        {
          role: "user",
          content: toAnthropicMessageContent(input.promptParts)
        }
      ]
    });

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }
}

class OpenAICompatibleProviderClient implements AgentProviderClient {
  constructor(
    private readonly config: OpenAICompatibleAgentConfig,
    private readonly fetchImpl: typeof fetch
  ) {}

  async complete(input: ProviderDecisionInput): Promise<string> {
    const response = await this.fetchImpl(
      joinUrl(this.config.baseURL, "/chat/completions"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: [
            {
              role: "system",
              content: input.systemPrompt
            },
            {
              role: "user",
              content: toOpenAICompatibleMessageContent(input.promptParts)
            }
          ]
        })
      }
    );

    const payload = await response.json() as OpenAICompatibleResponse | OpenAICompatibleErrorResponse;

    if (!response.ok) {
      throw new Error(readOpenAICompatibleError(payload, response.status));
    }

    return extractOpenAICompatibleText(payload);
  }
}

class StubProviderClient implements AgentProviderClient {
  constructor(private readonly includeRationale = false) {}

  async complete(input: ProviderDecisionInput): Promise<string> {
    if (input.systemPrompt.includes("experience summary")) {
      return JSON.stringify({
        overall: "The run reached an outcome after a short sequence of steps.",
        biggestFriction: "The main friction was the amount of navigation before the goal state was confirmed.",
        nextChecks: ["Check the initial guidance.", "Check the feedback after interaction."]
      });
    }

    return JSON.stringify(
      decideWithStub(input.ctx, input.obs, input.fullMemory, this.includeRationale)
    );
  }
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

function joinUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}${path}`;
}

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type OpenAICompatibleErrorResponse = {
  error?: {
    message?: string;
    type?: string;
  };
};

function readOpenAICompatibleError(
  payload: OpenAICompatibleResponse | OpenAICompatibleErrorResponse,
  status: number
): string {
  if ("error" in payload) {
    const message = payload.error?.message?.trim();
    return message ? `OpenAI-compatible provider error (${status}): ${message}` : `OpenAI-compatible provider error (${status}).`;
  }

  return `OpenAI-compatible provider error (${status}).`;
}

function extractOpenAICompatibleText(payload: OpenAICompatibleResponse | OpenAICompatibleErrorResponse): string {
  if (!("choices" in payload)) {
    return "";
  }

  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }

  return "";
}
