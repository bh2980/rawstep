import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_KEYS,
  SCREENREADER_COMMANDS,
  type Action,
  type AllowedKey,
  type AgentMemoryEntry,
  isAllowedKey,
  isScreenReaderCommand,
  type Agent,
  type AgentContext,
  type Decision,
  type ExperienceSummary,
  type Observation,
  type StepRecord,
  type ScreenReaderCommand,
  type Task,
  type TaskInput,
  type TraceAggregate,
  type UserModel,
  type Verdict
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
  private readonly promptLog: PromptLogEntry[] = [];

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
    this.recordPromptLog("decision", systemPrompt, promptParts);

    try {
      const rawText = await this.client.complete({
        systemPrompt,
        promptParts,
        ctx,
        obs,
        fullMemory: this.memory
      });
      const firstPass = parseDecisionResult(rawText);
      if (firstPass.status === "ok") {
        return firstPass.decision;
      }

      if (firstPass.status === "missing-stuck-rationale") {
        const retryPromptParts = buildStuckRationaleRetryPromptParts(promptParts, rawText);
        this.recordPromptLog("decision", systemPrompt, retryPromptParts);
        const retriedRawText = await this.client.complete({
          systemPrompt,
          promptParts: retryPromptParts,
          ctx,
          obs,
          fullMemory: this.memory
        });

        return parseDecision(retriedRawText);
      }

      return malformedDecision(firstPass.snippet);
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

  getPromptLog(): PromptLogEntry[] {
    return [...this.promptLog];
  }

  async summarizeExperience(input: {
    task: Task;
    aggregate: TraceAggregate;
    steps: StepRecord[];
  }): Promise<ExperienceSummary> {
    if (!this.includeExperienceSummary) {
      throw new Error("Experience summary is disabled.");
    }

    const systemPrompt = buildExperienceSummarySystemPrompt();
    const promptParts: PromptPart[] = [
      {
        type: "text",
        text: buildExperienceSummaryPromptText(input.task, input.aggregate, input.steps)
      }
    ];
    this.recordPromptLog("experience-summary", systemPrompt, promptParts);

    const rawText = await this.client.complete({
      systemPrompt,
      promptParts
    });

    return parseExperienceSummary(rawText);
  }

  private recordPromptLog(
    kind: PromptLogEntry["kind"],
    systemPrompt: string,
    promptParts: PromptPart[]
  ): void {
    this.promptLog.push({
      kind,
      sequence: this.promptLog.length,
      provider: this.config.provider,
      model: this.config.provider === "stub" ? "stub" : this.config.model,
      systemPrompt,
      userPromptText: promptParts
        .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n\n"),
      imageCount: promptParts.filter((part) => part.type === "image").length
    });
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
  const result = parseDecisionResult(raw);

  if (result.status === "ok") {
    return result.decision;
  }

  return malformedDecision(result.snippet);
}

type ParseDecisionResult =
  | { status: "ok"; decision: Decision }
  | { status: "missing-stuck-rationale"; snippet: string }
  | { status: "malformed"; snippet: string };

function parseDecisionResult(raw: string): ParseDecisionResult {
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
      return { status: "malformed", snippet };
    }

    if (candidate.action) {
      const key = candidate.action.key;
      const typeText = candidate.action.typeText;
      const srCommand = candidate.action.srCommand;

      if ([key, typeText, srCommand].filter(Boolean).length !== 1) {
        return { status: "malformed", snippet };
      }

      if (key) {
        if (!isAllowedKey(key)) {
          return { status: "malformed", snippet };
        }

        return {
          status: "ok",
          decision: {
            action: { key },
            ...withOptionalRationale(rationale)
          }
        };
      }

      if (typeText === "task") {
        return {
          status: "ok",
          decision: {
            action: { typeText: "task" },
            ...withOptionalRationale(rationale)
          }
        };
      }

      if (srCommand && isScreenReaderCommand(srCommand)) {
        return {
          status: "ok",
          decision: {
            action: { srCommand },
            ...withOptionalRationale(rationale)
          }
        };
      }

      return { status: "malformed", snippet };
    }

    if (candidate.verdict === "success" || candidate.verdict === "stuck") {
      if (candidate.verdict === "stuck" && !rationale) {
        return { status: "missing-stuck-rationale", snippet };
      }

      return {
        status: "ok",
        decision: {
          verdict: candidate.verdict,
          ...withOptionalRationale(rationale)
        }
      };
    }

    return { status: "malformed", snippet };
  } catch {
    return { status: "malformed", snippet };
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

function buildStuckRationaleRetryPromptParts(
  promptParts: PromptPart[],
  previousRawText: string
): PromptPart[] {
  return [
    ...promptParts,
    {
      type: "text",
      text: [
        "이전 응답은 verdict=\"stuck\" 이었지만 rationale이 없었다.",
        "같은 판단을 유지해도 좋다.",
        "다시 JSON만 반환하라.",
        "stuck을 유지한다면 rationale에 종료가 타당한 이유를 한 문장으로 반드시 포함하라.",
        `previous response: ${JSON.stringify(previousRawText.trim())}`
      ].join("\n")
    }
  ];
}

export function buildUserPromptText(ctx: AgentContext, obs: Observation, taskInput?: TaskInput): string {
  const lines = [
    `goal: ${ctx.goal}`,
    formatAgentMemoryBlock(ctx.memory)
  ];

  if (obs.kind === "screenreader") {
    lines.push(`announcement: ${obs.announcement}`);
  }

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
    "Use only the provided task, aggregate facts, and full step trace.",
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
  steps: StepRecord[]
): string {
  return [
    `task: ${JSON.stringify({ id: task.id, goal: task.goal, mode: task.mode })}`,
    `aggregate: ${JSON.stringify(aggregate)}`,
    `steps: ${JSON.stringify(buildSummaryStepsForPrompt(steps))}`,
    "Summarize the run in terms of experience only.",
    "overall: what the run felt like end-to-end.",
    "biggestFriction: the single biggest friction in the run.",
    "nextChecks: up to 2 concrete things a developer should inspect next.",
    "Do not infer DOM structure or accessibility violations."
  ].join("\n");
}

function buildSummaryStepsForPrompt(steps: StepRecord[]): Array<{
  step: number;
  observation: object;
  decision: string;
  execution: {
    ok: boolean;
    costDelta: number;
    error?: string;
  };
  verification?: {
    passed: boolean;
    failures: string[];
  };
  result?: {
    finalResult: "success" | "failure" | "continued";
    completionSource: "agent" | "verifier-auto-complete";
  };
  timings: StepRecord["timings"];
}> {
  return steps.map((step) => ({
    step: step.step,
    observation: summarizeObservationForPrompt(step),
    decision: summarizeDecisionForPrompt(step.decision),
    execution: {
      ok: step.execution.ok,
      costDelta: step.execution.costDelta,
      ...(step.execution.error ? { error: step.execution.error } : {})
    },
    verification: step.verification
      ? {
          passed: step.verification.passed,
          failures: step.verification.failures
        }
      : undefined,
    result: step.verdictAnalysis
      ? {
          finalResult: step.verdictAnalysis.finalResult,
          completionSource: step.verdictAnalysis.completionSource
        }
      : undefined,
    timings: step.timings
  }));
}

function formatDecisionAction(action: Action): string {
  if ("key" in action) {
    return `key(${action.key})`;
  }

  if ("srCommand" in action) {
    return `srCommand(${action.srCommand})`;
  }

  return "typeText(task)";
}

function summarizeObservationForPrompt(step: StepRecord): object {
  if (step.observation.kind === "keyboard") {
    return {
      kind: "keyboard",
      title: step.observation.browserChrome.title,
      urlPath: step.observation.browserChrome.urlPath,
      scrollHint: step.observation.scrollHint
    };
  }

  return {
    kind: "screenreader",
    announcement: step.observation.announcement,
    announcementCapture: step.observation.announcementCapture,
    announcementCount: step.observation.announcementCount,
    observeReason: step.observation.observeReason
  };
}

function summarizeDecisionForPrompt(decision: Decision): string {
  return "action" in decision
    ? formatDecisionAction(decision.action)
    : `verdict(${decision.verdict})`;
}

function formatAgentMemoryBlock(memory: AgentMemoryEntry[]): string {
  if (memory.length === 0) {
    return "agent memory: (empty)";
  }

  return [
    "agent memory:",
    ...memory.map((entry) =>
      `- step ${entry.step}: action=\"${entry.action}\", outcome=\"${entry.outcome}\"`
    )
  ].join("\n");
}

function buildKeyboardSystemPrompt(taskInput?: TaskInput, includeRationale = false): string {
  const lines = [
    "너는 keyboard 사용자를 시뮬레이션한다.",
    "목표는 현재 과업 목표를 달성하는 것이다.",
    `사용 가능한 입력은 ${ALLOWED_KEYS.join(", ")}다.`,
    "판단에는 현재 이미지, 직전 이미지, 프롬프트에 제공된 텍스트 정보, agent memory, goal만 사용한다.",
    "판단 우선순위는 현재 이미지, 직전 이미지, 프롬프트에 제공된 텍스트 정보, agent memory 순서다.",
    "현재 이미지는 현재 상태 판단에 사용하라.",
    "직전 이미지는 변화 비교에 사용하라.",
    "agent memory는 최근 행동 흐름을 참고하는 보조 정보로 사용하라.",
    "focus ring 또는 focus outline이 보이면 그 위치를 현재 포커스 위치로 추정하라.",
    "focus ring이 약하거나 불분명하면 하나의 후보로 충분히 좁혀질 때만 현재 포커스 위치를 보수적으로 추정하라.",
    "후보가 여러 개면 활성화보다 탐색 action을 우선하라.",
    "Tab / Shift+Tab은 포커스 가능한 요소 사이 이동에 사용하라.",
    "Enter / Space는 현재 포커스된 요소 활성화에 사용하라.",
    "Arrow 키는 스크롤 또는 복합 위젯 내부 이동에 사용하라.",
    "Escape는 열린 dialog, menu, popup 정리에 사용하라.",
    "직전 Enter 또는 Space 뒤에 상태 변화가 보이면 그 변화에 맞는 다음 행동을 선택하라.",
    "직전 Enter 또는 Space 뒤에 상태 변화가 약하면 다른 합리적인 키를 먼저 검토하라.",
    "최근 여러 step이 모두 Tab / Shift+Tab이라면 목표에 더 가까워졌다는 시각적 근거를 먼저 확인하라.",
    "근거가 충분하면 같은 탐색 흐름을 이어가라.",
    "근거가 약하면 탐색 방향이나 키 선택을 조정하라.",
    "success는 지금 멈추고 검증해도 될 가능성이 높다는 신호다.",
    "목표 달성 신호가 충분하면 success를 선택하라.",
    "추가 확인 가치가 남아 있으면 다음 action을 선택하라.",
    "stuck은 현재 관측과 최근 행동 흐름을 기준으로 종료가 가장 타당한 상태라는 신호다.",
    "비슷한 행동이 이어지고, 시각적 진전이 약하며, 다음에 시도할 합리적인 키 전략도 희미하면 stuck을 선택하라.",
    "다음 행동 후보가 보이면 그 action을 선택하라.",
    "stuck을 반환할 때는 rationale에 종료가 타당한 이유를 한 문장으로 반드시 적어라.",
    "너는 한 턴에 action 또는 verdict 중 하나만 반환한다.",
    "JSON만 반환하라."
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
    lines.push("입력 가능 여부는 화면 신호로만 추정해야 하며, 내부 구조를 안다고 가정하지 마라.");
    lines.push(
      includeRationale
        ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
    );
  } else {
    lines.push(
      includeRationale
        ? 'JSON 형식: {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"key":"Tab"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
    );
  }

  if (includeRationale) {
    lines.push("rationale 필드에 짧은 이유를 포함하라.");
  }

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
    "stuck을 반환할 때는 rationale에 종료가 타당한 이유를 한 문장으로 반드시 적어라.",
    "너는 한 턴에 action 또는 verdict 중 하나만 반환한다.",
    "JSON만 반환하라."
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
  }

  lines.push(
    taskInput
      ? includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
      : includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
  );
  if (includeRationale) {
    lines.push("rationale 필드에 짧은 이유를 포함하라.");
  }

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
    "stuck을 반환할 때는 rationale에 종료가 타당한 이유를 한 문장으로 반드시 적어라.",
    "너는 한 턴에 action 또는 verdict 중 하나만 반환한다.",
    "JSON만 반환하라."
  ];

  if (taskInput) {
    lines.push('이 task에서는 action으로 {"typeText":"task"} 를 선택할 수 있다.');
    lines.push("typeText는 task에 제공된 고정 문자열만 입력한다. 임의 텍스트를 생성하거나 수정하지 마라.");
  }

  lines.push(
    taskInput
      ? includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"action":{"typeText":"task"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"action":{"typeText":"task"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
      : includeRationale
        ? 'JSON 형식: {"action":{"srCommand":"nextItem"},"rationale":"..."} 또는 {"action":{"key":"Tab"},"rationale":"..."} 또는 {"verdict":"success","rationale":"..."} 또는 {"verdict":"stuck","rationale":"..."}'
        : 'JSON 형식: {"action":{"srCommand":"nextItem"}} 또는 {"action":{"key":"Tab"}} 또는 {"verdict":"success"} 또는 {"verdict":"stuck","rationale":"..."}'
  );
  if (includeRationale) {
    lines.push("rationale 필드에 짧은 이유를 포함하라.");
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
