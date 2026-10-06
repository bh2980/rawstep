import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { Decision, DecisionPolicy } from '@rawstep/core/contracts';
import type { ChoiceModel } from './choice.js';
import { modelHistory, type ModelHistoryEntry } from './history.js';
import { speechChoices, speechGuardStop, type SpeechPolicyOptions } from './speech.js';

/** One small step the executor works on: what to do and what it hears when the step is done. */
export type PlanStep = { goal: string; done: string };
/**
 * A planner's answer. `outline` is the rough route from common UI conventions: expectations, not facts about this page.
 * `complete` says the goal already appears done, so the run stops and the independent verifier decides.
 */
export type Plan = { outline: string[]; steps: PlanStep[]; complete: boolean };
/** Why the planner was called: the first plan, or what went wrong with the current one. */
export type PlanReason = 'start' | 'help' | 'failures' | 'no-change' | 'step-limit' | 'plan-finished';
export type PlanRequest = {
  goal: string;
  reason: PlanReason;
  /** What the screen reader says now. */
  speech: string[];
  /** Recent steps with their results, as the executor sees them. */
  history: ModelHistoryEntry[];
  /** Small steps already finished, oldest first. */
  completed: string[];
  /** The plan being replaced and the step that was in progress. */
  previous?: { plan: Plan; step: number };
};
/** `prompt.sha256` fingerprints the planner's full instructions, so runs with different planner instructions stay apart. */
export type PlanResult = { plan: Plan; model: { id: string; runtime: string }; prompt?: { sha256: string } };
/** Makes and revises plans. Called a few times per run, so it can be a slower model than the executor. */
export interface Planner {
  plan(request: PlanRequest, options: { signal: AbortSignal }): Promise<PlanResult>;
}

export type OrchestrationOptions = SpeechPolicyOptions & {
  /** New plans after the first one before the run stops as stuck (default 4). */
  maxReplans?: number;
  /** Actions on one small step before asking for a new plan (default 12). */
  stepActionLimit?: number;
  /** Failed actions in a row before asking for a new plan (default 2). */
  failureLimit?: number;
  /** Actions in a row that changed nothing before asking for a new plan (default 3). */
  noChangeLimit?: number;
  /** Past steps the planner sees (default 30). */
  plannerHistoryLimit?: number;
};
const DEFAULTS = { ...RAWSTEP_DEFAULTS.orchestration, failureLimit: 2, noChangeLimit: 3, plannerHistoryLimit: 30, historyLimit: RAWSTEP_DEFAULTS.policy.historyLimit };
/** Executor calls in one runner step at most: finishing steps or replanning never loops without an action. */
const MAX_CALLS_PER_STEP = 8;
const STEP_DONE = 'step:done', STEP_HELP = 'step:help';

/** Added to the executor's prompt: how to read the current step and when to use the two plan choices. */
export const ORCHESTRATED_EXECUTOR_GUIDE = 'You carry out one small step of a plan at a time: work toward currentStep.goal while keeping the overall goal in mind. ' +
  'Choose "Current step done" only when the speech or history shows currentStep.done. Choose "Ask for a new plan" when the available actions cannot achieve the step. ' +
  'Each history entry says whether the action ran (execution.ok) and whether the speech changed afterwards (changed).';
/** The run's prompt with the executor guide appended; a new ID keeps its evidence apart from the plain prompt's. */
export function orchestratedPrompt<P extends { id: string; version: string; instructions: string }>(prompt: P): P {
  return { ...prompt, id: `${prompt.id}.orchestrated`.slice(0, 128), instructions: `${prompt.instructions}\n${ORCHESTRATED_EXECUTOR_GUIDE}` };
}

/**
 * Screen reader decisions split between a planner and a fast executor. The planner (an LLM, called rarely) gives a rough
 * plan and small steps; the executor (a decision model, called every step) works on the current step only and may say the
 * step is done or ask for help. Rawstep also asks for a new plan when actions keep failing, change nothing, or a step runs
 * long. Every plan, finished step and replan is policy evidence: where the executor needed help is where the page was hard.
 */
