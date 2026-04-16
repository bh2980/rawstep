import {
  type Agent,
  type AgentContext,
  type AgentMemoryEntry,
  type Decision,
  type ExperienceSummary,
  type Observation,
  type PlanState,
  type ReflectionState,
  type ResolvedTask,
  type StepRecord,
  type TaskInput,
  type TraceAggregate,
  type UserModel
} from "@rawstep/definition";
import { buildKeyboardActionPlan } from "@rawstep/action-catalog";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveAgentConfig } from "./config";
import {
  buildStuckRationaleRetryPromptParts,
  parseDecision,
  parseDecisionResult,
  parseExperienceSummary,
  parsePlanState,
  parseReflectionState
} from "./parser";
import {
  buildPlanningPromptParts,
  buildPlanningSystemPrompt,
  buildExperienceSummaryPromptText,
  buildExperienceSummarySystemPrompt,
  buildPromptParts,
  buildReflectionPromptText,
  buildReflectionSystemPrompt,
  buildSystemPrompt,
  buildUserPromptText
} from "./prompt";
import { toLanguageModelContent } from "./provider-content";
import {
  createCompletionClient,
  isRetryableProviderError,
  normalizeProviderError
} from "./providers";
import {
  type AgentBackend,
  type AgentCompletionClient,
  type AgentProvider,
  type LLMAgentOptions,
  type ProviderDecisionInput,
  type PromptLogEntry,
  type PromptPart,
  type ResolvedAgentConfig
} from "./shared";

export type {
  AgentBackend,
  AgentCompletionClient,
  AgentProvider,
  LLMAgentOptions,
  ProviderDecisionInput,
  PromptLogEntry,
  PromptPart,
  ResolvedAgentConfig
};

export class LLMAgent implements Agent {
  readonly config: ResolvedAgentConfig;

  private static readonly MAX_PROVIDER_RETRIES = 2;

  private readonly client: AgentCompletionClient;
  private readonly includeRationale: boolean;
  private readonly includeExperienceSummary: boolean;
  private readonly agentMemoryWindow: number;
  private readonly agentMemoryAll: boolean;
  private readonly taskInput?: TaskInput;
  private readonly taskPrompt?: import("@rawstep/definition").TaskPrompt;
  private readonly promptDir?: string;
  private readonly promptLogJsonlPath?: string;
  private readonly keyboardActions: LLMAgentOptions["keyboardActions"];
  private readonly screenReaderActions: LLMAgentOptions["screenReaderActions"];
  private readonly screenReaderCapabilities: LLMAgentOptions["screenReaderCapabilities"];
  private readonly memory: AgentMemoryEntry[] = [];
  private readonly promptLog: PromptLogEntry[] = [];
  private promptLogJsonlInitialized = false;
  private promptLogWriteChain: Promise<void> = Promise.resolve();
  private promptLogWriteError?: Error;

  constructor(
    private readonly userModel: UserModel,
    options: LLMAgentOptions = {}
  ) {
    this.config = resolveAgentConfig(options);
    this.client = options.completionClient ?? createCompletionClient(this.config);
    this.includeRationale = options.includeRationale ?? false;
    this.includeExperienceSummary = options.includeExperienceSummary ?? false;
    this.agentMemoryWindow = Math.max(0, options.agentMemoryWindow ?? 0);
    this.agentMemoryAll = options.agentMemoryAll ?? false;
    this.taskInput = options.taskInput;
    this.taskPrompt = options.taskPrompt;
    this.promptDir = options.promptDir;
    this.promptLogJsonlPath = options.promptLogJsonlPath;
    this.keyboardActions = options.keyboardActions;
    this.screenReaderActions = options.screenReaderActions;
    this.screenReaderCapabilities = options.screenReaderCapabilities;
  }

  async decide(ctx: AgentContext, obs: Observation): Promise<Decision> {
    const phase = ctx.plan ? "execute" as const : "browse" as const;
    const resolvedPromptKeyboardActions = this.keyboardActions
      ?? ctx.keyboardActions
      ?? buildKeyboardActionPlan().descriptors;
    const resolvedPromptScreenReaderActions = this.screenReaderActions
      ?? ctx.screenReaderActions
      ?? [];
    const systemPrompt = buildSystemPrompt(
      this.userModel,
      this.taskInput,
      resolvedPromptKeyboardActions,
      resolvedPromptScreenReaderActions,
      this.includeRationale,
      {
        promptDir: this.promptDir,
        taskPrompt: this.taskPrompt,
        keyboardActions: resolvedPromptKeyboardActions,
        screenReaderActions: resolvedPromptScreenReaderActions,
        phase
      }
    );
    const promptParts = buildPromptParts(
      this.userModel,
      ctx,
      obs,
      this.taskInput,
      {
        promptDir: this.promptDir,
        taskPrompt: this.taskPrompt,
        keyboardActions: resolvedPromptKeyboardActions,
        screenReaderActions: resolvedPromptScreenReaderActions,
        phase
      }
    );
    this.recordPromptLog("decision", systemPrompt, promptParts);

    try {
      const rawText = await this.completeWithRetries({
        systemPrompt,
        promptParts,
        ctx,
        obs,
        fullMemory: this.memory
      });
      const firstPass = parseDecisionResult(
        rawText,
        this.taskInput,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions
      );
      if (firstPass.status === "ok") {
        return firstPass.decision;
      }

      if (firstPass.status === "missing-stuck-rationale") {
        const retryPromptParts = buildStuckRationaleRetryPromptParts(promptParts, rawText);
        this.recordPromptLog("decision", systemPrompt, retryPromptParts);
        const retriedRawText = await this.completeWithRetries({
          systemPrompt,
          promptParts: retryPromptParts,
          ctx,
          obs,
          fullMemory: this.memory
        });

        return parseDecision(
          retriedRawText,
          this.taskInput,
          resolvedPromptKeyboardActions,
          resolvedPromptScreenReaderActions
        );
      }

      return parseDecision(
        rawText,
        this.taskInput,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions
      );
    } catch (error) {
      throw normalizeProviderError(error, obs);
    }
  }

