import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_KEYS,
  SCREENREADER_COMMANDS,
  type AgentMemoryEntry,
  isAllowedKey,
  isScreenReaderCommand,
  type Agent,
  type AgentContext,
  type Decision,
  type ExperienceSummary,
  type Observation,
  type Task,
  type TaskInput,
  type TraceAggregate,
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
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
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
  ctx?: AgentContext;
  obs?: Observation;
  fullMemory?: AgentMemoryEntry[];
};

interface AgentProviderClient {
  complete(input: ProviderDecisionInput): Promise<string>;
}

export class LLMAgent implements Agent {
  readonly config: ResolvedAgentConfig;

  private readonly client: AgentProviderClient;
  private readonly includeRationale: boolean;
  private readonly includeExperienceSummary: boolean;
  private readonly agentMemoryWindow: number;
  private readonly agentMemoryAll: boolean;
  private readonly taskInput?: TaskInput;
  private readonly memory: AgentMemoryEntry[] = [];

  constructor(
    private readonly userModel: UserModel,
    options: LLMAgentOptions = {}
  ) {
    this.config = resolveAgentConfig(options);
    this.client = createProviderClient(this.config, options);
    this.includeRationale = options.includeRationale ?? false;
    this.includeExperienceSummary = options.includeExperienceSummary ?? false;
    this.agentMemoryWindow = Math.max(0, options.agentMemoryWindow ?? 1);
    this.agentMemoryAll = options.agentMemoryAll ?? false;
    this.taskInput = options.taskInput;
  }

  async decide(ctx: AgentContext, obs: Observation): Promise<Decision> {
    const systemPrompt = buildSystemPrompt(
      this.userModel,
      this.taskInput,
      ctx.allowedScreenReaderCommands,
      this.includeRationale
    );
    const promptParts = buildPromptParts(ctx, obs, this.taskInput);

    try {
      const rawText = await this.client.complete({
        systemPrompt,
        promptParts,
        ctx,
        obs,
        fullMemory: this.memory
      });
      return parseDecision(rawText);
    } catch (error) {
      throw normalizeProviderError(error, obs);
    }
  }

  recordStepOutcome(entry: AgentMemoryEntry): void {
    this.memory.push(entry);
  }

  getMemoryExcerpt(): AgentMemoryEntry[] {
    if (this.agentMemoryAll) {
      return [...this.memory];
    }

    if (this.agentMemoryWindow === 0) {
      return [];
    }

    return this.memory.slice(-this.agentMemoryWindow);
  }

  async summarizeExperience(input: {
    task: Task;
    aggregate: TraceAggregate;
  }): Promise<ExperienceSummary> {
    if (!this.includeExperienceSummary) {
      throw new Error("Experience summary is disabled.");
    }

    const rawText = await this.client.complete({
      systemPrompt: buildExperienceSummarySystemPrompt(),
      promptParts: [
        {
          type: "text",
          text: buildExperienceSummaryPromptText(input.task, input.aggregate, this.memory)
        }
      ]
    });

    return parseExperienceSummary(rawText);
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
    return new StubProviderClient(options.includeRationale ?? false);
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

export function buildSystemPrompt(
  userModel: UserModel,
  taskInput?: TaskInput,
  allowedScreenReaderCommands: readonly string[] = SCREENREADER_COMMANDS,
  includeRationale = false
): string {
  if (userModel === "screenreader-strict") {
    return buildScreenReaderStrictSystemPrompt(taskInput, allowedScreenReaderCommands, includeRationale);
  }

  if (userModel === "screenreader-hybrid") {
    return buildScreenReaderHybridSystemPrompt(taskInput, allowedScreenReaderCommands, includeRationale);
  }

  return buildKeyboardSystemPrompt(taskInput, includeRationale);
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
      action?: { key?: string; typeText?: string; srCommand?: string };
      verdict?: string;
      rationale?: string;
    };

    const rationale = typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : undefined;

    const hasAction = candidate.action !== undefined;
    const hasVerdict = candidate.verdict !== undefined;

    if (hasAction === hasVerdict) {
      return malformedDecision(snippet);
    }

    if (candidate.action) {
      const key = candidate.action.key;
      const typeText = candidate.action.typeText;
      const srCommand = candidate.action.srCommand;

      if ([key, typeText, srCommand].filter(Boolean).length !== 1) {
        return malformedDecision(snippet);
      }

      if (key) {
        if (!isAllowedKey(key)) {
          return malformedDecision(snippet);
        }

        return {
          action: { key },
          ...withOptionalRationale(rationale)
        };
      }

      if (typeText === "task") {
        return {
          action: { typeText: "task" },
          ...withOptionalRationale(rationale)
        };
      }

      if (srCommand && isScreenReaderCommand(srCommand)) {
        return {
          action: { srCommand },
          ...withOptionalRationale(rationale)
        };
      }

      return malformedDecision(snippet);
    }

    if (candidate.verdict === "success" || candidate.verdict === "stuck") {
      return {
        verdict: candidate.verdict,
        ...withOptionalRationale(rationale)
      };
    }

    return malformedDecision(snippet);
  } catch {
    return malformedDecision(snippet);
  }
}

