import { type Agent, type AgentContext, type AgentMemoryEntry, type Decision, type ExperienceSummary, type Observation, type ResolvedTask, type StepRecord, type TaskInput, type TraceAggregate, type UserModel } from "@rawstep/definition";
import { buildKeyboardActionPlan } from "@rawstep/action-catalog";
import { resolveAgentConfig } from "./config";
import {
  buildStuckRationaleRetryPromptParts,
  parseDecision,
  parseDecisionResult,
  parseExperienceSummary
} from "./parser";
import {
  buildExperienceSummaryPromptText,
  buildExperienceSummarySystemPrompt,
  buildPromptParts,
  buildSystemPrompt,
  buildUserPromptText
} from "./prompt";
import { toLanguageModelContent } from "./provider-content";
import {
  createCompletionClient,
  normalizeProviderError
} from "./providers";
import {
  type AgentBackend,
  type AgentCompletionClient,
  type AgentProvider,
  type LLMAgentOptions,
  type PromptLogEntry,
  type PromptPart,
  type ResolvedAgentConfig
} from "./shared";

export type {
  AgentBackend,
  AgentCompletionClient,
  AgentProvider,
  LLMAgentOptions,
  PromptLogEntry,
  PromptPart,
  ResolvedAgentConfig
};

export class LLMAgent implements Agent {
  readonly config: ResolvedAgentConfig;

  private readonly client: AgentCompletionClient;
  private readonly includeRationale: boolean;
  private readonly includeExperienceSummary: boolean;
  private readonly agentMemoryWindow: number;
  private readonly agentMemoryAll: boolean;
  private readonly taskInput?: TaskInput;
  private readonly promptDir?: string;
  private readonly keyboardActions: LLMAgentOptions["keyboardActions"];
  private readonly screenReaderActions: LLMAgentOptions["screenReaderActions"];
  private readonly screenReaderCapabilities: LLMAgentOptions["screenReaderCapabilities"];
  private readonly memory: AgentMemoryEntry[] = [];
  private readonly promptLog: PromptLogEntry[] = [];

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
    this.promptDir = options.promptDir;
    this.keyboardActions = options.keyboardActions;
    this.screenReaderActions = options.screenReaderActions;
    this.screenReaderCapabilities = options.screenReaderCapabilities;
  }

  async decide(ctx: AgentContext, obs: Observation): Promise<Decision> {
    const taskInputKeys = this.taskInput ? Object.keys(this.taskInput) : undefined;
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
        keyboardActions: resolvedPromptKeyboardActions,
        screenReaderActions: resolvedPromptScreenReaderActions
      }
    );
    const promptParts = buildPromptParts(
      this.userModel,
      ctx,
      obs,
      this.taskInput,
      {
        promptDir: this.promptDir,
        keyboardActions: resolvedPromptKeyboardActions,
        screenReaderActions: resolvedPromptScreenReaderActions
      }
    );
    this.recordPromptLog("decision", systemPrompt, promptParts);

    try {
      const rawText = await this.client.complete({
        systemPrompt,
        promptParts,
        ctx,
        obs,
        fullMemory: this.memory
      });
      const firstPass = parseDecisionResult(
        rawText,
        taskInputKeys,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions
      );
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

        return parseDecision(
          retriedRawText,
          taskInputKeys,
          resolvedPromptKeyboardActions,
          resolvedPromptScreenReaderActions
        );
      }

      return parseDecision(
        rawText,
        taskInputKeys,
        resolvedPromptKeyboardActions,
        resolvedPromptScreenReaderActions
      );
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
      model: this.config.model,
      systemPrompt,
      userPromptText: promptParts
        .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n\n"),
      imageCount: promptParts.filter((part) => part.type === "image").length
    });
  }
}

export {
  buildExperienceSummarySystemPrompt,
  buildPromptParts,
  buildSystemPrompt,
  buildUserPromptText,
  parseDecision,
  parseExperienceSummary,
  resolveAgentConfig,
  toLanguageModelContent
};