  async planTask(ctx: AgentContext, obs: Observation): Promise<PlanState> {
    const resolvedPromptKeyboardActions = this.keyboardActions
      ?? ctx.keyboardActions
      ?? buildKeyboardActionPlan().descriptors;
    const resolvedPromptScreenReaderActions = this.screenReaderActions
      ?? ctx.screenReaderActions
      ?? [];
    const systemPrompt = buildPlanningSystemPrompt(this.promptDir);
    const promptParts = buildPlanningPromptParts(
      this.userModel,
      ctx,
      obs,
      this.taskInput,
      {
        promptDir: this.promptDir,
        taskPrompt: this.taskPrompt,
        keyboardActions: resolvedPromptKeyboardActions,
        screenReaderActions: resolvedPromptScreenReaderActions
      }
    );
    this.recordPromptLog("planning", systemPrompt, promptParts);

    try {
      const rawText = await this.completeWithRetries({
        systemPrompt,
        promptParts,
        ctx,
        obs,
        fullMemory: this.memory
      });

      return parsePlanState(rawText);
    } catch (error) {
      throw normalizeProviderError(error, obs);
    }
  }

  async reflectProgress(input: {
    ctx: AgentContext;
    steps: StepRecord[];
  }): Promise<ReflectionState> {
    const systemPrompt = buildReflectionSystemPrompt(this.promptDir);
    const promptParts: PromptPart[] = [{
      type: "text",
      text: buildReflectionPromptText(input.ctx, input.steps, this.promptDir)
    }];
    this.recordPromptLog("reflection", systemPrompt, promptParts);

    const rawText = await this.completeWithRetries({
      systemPrompt,
      promptParts,
      ctx: input.ctx,
      fullMemory: this.memory
    });

    return parseReflectionState(rawText);
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

  async flushPromptLog(): Promise<void> {
    await this.promptLogWriteChain;

    if (this.promptLogWriteError) {
      throw this.promptLogWriteError;
    }
  }

  async summarizeExperience(input: {
    task: ResolvedTask;
    aggregate: TraceAggregate;
    steps: StepRecord[];
  }): Promise<ExperienceSummary> {
    if (!this.includeExperienceSummary) {
      throw new Error("Experience summary is disabled.");
    }

    const systemPrompt = buildExperienceSummarySystemPrompt(this.promptDir);
    const promptParts: PromptPart[] = [
      {
        type: "text",
        text: buildExperienceSummaryPromptText(input.task, input.aggregate, input.steps, this.promptDir)
      }
    ];
    this.recordPromptLog("experience-summary", systemPrompt, promptParts);

    const rawText = await this.completeWithRetries({
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
    const entry: PromptLogEntry = {
      kind,
      sequence: this.promptLog.length,
      timestamp: new Date().toISOString(),
      provider: this.config.provider,
      model: this.config.model,
      systemPrompt,
      userPromptText: promptParts
        .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n\n"),
      imageCount: promptParts.filter((part) => part.type === "image").length
    };
    this.promptLog.push(entry);
    this.enqueuePromptLogWrite(entry);
  }

  private enqueuePromptLogWrite(entry: PromptLogEntry): void {
    if (!this.promptLogJsonlPath) {
      return;
    }

    this.promptLogWriteChain = this.promptLogWriteChain
      .then(async () => {
        if (!this.promptLogJsonlInitialized) {
          await mkdir(dirname(this.promptLogJsonlPath!), { recursive: true });
          await writeFile(this.promptLogJsonlPath!, "");
          this.promptLogJsonlInitialized = true;
        }

        await appendFile(this.promptLogJsonlPath!, `${JSON.stringify(entry)}\n`, "utf8");
      })
      .catch((error) => {
        this.promptLogWriteError = error instanceof Error
          ? error
          : new Error(String(error));
      });
  }

  private async completeWithRetries(input: ProviderDecisionInput): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= LLMAgent.MAX_PROVIDER_RETRIES; attempt += 1) {
      try {
        return await this.client.complete(input);
      } catch (error) {
        lastError = error;

        if (
          !isRetryableProviderError(error)
          || attempt === LLMAgent.MAX_PROVIDER_RETRIES
        ) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
}

export {
  buildPlanningPromptParts,
  buildPlanningSystemPrompt,
  buildExperienceSummarySystemPrompt,
  buildPromptParts,
  buildReflectionPromptText,
  buildReflectionSystemPrompt,
  buildSystemPrompt,
  buildUserPromptText,
  parseDecision,
  parseExperienceSummary,
  parsePlanState,
  parseReflectionState,
  resolveAgentConfig,
  toLanguageModelContent
};