export function parseExperienceSummary(raw: string): ExperienceSummary {
  const candidate = JSON.parse(extractJsonObject(raw)) as {
    overall?: unknown;
    biggestFriction?: unknown;
    nextChecks?: unknown;
  };

  if (
    typeof candidate.overall !== "string"
    || typeof candidate.biggestFriction !== "string"
    || !Array.isArray(candidate.nextChecks)
  ) {
    throw new Error("agent returned malformed experience summary");
  }

  const nextChecks = candidate.nextChecks
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 2);

  return {
    overall: candidate.overall.trim(),
    biggestFriction: candidate.biggestFriction.trim(),
    nextChecks
  };
}

function malformedDecision(snippet: string): Decision {
  return {
    verdict: "stuck",
    rationale: `agent returned malformed decision: ${snippet || "<empty response>"}`
  };
}

function withOptionalRationale(rationale: string | undefined): { rationale?: string } {
  return rationale ? { rationale } : {};
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
      : {
          kind: obs.kind,
          announcement: obs.announcement,
          previousAnnouncement: obs.previousAnnouncement
        };

  const lines = [
    `goal: ${ctx.goal}`,
    `agent memory: ${JSON.stringify(ctx.memory)}`,
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

function buildExperienceSummarySystemPrompt(): string {
  return [
    "You are writing an experience summary for a single a11y-task run.",
    "Use only the provided task, aggregate facts, and agent memory.",
    "Do not restate pass/fail as a new judgment.",
    "Do not guess DOM structure, ARIA, WCAG violations, or root causes.",
    "Do not claim to have seen screenshots or visual details beyond the provided facts.",
    "Write a short JSON object with keys overall, biggestFriction, nextChecks.",
    "nextChecks must contain at most 2 short strings."
  ].join("\n");
}

function buildExperienceSummaryPromptText(
  task: Task,
  aggregate: TraceAggregate,
  memory: AgentMemoryEntry[]
): string {
  return [
    `task: ${JSON.stringify({ id: task.id, goal: task.goal, mode: task.mode })}`,
    `aggregate: ${JSON.stringify(aggregate)}`,
    `agent memory: ${JSON.stringify(memory)}`,
    "Summarize the run in terms of experience only.",
    "overall: what the run felt like end-to-end.",
    "biggestFriction: the single biggest friction in the run.",
    "nextChecks: up to 2 concrete things a developer should inspect next.",
    "Do not infer DOM structure or accessibility violations."
  ].join("\n");
}

function buildKeyboardSystemPrompt(taskInput?: TaskInput, includeRationale = false): string {
  const lines = [
    "너는 keyboard 사용자를 시뮬레이션한다.",
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
    "agent memory가 비어 있으면 아직 아무것도 시도하지 않은 것이다. success를 선언하지 마라.",
    '너는 한 턴에 action 또는 verdict 중 하나만 반환한다.'
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
    lines.push("입력 가능 여부는 화면 신호로만 추정해야 하며, 내부 구조를 안다고 가정하지 마라.");
    lines.push(
      includeRationale
        ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
        : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"}'
    );
  } else {
    lines.push(
      includeRationale
        ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
        : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"verdict":"success"}'
    );
  }

  lines.push(includeRationale ? "rationale 필드에 짧은 이유를 포함하라." : "rationale 필드는 포함하지 마라.");

  return lines.join("\n");
}

function buildScreenReaderStrictSystemPrompt(
  taskInput: TaskInput | undefined,
  allowedScreenReaderCommands: readonly string[],
  includeRationale = false
): string {
  const lines = [
    "너는 전맹 screenreader 사용자를 시뮬레이션한다. 이 모드는 screenreader-strict 이다.",
    "너는 화면을 볼 수 없다. 스크린샷이나 시각적 단서를 상상하지 마라.",
    "너는 announcement와 agent memory만 믿고 추론해야 한다.",
    "너는 DOM, 셀렉터, 접근성 트리, 브라우저 제목, URL 경로에 접근할 수 없다.",
    "일반 키보드 탐색 키는 사용할 수 없다.",
    `너에게 허용된 screenreader command는 ${allowedScreenReaderCommands.join(", ")} 이다.`,
    "nextItem / previousItem은 읽기 커서를 앞뒤 항목으로 이동할 때 사용한다.",
    "nextHeading / previousHeading은 제목 단위로 이동할 때 사용한다.",
    "nextFormControl / previousFormControl은 입력 필드나 폼 컨트롤을 찾을 때 사용한다.",
    "act는 현재 스크린 리더 커서 항목의 기본 동작을 실행할 때 사용한다.",
    "성공은 읽힌 announcement나 네 입력 이후의 관찰 가능한 상태 변화가 확인될 때만 선언한다.",
    "agent memory가 비어 있으면 아직 아무것도 시도하지 않은 것이다. success를 선언하지 마라.",
    '너는 한 턴에 action 또는 verdict 중 하나만 반환한다.'
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
  }

  lines.push(
    taskInput
      ? includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"}'
      : includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"verdict":"success"}'
  );
  lines.push(includeRationale ? "rationale 필드에 짧은 이유를 포함하라." : "rationale 필드는 포함하지 마라.");

  return lines.join("\n");
}

