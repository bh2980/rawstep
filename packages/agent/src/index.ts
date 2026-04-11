import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_KEYS,
  isAllowedKey,
  type Agent,
  type AgentContext,
  type Decision,
  type Observation,
  type TaskInput,
  type UserModel
} from "@a11y-task/core";

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_TOKENS = 800;

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
  taskInput?: TaskInput;
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
    this.taskInput = options.taskInput;
  }

  private readonly taskInput?: TaskInput;

  async decide(ctx: AgentContext, obs: Observation): Promise<Decision> {
    const systemPrompt = buildSystemPrompt(this.userModel, this.taskInput);
    const promptParts = buildPromptParts(ctx, obs, this.taskInput);

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

export function buildSystemPrompt(userModel: UserModel, taskInput?: TaskInput): string {
  const lines = [
    `너는 ${userModel} 사용자를 시뮬레이션한다.`,
    `너에게 허용된 키는 ${ALLOWED_KEYS.join(", ")} 뿐이다.`,
    "마우스 클릭과 자유 텍스트 입력은 사용할 수 없다.",
    "너는 DOM, 셀렉터, 접근성 트리에 접근할 수 없다.",
    "focus ring 또는 focus outline은 현재 키보드 포커스가 있는 요소 주위에 보이는 테두리나 강조 표시다.",
    "키보드 과업에서는 현재 포커스 위치를 추정할 때 이 시각적 신호를 우선 사용하라.",
    "Tab / Shift+Tab은 포커스 가능한 요소 사이를 앞뒤로 이동할 때 사용한다.",
    "Enter / Space는 현재 포커스된 버튼, 링크, 컨트롤을 활성화할 때 사용한다.",
    "Arrow 키는 스크롤 또는 복합 위젯 내부 이동이 필요할 때만 사용한다.",
    "Escape는 열린 dialog, menu, popup을 닫을 때 우선 고려한다.",
    "성공은 목표 요소가 보이는 것만으로 선언하지 말고, 네 입력 후 관찰 가능한 상태 변화가 확인될 때만 선언한다.",
    "history가 비어 있거나 step 0이라면 아직 아무것도 시도하지 않은 것이다. success를 선언하지 마라.",
    '너는 한 턴에 action 또는 verdict 중 하나만 반환한다.',
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
    lines.push("입력 가능 여부는 화면 신호로만 추정해야 하며, 내부 구조를 안다고 가정하지 마라.");
    lines.push(
      'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
    );
  } else {
    lines.push('JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}');
  }

  return lines.join("\n");
}

export function buildPromptParts(ctx: AgentContext, obs: Observation, taskInput?: TaskInput): PromptPart[] {
  const promptParts: PromptPart[] = [
    {
      type: "text",
      text: buildUserPromptText(ctx, obs, taskInput)
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
      action?: { key?: string; typeText?: string };
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
      const typeText = candidate.action.typeText;

      if (Boolean(key) === Boolean(typeText)) {
        return malformedDecision(snippet);
      }

      if (key) {
        if (!isAllowedKey(key)) {
          return malformedDecision(snippet);
        }

        return {
          action: { key },
          rationale
        };
      }

      if (typeText === "task") {
        return {
          action: { typeText: "task" },
          rationale
        };
      }

      return malformedDecision(snippet);
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

export function buildUserPromptText(ctx: AgentContext, obs: Observation, taskInput?: TaskInput): string {
  const observationForPrompt =
    obs.kind === "keyboard"
      ? {
          kind: obs.kind,
          browserChrome: {
            urlPath: obs.browserChrome.urlPath
          },
          scrollHint: obs.scrollHint,
          screenshot: {
            viewport: obs.screenshot.viewport
          },
          hasPreviousScreenshot: Boolean(obs.previousScreenshot)
        }
      : obs;

  const lines = [
    `goal: ${ctx.goal}`,
    `recent history: ${JSON.stringify(ctx.history)}`,
    `observation: ${JSON.stringify(observationForPrompt)}`
  ];

  if (taskInput) {
    lines.push(`task input text: ${JSON.stringify(taskInput.text)}`);
  }

  if (obs.kind === "keyboard") {
    lines.push(
      obs.previousScreenshot
        ? "images: 첫 번째 이미지는 현재 스크린샷, 두 번째 이미지는 직전 스크린샷이다. 두 이미지를 비교하여 focus ring이 어디서 어디로 이동했는지 확인하라."
        : "images: 현재 스크린샷 1장이 첨부되어 있다. 직전 스크린샷은 없다 (첫 번째 스텝)."
    );
  }

  return lines.join("\n");
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
  const stepCount = ctx.history.filter((entry) => entry.source === "agent").length;

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
