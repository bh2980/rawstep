import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_KEYS,
  isAllowedKey,
  type Agent,
  type AgentContext,
  type Decision,
  type KeyboardObservation,
  type Observation,
  type UserModel
} from "@a11y-task/core";

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 400;

export type AgentProvider = "anthropic" | "openai-compatible" | "stub";
export type AgentBackend = AgentProvider;

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/png"; base64: string };

export type LLMAgentOptions = {
  provider?: AgentProvider;
  backend?: AgentBackend;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  fetchImpl?: typeof fetch;
};

type AnthropicAgentConfig = {
  provider: "anthropic";
  apiKey: string;
  model: string;
};

type OpenAICompatibleAgentConfig = {
  provider: "openai-compatible";
  apiKey: string;
  model: string;
  baseURL: string;
};

type StubAgentConfig = {
  provider: "stub";
};

export type ResolvedAgentConfig =
  | AnthropicAgentConfig
  | OpenAICompatibleAgentConfig
  | StubAgentConfig;

type ProviderDecisionInput = {
  systemPrompt: string;
  promptParts: PromptPart[];
  ctx: AgentContext;
  obs: Observation;
};

interface AgentProviderClient {
  decide(input: ProviderDecisionInput): Promise<string>;
}

export class LLMAgent implements Agent {
  readonly config: ResolvedAgentConfig;

  private readonly client: AgentProviderClient;

  constructor(
    private readonly userModel: UserModel,
    options: LLMAgentOptions = {}
  ) {
    this.config = resolveAgentConfig(options);
    this.client = createProviderClient(this.config, options);
  }

  async decide(ctx: AgentContext, obs: Observation): Promise<Decision> {
    const systemPrompt = buildSystemPrompt(this.userModel);
    const promptParts = buildPromptParts(ctx, obs);

    try {
      const rawText = await this.client.decide({
        systemPrompt,
        promptParts,
        ctx,
        obs
      });
      return parseDecision(rawText);
    } catch (error) {
      throw normalizeProviderError(error, obs);
    }
  }
}

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

function createProviderClient(
  config: ResolvedAgentConfig,
  options: LLMAgentOptions
): AgentProviderClient {
  if (config.provider === "stub") {
    return new StubProviderClient();
  }

  if (config.provider === "anthropic") {
    return new AnthropicProviderClient(config);
  }

  return new OpenAICompatibleProviderClient(config, options.fetchImpl ?? fetch);
}

class AnthropicProviderClient implements AgentProviderClient {
  private readonly client: Anthropic;

  constructor(private readonly config: AnthropicAgentConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async decide(input: ProviderDecisionInput): Promise<string> {
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

  async decide(input: ProviderDecisionInput): Promise<string> {
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
  async decide(input: ProviderDecisionInput): Promise<string> {
    return JSON.stringify(decideWithStub(input.ctx, input.obs));
  }
}

export function buildSystemPrompt(userModel: UserModel): string {
  return [
    `너는 ${userModel} 사용자를 시뮬레이션한다.`,
    `너에게 허용된 키는 ${ALLOWED_KEYS.join(", ")} 뿐이다.`,
    "너는 DOM, 셀렉터, 접근성 트리에 접근할 수 없다.",
    '너는 한 턴에 action 또는 verdict 중 하나만 반환한다.',
    'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
  ].join("\n");
}

export function buildPromptParts(ctx: AgentContext, obs: Observation): PromptPart[] {
  const promptParts: PromptPart[] = [
    {
      type: "text",
      text: buildUserPromptText(ctx, obs)
    }
  ];

  if (obs.kind === "keyboard") {
    promptParts.push({
      type: "image",
      mediaType: "image/png",
      base64: obs.screenshot.pngBase64
    });

    if (obs.previousScreenshot) {
      promptParts.push({
        type: "image",
        mediaType: "image/png",
        base64: obs.previousScreenshot.pngBase64
      });
    }
  }

  return promptParts;
}

export function toAnthropicMessageContent(promptParts: PromptPart[]): Anthropic.MessageParam["content"] {
  return promptParts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text
      };
    }

    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: part.mediaType,
        data: part.base64
      }
    };
  });
}

type OpenAICompatibleContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function toOpenAICompatibleMessageContent(promptParts: PromptPart[]): OpenAICompatibleContentPart[] {
  return promptParts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text
      };
    }

    return {
      type: "image_url",
      image_url: {
        url: `data:${part.mediaType};base64,${part.base64}`
      }
    };
  });
}