function buildScreenReaderHybridSystemPrompt(
  taskInput: TaskInput | undefined,
  allowedScreenReaderCommands: readonly string[],
  includeRationale = false
): string {
  const lines = [
    "너는 전맹 screenreader 사용자를 시뮬레이션한다. 이 모드는 screenreader-hybrid 이다.",
    "너는 화면을 볼 수 없다. 스크린샷이나 시각적 단서를 상상하지 마라.",
    "너는 announcement와 agent memory만 믿고 추론해야 한다.",
    "너는 DOM, 셀렉터, 접근성 트리, 브라우저 제목, URL 경로에 접근할 수 없다.",
    `너에게 허용된 키는 ${ALLOWED_KEYS.join(", ")} 이다.`,
    `너에게 허용된 screenreader command는 ${allowedScreenReaderCommands.join(", ")} 이다.`,
    "이 모드에서는 screenreader command와 일반 키를 함께 사용할 수 있다.",
    "nextItem / previousItem은 읽기 커서를 앞뒤 항목으로 이동할 때 사용한다.",
    "nextHeading / previousHeading은 제목 단위로 이동할 때 사용한다.",
    "nextFormControl / previousFormControl은 입력 필드나 폼 컨트롤을 찾을 때 사용한다.",
    "act는 현재 스크린 리더 커서 항목의 기본 동작을 실행할 때 사용한다.",
    "성공은 읽힌 announcement나 네 입력 이후의 관찰 가능한 상태 변화가 확인될 때만 선언한다.",
    "agent memory가 비어 있으면 아직 아무것도 시도하지 않은 것이다. success를 선언하지 마라.",
    '너는 한 턴에 action 또는 verdict 중 하나만 반환한다.'
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
  }

  lines.push(
    taskInput
      ? includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"}'
      : includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"verdict":"success"}'
  );
  lines.push(includeRationale ? "rationale 필드에 짧은 이유를 포함하라." : "rationale 필드는 포함하지 마라.");

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

function decideWithStub(
  ctx: AgentContext | undefined,
  obs: Observation | undefined,
  fullMemory: AgentMemoryEntry[] | undefined,
  includeRationale = false
): Decision {
  const memory = fullMemory ?? ctx?.memory ?? [];

  if (!obs || obs.kind !== "keyboard") {
    return includeRationale
      ? {
          verdict: "stuck",
          rationale: "Stub agent only supports keyboard observations."
        }
      : { verdict: "stuck" };
  }

  const title = obs.browserChrome.title;
  const stepCount = memory.length;

  if (title.includes("Completed") || title.includes("Closed")) {
    return {
      verdict: "success",
      ...withOptionalRationale(includeRationale ? "관찰 가능한 브라우저 제목이 목표 달성 상태로 바뀌었다." : undefined)
    };
  }

  if (title.includes("Dialog Open")) {
    return {
      action: { key: "Escape" },
      ...withOptionalRationale(includeRationale ? "Dialog가 열린 상태로 보이므로 Escape로 닫기를 시도한다." : undefined)
    };
  }

  if (title.includes("Simple CTA Fixture")) {
    if (stepCount < 2) {
      return {
        action: { key: "Tab" },
        ...withOptionalRationale(includeRationale ? "CTA 버튼 전까지 포커스를 이동하기 위해 Tab을 누른다." : undefined)
      };
    }

    if (stepCount === 2) {
      return {
        action: { key: "Enter" },
        ...withOptionalRationale(includeRationale ? "목표 CTA에 도달했다고 가정하고 활성화한다." : undefined)
      };
    }
  }

  if (title.includes("Modal Fixture")) {
    if (stepCount === 0) {
      return {
        action: { key: "Tab" },
        ...withOptionalRationale(includeRationale ? "Dialog를 여는 첫 버튼으로 이동하기 위해 Tab을 누른다." : undefined)
      };
    }

    if (stepCount === 1) {
      return {
        action: { key: "Enter" },
        ...withOptionalRationale(includeRationale ? "열기 버튼을 활성화한다." : undefined)
      };
    }
  }

  if (title.includes("Bad Focus Fixture")) {
    if (stepCount < 4) {
      return {
        action: { key: "Tab" },
        ...withOptionalRationale(includeRationale ? "포커스를 찾기 위해 계속 Tab으로 탐색한다." : undefined)
      };
    }

    return {
      verdict: "stuck",
      ...withOptionalRationale(includeRationale ? "포커스 단서를 찾지 못해 더 진행할 수 없다." : undefined)
    };
  }

  return {
    verdict: "stuck",
    ...withOptionalRationale(includeRationale ? "Stub agent does not know how to solve this task." : undefined)
  };
}
