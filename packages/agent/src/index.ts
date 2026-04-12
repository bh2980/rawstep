import { HISTORY_WINDOW, type Agent, type AgentContext, type AgentMemoryEntry, type Decision, type ExperienceSummary, type Observation, type StepRecord, type Task, type TraceAggregate, type UserModel } from "@a11y-task/core";
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
import {
  toAnthropicMessageContent,
  toOpenAICompatibleMessageContent
} from "./provider-content";
import {
  createProviderClient,
  normalizeProviderError
} from "./providers";
import {
  type AgentBackend,
  type AgentProvider,
  type LLMAgentOptions,
  type PromptLogEntry,
  type PromptPart,
  type ResolvedAgentConfig
} from "./shared";

export type {
  AgentBackend,
  AgentProvider,
  LLMAgentOptions,
  PromptLogEntry,
  PromptPart,
  ResolvedAgentConfig
};

export class LLMAgent implements Agent {
  readonly config: ResolvedAgentConfig;

  private readonly client;
  private readonly includeRationale: boolean;
  private readonly includeExperienceSummary: boolean;
  private readonly agentMemoryWindow: number;
  private readonly agentMemoryAll: boolean;
  private readonly taskInput?: Task["input"];
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
    this.agentMemoryWindow = Math.max(0, options.agentMemoryWindow ?? HISTORY_WINDOW);
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

export {
  buildPromptParts,
  buildSystemPrompt,
  buildUserPromptText,
  parseDecision,
  parseExperienceSummary,
  resolveAgentConfig,
  toAnthropicMessageContent,
  toOpenAICompatibleMessageContent
};