export function parseDecision(raw: string): Decision {
  const snippet = raw.trim().slice(0, 240);

  try {
    const candidate = JSON.parse(extractJsonObject(raw)) as {
      action?: { key?: string };
      verdict?: string;
      rationale?: string;
    };

    const rationale = typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : "Agent returned an empty rationale.";

    const hasAction = candidate.action !== undefined;
    const hasVerdict = candidate.verdict !== undefined;

    if (hasAction === hasVerdict) {
      return malformedDecision(snippet);
    }

    if (candidate.action) {
      const key = candidate.action.key;
      if (!key || !isAllowedKey(key)) {
        return malformedDecision(snippet);
      }

      return {
        action: { key },
        rationale
      };
    }

    if (candidate.verdict === "success" || candidate.verdict === "stuck") {
      return {
        verdict: candidate.verdict,
        rationale
      };
    }

    return malformedDecision(snippet);
  } catch {
    return malformedDecision(snippet);
  }
}

function malformedDecision(snippet: string): Decision {
  return {
    verdict: "stuck",
    rationale: `agent returned malformed decision: ${snippet || "<empty response>"}`
  };
}

function extractJsonObject(raw: string): string {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return raw.trim();
}

function buildUserPromptText(ctx: AgentContext, obs: Observation): string {
  const observationForPrompt =
    obs.kind === "keyboard"
      ? {
          kind: obs.kind,
          browserChrome: obs.browserChrome,
          scrollHint: obs.scrollHint,
          screenshot: {
            viewport: obs.screenshot.viewport
          },
          hasPreviousScreenshot: Boolean(obs.previousScreenshot)
        }
      : obs;

  return [
    `goal: ${ctx.goal}`,
    `recent history: ${JSON.stringify(ctx.history)}`,
    `observation: ${JSON.stringify(observationForPrompt)}`
  ].join("\n");
}

function normalizeProviderError(error: unknown, obs: Observation): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (obs.kind === "keyboard" && looksLikeImageCapabilityError(message)) {
    return new Error(
      "The selected provider or model does not support the image input required for keyboard mode."
    );
  }

  return error instanceof Error ? error : new Error(message);
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

function decideWithStub(ctx: AgentContext, obs: Observation): Decision {
  if (obs.kind !== "keyboard") {
    return {
      verdict: "stuck",
      rationale: "Stub agent only supports keyboard observations."
    };
  }

  const title = obs.browserChrome.title;
  const stepCount = ctx.history.length;

  if (title.includes("Completed") || title.includes("Closed")) {
    return {
      verdict: "success",
      rationale: "관찰 가능한 브라우저 제목이 목표 달성 상태로 바뀌었다."
    };
  }

  if (title.includes("Dialog Open")) {
    return {
      action: { key: "Escape" },
      rationale: "Dialog가 열린 상태로 보이므로 Escape로 닫기를 시도한다."
    };
  }

  if (title.includes("Simple CTA Fixture")) {
    if (stepCount < 2) {
      return {
        action: { key: "Tab" },
        rationale: "CTA 버튼 전까지 포커스를 이동하기 위해 Tab을 누른다."
      };
    }

    if (stepCount === 2) {
      return {
        action: { key: "Enter" },
        rationale: "목표 CTA에 도달했다고 가정하고 활성화한다."
      };
    }
  }

  if (title.includes("Modal Fixture")) {
    if (stepCount === 0) {
      return {
        action: { key: "Tab" },
        rationale: "Dialog를 여는 첫 버튼으로 이동하기 위해 Tab을 누른다."
      };
    }

    if (stepCount === 1) {
      return {
        action: { key: "Enter" },
        rationale: "열기 버튼을 활성화한다."
      };
    }
  }

  if (title.includes("Bad Focus Fixture")) {
    if (stepCount < 4) {
      return {
        action: { key: "Tab" },
        rationale: "포커스를 찾기 위해 계속 Tab으로 탐색한다."
      };
    }

    return {
      verdict: "stuck",
      rationale: "포커스 단서를 찾지 못해 더 진행할 수 없다."
    };
  }

  return {
    verdict: "stuck",
    rationale: "Stub agent does not know how to solve this task."
  };
}