export class OrchestratedSpeechPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  private readonly limits: typeof DEFAULTS;
  private plan?: Plan;
  private stepIndex = 0;
  private stepActions = 0;
  private replans = 0;
  private completed: string[] = [];
  /** History length when the current plan was made: triggers only look at what happened since. */
  private planFrom = 0;
  constructor(readonly planner: Planner, readonly executor: ChoiceModel, private readonly options: OrchestrationOptions = {}) {
    if (!executor.inputs.includes('text')) throw new Error('The executor needs a model that takes text.');
    this.limits = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([key, v]) => key in DEFAULTS && v !== undefined)) } as typeof DEFAULTS;
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < (key === 'maxReplans' ? 0 : 1) || value > 10_000) throw new Error(`Invalid orchestration limit ${key}.`);
    }
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }

  async decide(input: Parameters<DecisionPolicy['decide']>[0]): Promise<Decision> {
    this.evidence = []; input.signal.throwIfAborted();
    if (input.observation.kind !== 'screenreader') throw new Error('The orchestrated speech policy requires screen reader observations.');
    const guarded = speechGuardStop(this.options, input);
    if (guarded) { this.evidence.push(guarded.evidence); return guarded.decision; }
    if (!this.plan) await this.replan(input, 'start');
    else {
      const trigger = this.trigger(input);
      if (trigger) { if (this.replans >= this.limits.maxReplans) return this.giveUp(trigger); await this.replan(input, trigger); }
    }
    for (let call = 0; call < MAX_CALLS_PER_STEP; call++) {
      const plan = this.plan!;
      if (plan.complete) return { stop: 'success', stopSource: 'model' };
      if (this.stepIndex >= plan.steps.length) {
        if (this.replans >= this.limits.maxReplans) return this.giveUp('plan-finished');
        await this.replan(input, 'plan-finished'); continue;
      }
      const step = plan.steps[this.stepIndex]!;
      const actions = speechChoices(input.allowedActions, this.options, input.inputs);
      const candidates = [...actions.map(({ id, label }) => ({ id, label })),
        { id: STEP_DONE, label: `Current step done: ${step.done}` },
        { id: STEP_HELP, label: 'Ask for a new plan: the current step cannot be done with these actions' }];
      const started = performance.now();
      const response = await this.executor.choose({ state: {
        goal: input.goal, currentStep: step, completedSteps: [...this.completed],
        speech: [...input.observation.speech], history: modelHistory(input.history, input.observation, this.limits.historyLimit),
      }, choices: candidates }, { signal: input.signal });
      input.signal.throwIfAborted();
      if (!candidates.some(c => c.id === response.choiceId)) throw new Error('The model selected an unknown choice.');
      this.evidence.push({ kind: 'model-inference', role: 'executor', model: response.model, ...(response.prompt ? { prompt: response.prompt } : {}), elapsedMs: performance.now() - started,
        observationSource: input.observation.provenance === 'simulation' ? 'simulated-speech-only' : 'screen-reader-output-only',
        stepGoal: step.goal, choices: candidates, choiceId: response.choiceId, ...(response.probabilities ? { probabilities: response.probabilities } : {}),
        noDomOrAxContext: true, uncertainty: 'Model probabilities are not measured accuracy or accessibility certification.' });
      if (response.choiceId === STEP_DONE) {
        this.evidence.push({ kind: 'orchestration-step-done', step: this.stepIndex, goal: step.goal, actions: this.stepActions });
        this.completed.push(step.goal); this.stepIndex++; this.stepActions = 0;
        continue;
      }
      if (response.choiceId === STEP_HELP) {
        if (this.replans >= this.limits.maxReplans) return this.giveUp('help');
        await this.replan(input, 'help'); continue;
      }
      this.stepActions++;
      const decision = structuredClone(actions.find(c => c.id === response.choiceId)!.decision);
      return 'stop' in decision ? { ...decision, stopSource: 'model' } : decision;
    }
    return this.giveUp('no-action');
  }

  /** What went wrong since the current plan was made, if anything warrants a new one. */
  private trigger(input: Parameters<DecisionPolicy['decide']>[0]): PlanReason | undefined {
    const since = modelHistory(input.history, input.observation, Number.MAX_SAFE_INTEGER).slice(this.planFrom).filter(h => 'action' in h.decision);
    const last = (n: number) => since.length >= n ? since.slice(-n) : undefined;
    if (last(this.limits.failureLimit)?.every(h => h.execution?.ok === false)) return 'failures';
    if (last(this.limits.noChangeLimit)?.every(h => h.changed === false)) return 'no-change';
    if (this.stepActions >= this.limits.stepActionLimit) return 'step-limit';
    return undefined;
  }
  private async replan(input: Parameters<DecisionPolicy['decide']>[0], reason: PlanReason): Promise<void> {
    if (input.observation.kind !== 'screenreader') return;
    const previous = this.plan ? { plan: structuredClone(this.plan), step: this.stepIndex } : undefined;
    const started = performance.now();
    const { plan, model, prompt } = await this.planner.plan({ goal: input.goal, reason, speech: [...input.observation.speech],
      history: modelHistory(input.history, input.observation, this.limits.plannerHistoryLimit), completed: [...this.completed], ...(previous ? { previous } : {}) }, { signal: input.signal });
    input.signal.throwIfAborted();
    if (!plan.complete && !plan.steps.length) throw new Error('The planner returned no steps for an unfinished goal.');
    if (reason !== 'start') this.replans++;
    this.plan = structuredClone(plan); this.stepIndex = 0; this.stepActions = 0; this.planFrom = input.history.length;
    this.evidence.push({ kind: 'orchestration-plan', reason, replans: this.replans, plan: structuredClone(plan), model, ...(prompt ? { prompt } : {}), elapsedMs: performance.now() - started,
      uncertainty: 'The outline comes from common UI conventions and is an expectation, not a fact about this page.' });
  }
  private giveUp(reason: PlanReason | 'no-action'): Decision {
    this.evidence.push({ kind: 'orchestration-limit', reason, replans: this.replans, maxReplans: this.limits.maxReplans,
      uncertainty: 'The planner and executor could not make progress within the limits; this ends exploration, it does not establish an accessibility defect.' });
    return { stop: 'stuck', stopSource: 'exploration-guard' };
  }
}
