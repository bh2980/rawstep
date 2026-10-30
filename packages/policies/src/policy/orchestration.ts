import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { Decision, DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';
import type { ChoiceCandidate, ChoiceModel, ModelFailure } from './choice.js';
import { modelHistory, type ModelHistoryEntry } from './history.js';
import { applyDraft, cueText, currentTask, failCurrent, finishCurrent, goalLeads, goalNamed, markCheckpoint, needsCheckpoint, phaseOf, matchCue, planOutline, planTasks, verifyCue,
  type GiveUp, type HelpReason, type PlanDocument, type PlanDraft, type PlanTask, type PlanTrigger } from './plan-document.js';
import { currentItem, currentItemState, speechChoices, speechGuardStop, type SpeechPolicyOptions } from './speech.js';

/** One past action as the planner reads it: the task it belonged to and what happened. */
export type TaskAttempt = ModelHistoryEntry & { taskId: string; planVersion: number };
export type PlanRequest = {
  goal: string;
  /** What the screen reader cursor is on now, as last spoken (see `currentItem`). */
  currentItem?: string;
  /** What the user knows about the site and page before starting (the task's context), when given. */
  context?: string;
  trigger: PlanTrigger;
  /** Why the executor asked for help, when it did. */
  help?: HelpReason;
  /** What the screen reader says now. */
  speech: string[];
  /** The page title, as a screen reader announces it on load (absent when unknown). */
  title?: string;
  /** What the executor can actually do: action candidates and named inputs (secret values never included). */
  actions: ChoiceCandidate[];
  /** The plan so far: statuses, completion checks and revision history. Absent for the first plan. */
  document?: PlanDocument;
  /** Every action taken under a plan so far, with the task it served and its result. */
  attempts: TaskAttempt[];
  /** How much the user has spent so far (see `Effort`). */
  effort: Effort;
  /** Why the last give-up was not accepted, when the planner is asked again because of it. */
  refusedGiveUp?: string;
};
/**
 * The user's effort in moves (swipes and key presses): in all, since the planner last looked, and without hearing a word of the goal
 * (the current stretch and the longest one). Time is left out: it depends on the models, not on the page.
 */
export type Effort = { moves: number; sinceLastLook: number; withoutGoalWords: number; longestWithoutGoalWords: number };
/** Moves in a row without hearing a word of the goal, now and at most, from what each action left the cursor on. */
export function goalWordStretch(goal: string, items: readonly (string | undefined)[]): { current: number; longest: number } {
  const lead = goalLeads(goal);
  let current = 0, longest = 0;
  for (const item of items) { current = lead(item) ? 0 : current + 1; longest = Math.max(longest, current); }
  return { current, longest };
}
/** `prompt` fingerprints the planner's full instructions, so runs with different planner instructions stay apart. */
export type PlanResult = { draft: PlanDraft; model: { id: string; runtime: string }; prompt?: { id: string; version: string; sha256: string }; retried?: ModelFailure };
/** Asks whether a spoken item is what the current task looks for, its cue having been written before the item was heard. */
export type CueRequest = { goal: string; context?: string; task: { goal: string; done: string; cue: string }; heard: string };
export type CueResult = { matches: boolean; reason?: string; model: { id: string; runtime: string }; retried?: ModelFailure };
/** Drafts and revises the plan document. Called a few times per run, so it can be a slower model than the executor. */
export interface Planner {
  plan(request: PlanRequest, options: { signal: AbortSignal }): Promise<PlanResult>;
  /**
   * Whether `heard` is the item the task's cue describes. A planner that cannot judge this (a plan file) leaves it out, and only a
   * cue heard as written ends a task.
   */
  recognize?(request: CueRequest, options: { signal: AbortSignal }): Promise<CueResult>;
}

export type OrchestrationOptions = SpeechPolicyOptions & {
  /** Planner calls a run may make, the first plan included (default 40). Past it the run ends unmeasured: a cost limit, not the user giving up. */
  maxPlannerCalls?: number;
  /** Moves since the planner last looked before it looks again with the effort spent (`effort-review`, default 60). */
  reviewEvery?: number;
  /** Actions on one task without hearing anything new before a new plan is requested (default 12). */
  stepActionLimit?: number;
  /** Failed actions in a row on one task before a new plan is requested (default 2). */
  failureLimit?: number;
  /** Actions in a row on one task that changed nothing before a new plan is requested (default 3). */
  noChangeLimit?: number;
  /** Past actions the planner sees, each with what was heard before it (default 60); older ones are forgotten. */
  plannerHistoryLimit?: number;
  /**
   * Who decides that a task is finished or that the plan needs revising. `rawstep` (default): the executor only picks actions; a
   * task ends when its cue is heard, and a new plan is requested on Rawstep's signals (failures, no change, the task limit, low
   * executor confidence). `executor`: the executor may also claim "done" (checked against the cue) and ask for a new plan. A
   * decision model picks those meta options far too often when they echo the task's words, so they are off unless compared.
   */
  taskControl?: 'rawstep' | 'executor';
  /**
   * With `rawstep` task control: a choice counts as low confidence when its top probability is less than this far from a uniform
   * guess (1/n) towards certainty (1): 0 is a coin toss among n choices, 1 is sure. A fixed probability would mean something
   * different with 3 choices than with 15. Default 0.25.
   */
  confidenceFloor?: number;
  /** How many low-confidence choices in a row on one task ask for a new plan (default 2). */
  lowConfidenceSteps?: number;
  /**
   * Actions in a row on one task that only swing between the same two items (A, B, A, B, …) before a new plan is requested
   * (default 4). The executor is stuck between them; waiting for the task limit only adds detours.
   */
  oscillationLimit?: number;
  /**
   * What the simulated user does before the first plan. `headings`: list the page's headings (a VoiceOver user's rotor, VO+U) with
   * the `headings.list` intent; it is an action like any other and counts as a step. The planner then plans from what that list said.
   */
  survey?: 'none' | 'headings';
  /**
   * With Rawstep's task control and an executor model: how much the executor decides inside a task. `none` (default): only the
   * task's moves, and a pressing task without moves only presses. `direction`: the task's moves and the same moves the other way
   * (next ↔ previous). `method`: every movement. Activation follows `activates` in all three. The planner shapes tasks to match.
   */
  executorLatitude?: ExecutorLatitude;
};
export type ExecutorLatitude = 'none' | 'direction' | 'method';
/** The same move the other way: next ↔ previous, heading.next ↔ heading.previous. */
const opposite = (move: string) => move.replace(/next|previous/, m => m === 'next' ? 'previous' : 'next');
const DEFAULTS = { ...RAWSTEP_DEFAULTS.orchestration, failureLimit: 2, noChangeLimit: 3, historyLimit: RAWSTEP_DEFAULTS.policy.historyLimit, lowConfidenceSteps: 2, oscillationLimit: 4 };
/** Executor calls in one runner step at most: finishing tasks or replanning never loops without an action. */
const MAX_CALLS_PER_STEP = 8;
/**
 * Actions on a task, since its plan, before the executor may ask for help. A decision model asks readily, and every request
 * costs a correction of the plan; a few tries first give the plan a fair chance (the task limit still catches a stuck task).
 */
const TRIES_BEFORE_HELP = 3;
const TASK_DONE = 'task:done';
const HELP: Record<HelpReason, string> = {
  'no-cue': 'Ask for a new plan: the completion cue of the current task cannot be found',
  'no-effect': 'Ask for a new plan: actions have no effect here',
  'already-done': 'Ask for a new plan: the current task already looks done, or the page is not what the plan expected',
};

/**
 * The action a plan prescribes for its task, among the offered ones: a pressing task presses; a moving task takes its first move;
 * a task that names neither moves to the next item. Undefined when none of those is offered.
 */
export function followPlan(task: Pick<PlanTask, 'activates' | 'moves'>, offered: readonly string[]): string | undefined {
  const wanted = task.activates === true ? ['activate'] : [...(task.moves ?? []), 'next'];
  return wanted.map(intent => `intent:${intent}`).find(id => offered.includes(id));
}
/** How far the top probability is from a uniform guess (0) towards certainty (1); undefined without probabilities. */
export function confidenceOf(probabilities: readonly number[] | undefined): number | undefined {
  if (!probabilities || probabilities.length < 2) return undefined;
  const uniform = 1 / probabilities.length;
  return Math.max(0, (Math.max(...probabilities) - uniform) / (1 - uniform));
}
/** Added to the executor's prompt when Rawstep controls the tasks: the executor only moves. */
export const ACTION_ONLY_EXECUTOR_GUIDE = 'You carry out one task of a plan at a time: pick the action that brings currentTask.goal closer while keeping the overall goal in mind; plan shows where the run is. ' +
  'currentItem is what the screen reader cursor is on now; activating presses or opens it. ' +
  'Rawstep moves on to the next task by itself when currentTask.cue is heard, and asks for a new plan when the task stops making progress, so always pick an action. ' +
  'taskAttempts are your actions on this task so far: each says whether it ran (execution.ok) and whether the speech changed (changed). Do not repeat what failed.';
/** Added to the executor's prompt when the executor may claim tasks done and ask for help: how to read the plan and when to use the task choices. */
export const ORCHESTRATED_EXECUTOR_GUIDE = 'You carry out one task of a plan at a time: work toward currentTask.goal while keeping the overall goal in mind; plan shows where the run is. ' +
  'Choose "Current task done" only when the speech shows currentTask.done; Rawstep checks it against currentTask.cue and turns the claim down when the cue was not heard. Choose an "Ask for a new plan" option, with the matching reason, when the task cannot be done with the available actions. ' +
  'taskAttempts are your actions on this task so far: each says whether it ran (execution.ok) and whether the speech changed (changed). Do not repeat what failed.';
/** The run's prompt with the executor guide appended; a new ID keeps its evidence apart from the plain prompt's. */
export function orchestratedPrompt<P extends { id: string; version: string; instructions: string }>(prompt: P, taskControl: 'rawstep' | 'executor' = 'rawstep'): P {
  return taskControl === 'executor'
    ? { ...prompt, id: `${prompt.id}.orchestrated`.slice(0, 128), instructions: `${prompt.instructions}\n${ORCHESTRATED_EXECUTOR_GUIDE}` }
    : { ...prompt, id: `${prompt.id}.orchestrated-actions`.slice(0, 128), instructions: `${prompt.instructions}\n${ACTION_ONLY_EXECUTOR_GUIDE}` };
}

type Input = Parameters<DecisionPolicy['decide']>[0];

/**
 * Screen reader decisions split between a planner and an executor around a plan document (plan-document.ts). The planner (an LLM,
 * called rarely) drafts and revises phases of tasks; Rawstep owns the document — task statuses, the current task, versions and
 * history — and links every action to its task. The executor (a fast decision model, called every step) only sees the current
 * task, may claim it done (Rawstep checks the cue) or ask for a new plan with a reason. Rawstep also replans when a task's actions
 * keep failing, change nothing or run long. Every plan, task change and model call is policy evidence.
 */
export class OrchestratedSpeechPolicy implements DecisionPolicy {
  private evidence: unknown[] = [];
  private readonly limits: typeof DEFAULTS;
  private doc?: PlanDocument;
  private plannerCalls = 0;
  /** The user's accepted decision to give up; the run ends at the next decision. */
  private gaveUp?: GiveUp;
  /** History length when the current plan version was made: the repetition guard only looks at what happened since. */
  private planFrom = 0;
  /** History length when the current task started. */
  private taskFrom = 0;
  /** The task and plan version each executed step served, by runner step. */
  private readonly served = new Map<number, { taskId: string; planVersion: number }>();
  private readonly control: 'rawstep' | 'executor';
  private readonly confidenceFloor: number;
  /** Executor choices in a row on the current task whose top probability was below the floor. */
  private lowConfidence = 0;
  private surveyed = false;
  /** Spoken items already put to the planner for the current task: one question per item. */
  private asked = new Set<string>();
  /** Items named as in the goal that the planner was already told about. */
  private readonly noticed = new Set<string>();
  /**
   * `executor` is the model that picks each action inside a task, or `'follow-plan'`: no model, Rawstep carries out the plan as
   * written (a pressing task presses, a moving task uses its first move). Then every judgement is the planner's and the cue's, and
   * a run costs only planner calls; it needs Rawstep's task control.
   */
  constructor(readonly planner: Planner, readonly executor: ChoiceModel | 'follow-plan', private readonly options: OrchestrationOptions = {}) {
    if (executor === 'follow-plan' ? options.taskControl === 'executor' : !executor.inputs.includes('text')) throw new Error(executor === 'follow-plan' ? 'Following the plan needs Rawstep\'s task control.' : 'The executor needs a model that takes text.');
    this.limits = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([key, v]) => key in DEFAULTS && v !== undefined)) } as typeof DEFAULTS;
    this.control = options.taskControl ?? 'rawstep';
    this.confidenceFloor = options.confidenceFloor ?? 0.25;
    if (!(this.confidenceFloor >= 0 && this.confidenceFloor <= 1)) throw new Error('Invalid orchestration confidence floor.');
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error(`Invalid orchestration limit ${key}.`);
    }
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  /** The plan document as it stands, for callers that save it (a copy). */
  planDocument(): PlanDocument | undefined { return this.doc && structuredClone(this.doc); }

  async decide(input: Input): Promise<Decision> {
    this.evidence = []; input.signal.throwIfAborted();
    if (input.observation.kind !== 'screenreader') throw new Error('The orchestrated speech policy requires screen reader observations.');
    const step = (input.history.at(-1)?.step ?? 0) + 1;
    // The same speech over and over ("End of content") means the plan led nowhere, not that the user would stop: a person turns back
    // and tries something else. The planner gets that chance while planner calls remain.
    const guarded = speechGuardStop(this.options, { ...input, history: input.history.slice(this.planFrom) });
    let repeated = false;
    if (guarded) {
      this.evidence.push(guarded.evidence);
      if (!this.doc) return guarded.decision;
      repeated = true;
    }
    // A survey before the first plan is the user's own move, so it is taken as an action and the plan is written on what it said.
    if (!this.doc && this.options.survey === 'headings' && !this.surveyed && input.allowedActions.intents.includes('headings.list')) {
      this.surveyed = true;
      this.evidence.push({ kind: 'orchestration-survey', survey: 'headings', step });
      return { action: { kind: 'intent', intent: 'headings.list' } };
    }
    if (!this.doc) await this.replan(input, step, 'start');
    else {
      const trigger = repeated ? 'no-change' : this.trigger(input);
      if (trigger) { if (this.outOfCalls()) return this.unmeasured(step, trigger); await this.replan(input, step, trigger); }
    }
    // A "done" claim turned down in this step is not offered again until an action has been taken.
    let refused: string | undefined;
    for (let call = 0; call < MAX_CALLS_PER_STEP; call++) {
      if (this.gaveUp) return this.userGaveUp(step);
      const doc = this.doc!;
      if (doc.complete) return { stop: 'success', stopSource: 'planner' };
      const task = currentTask(doc);
      if (!task) {
        if (this.outOfCalls()) return this.unmeasured(step, 'plan-finished');
        const unreviewed = doc.phases.filter(needsCheckpoint).map(p => p.title);
        await this.replan(input, step, 'plan-finished');
        for (const title of unreviewed) markCheckpoint(this.doc!, title, step);
        continue;
      }
      // Under Rawstep's task control a task ends when its cue is heard after an action: the executor never has to say so.
      // Only what an action on this task made the reader say counts: a page title heard before it, or the cue of the task just
      // finished, is not this task's doing.
      const acted = input.history.length > this.taskFrom;
      if (this.control === 'rawstep' && acted && verifyCue(task, input.observation.speech) === 'heard') {
        this.evidence.push({ kind: 'orchestration-cue', taskId: task.id, planVersion: doc.version, verified: 'heard', source: 'rawstep' });
        await this.finishTask(input, step, doc, task, 'heard');
        continue;
      }
      // The cue was a guess written before the item was heard. An item that shares a name word with it is put to the planner, as a
      // person who hears "Order updates, checkbox" knows it is the order-updates setting they were looking for.
      if (this.control === 'rawstep' && acted && await this.recognized(input, doc, task)) {
        await this.finishTask(input, step, doc, task, 'recognized');
        continue;
      }
      // The executor only acts: whether the goal is reached is the planner's call (and the run's checks), never a stop it picks.
      // Under Rawstep's task control a task the plan marks as only moving offers no activation (plan doc §12: this removed the
      // executor's mistaken presses without costing the presses a pressing task needs).
      // The headings survey is the user's move before the first plan, not an executor choice.
      const actions = speechChoices(input.allowedActions, this.options, input.inputs).filter(c => 'action' in c.decision && !(c.decision.action.kind === 'intent' && c.decision.action.intent === 'headings.list'))
        .filter(c => !(this.control === 'rawstep' && task.activates === false && 'action' in c.decision && c.decision.action.kind === 'intent' && c.decision.action.intent === 'activate'));
      // The task's moves narrow the movement actions the same way: the plan's method is offered, the others are not. Activation is
      // governed by `activates` alone; keys and text entry are untouched. Moves that match nothing allowed leave the actions as they are.
      // A pressing task without moves presses the item the moving task ended on: moving off it first presses the wrong one.
      const latitude = this.options.executorLatitude ?? 'none';
      const pressOnly = this.control === 'rawstep' && latitude === 'none' && task.activates === true && !task.moves?.length;
      const moves = latitude === 'method' || !task.moves?.length ? undefined : latitude === 'direction' ? [...new Set(task.moves.flatMap(m => [m, opposite(m)]))] : task.moves;
      const narrowed = this.control === 'rawstep' && (moves || pressOnly)
        ? actions.filter(c => !('action' in c.decision) || c.decision.action.kind !== 'intent' || c.decision.action.intent === 'activate' || !!moves?.includes(c.decision.action.intent))
        : actions;
      if (narrowed.length && narrowed.length !== actions.length) actions.splice(0, actions.length, ...narrowed);
      const taskAttempts = modelHistory(input.history, input.observation, Number.MAX_SAFE_INTEGER).slice(this.taskFrom);
      const tried = taskAttempts.filter(h => 'action' in h.decision).length;
      // Help needs a few actions on the task since its plan: asking before acting throws away a plan nobody tested.
      // A task that already looks done is claimed done instead, and Rawstep checks the cue.
      const meta = this.control === 'executor';
      const candidates: ChoiceCandidate[] = [...actions.map(({ id, label }) => ({ id, label })),
        ...(!meta || refused === task.id ? [] : [{ id: TASK_DONE, label: `Current task done: ${task.done}` }]),
        // Right after a turned-down "done", "already done" is the same claim in other words.
        ...(meta && tried >= Math.min(TRIES_BEFORE_HELP, this.limits.stepActionLimit) ? (Object.keys(HELP) as HelpReason[]).filter(reason => !(reason === 'already-done' && refused === task.id)).map(reason => ({ id: `help:${reason}`, label: HELP[reason] })) : [])];
      if (this.executor === 'follow-plan') {
        const choiceId = followPlan(task, actions.map(c => c.id));
        if (!choiceId) return this.unmeasured(step, 'plan-finished');
        this.evidence.push({ kind: 'orchestration-follow', taskId: task.id, planVersion: doc.version, choices: candidates, choiceId,
          uncertainty: 'Rawstep carried out the plan as written; no model chose this action.' });
        task.actions++;
        this.served.set(step, { taskId: task.id, planVersion: doc.version });
        return structuredClone(actions.find(c => c.id === choiceId)!.decision);
      }
      // One candidate leaves nothing to decide: the plan already chose it, so no model is asked (and no call is spent).
      if (candidates.length === 1 && actions.some(c => c.id === candidates[0]!.id)) {
        this.evidence.push({ kind: 'orchestration-only-choice', taskId: task.id, planVersion: doc.version, choiceId: candidates[0]!.id,
          uncertainty: 'The task allowed one action; it was taken without asking the executor.' });
        task.actions++;
        this.served.set(step, { taskId: task.id, planVersion: doc.version });
        return structuredClone(actions.find(c => c.id === candidates[0]!.id)!.decision);
      }
      const tasks = planTasks(doc), next = tasks[tasks.findIndex(t => t.id === task.id) + 1];
      const started = performance.now();
      const response = await this.executor.choose({ state: {
        goal: input.goal, plan: planOutline(doc),
        currentTask: { goal: task.goal, done: task.done, ...(task.cue ? { cue: cueText(task) } : {}), actions: tried, actionLimit: this.limits.stepActionLimit,
          ...(task.rejected ? { claimsTurnedDown: task.rejected } : {}) }, ...(next ? { nextTask: next.goal } : {}),
        taskAttempts,
        speech: [...input.observation.speech], ...currentItemState(input), history: modelHistory(input.history, input.observation, this.limits.historyLimit),
      }, choices: candidates }, { signal: input.signal });
      input.signal.throwIfAborted();
      if (!candidates.some(c => c.id === response.choiceId)) throw new Error('The model selected an unknown choice.');
      this.evidence.push({ kind: 'model-inference', role: 'executor', model: response.model, ...(response.prompt ? { prompt: response.prompt } : {}), elapsedMs: performance.now() - started,
        observationSource: input.observation.provenance === 'simulation' ? 'simulated-speech-only' : 'screen-reader-output-only',
        taskId: task.id, planVersion: doc.version, stepGoal: task.goal, choices: candidates, choiceId: response.choiceId, ...(response.probabilities ? { probabilities: response.probabilities } : {}), ...(response.retried ? { retried: response.retried } : {}),
        noDomOrAxContext: true, uncertainty: 'Model probabilities are not measured accuracy or accessibility certification.' });
      if (response.choiceId === TASK_DONE) {
        const last = input.history.at(-1)?.observation;
        const heard = [...input.observation.speech, ...(last?.kind === 'screenreader' ? last.speech : [])];
        const verified = verifyCue(task, heard);
        if (verified === 'not-heard') {
          // The executor's "done" is a claim: without the cue it would end a task that is not done and mislead the planner.
          task.rejected++; refused = task.id;
          (this.evidence.at(-1) as Record<string, unknown>).accepted = false;
          this.evidence.push({ kind: 'orchestration-claim', taskId: task.id, planVersion: doc.version, verified, accepted: false, rejected: task.rejected });
          continue;
        }
        await this.finishTask(input, step, doc, task, verified);
        continue;
      }
      if (response.choiceId.startsWith('help:')) {
        const help = response.choiceId.slice(5) as HelpReason;
        if (this.outOfCalls()) return this.unmeasured(step, 'help');
        await this.replan(input, step, 'help', help); continue;
      }
      // A top probability close to a uniform guess is the executor not knowing what to do; a few in a row ask for a new plan.
      const confidence = confidenceOf(response.probabilities);
      this.lowConfidence = confidence !== undefined && confidence < this.confidenceFloor ? this.lowConfidence + 1 : 0;
      task.actions++;
      this.served.set(step, { taskId: task.id, planVersion: doc.version });
      return structuredClone(actions.find(c => c.id === response.choiceId)!.decision);
    }
    return this.unmeasured(step, 'plan-finished');
  }

  /** Ends the current task (its cue verified as given) and starts the next, reviewing a finished phase first. */
  private async finishTask(input: Input, step: number, doc: PlanDocument, task: PlanTask, verified: NonNullable<ReturnType<typeof verifyCue>>): Promise<void> {
    const phase = phaseOf(doc, task.id);
    const done = finishCurrent(doc, step, verified)!;
    this.taskEvent(done, 'active');
    // A finished phase is reviewed before the next one starts (with nothing left, the final review covers it).
    if (needsCheckpoint(phase) && currentTask(doc)) { await this.replan(input, step, 'checkpoint'); markCheckpoint(this.doc!, phase!.title, step); return; }
    this.startTask(input);
  }
  /** Asks the planner whether the item the cursor is on is what the task's cue describes (once per item and task). */
  private async recognized(input: Input, doc: PlanDocument, task: PlanTask): Promise<boolean> {
    // The latest line that shares cue words without matching it (role and state agreeing) and has not been asked about yet.
    const heard = input.observation.kind === 'screenreader'
      ? [...input.observation.speech].reverse().map(t => t.trim()).find(t => t && !this.asked.has(t) && matchCue(task, t) === 'candidate') : undefined;
    // Recognizing is a planner call too: with none left the item is not asked about, and the next plan decision ends the run.
    if (!this.planner.recognize || !heard || this.outOfCalls()) return false;
    this.asked.add(heard);
    const started = performance.now();
    this.plannerCalls++;
    const result = await this.planner.recognize({ goal: input.goal, ...(input.context ? { context: input.context } : {}), task: { goal: task.goal, done: task.done, cue: cueText(task) }, heard: heard.slice(0, 300) }, { signal: input.signal });
    input.signal.throwIfAborted();
    if (result.retried) { this.plannerCalls++; this.evidence.push({ kind: 'model-retry', role: 'planner', taskId: task.id, failure: result.retried }); }
    this.evidence.push({ kind: 'orchestration-cue', taskId: task.id, planVersion: doc.version, verified: result.matches ? 'recognized' : 'not-recognized', source: 'planner',
      cue: cueText(task), heard, ...(result.reason ? { reason: result.reason } : {}), model: result.model, elapsedMs: performance.now() - started });
    return result.matches;
  }
  /** What went wrong on the current task, if anything warrants a new plan. */
  private trigger(input: Input): PlanTrigger | undefined {
    const task = this.doc && currentTask(this.doc);
    if (!task) return undefined;
    if (this.control === 'rawstep' && this.lowConfidence >= this.limits.lowConfidenceSteps) return 'low-confidence';
    const since = modelHistory(input.history, input.observation, Number.MAX_SAFE_INTEGER).slice(this.taskFrom).filter(h => 'action' in h.decision);
    const last = (n: number) => since.length >= n ? since.slice(-n) : undefined;
    if (last(this.limits.failureLimit)?.every(h => h.execution?.ok === false)) return 'failures';
    if (last(this.limits.noChangeLimit)?.every(h => h.changed === false)) return 'no-change';
    // Where each action left the cursor: two items taking turns means the executor is swinging between them.
    const spoken = input.history.slice(this.taskFrom).filter(h => 'action' in h.decision).map((h, i, all) => currentItem(i + 1 < all.length ? all[i + 1]!.observation : input.observation, []));
    const recent = spoken.slice(-this.limits.oscillationLimit);
    if (recent.length === this.limits.oscillationLimit && recent[0] && recent[1] && recent[0] !== recent[1] && recent.every((item, i) => item === recent[i % 2])) return 'oscillation';
    // The user heard something named as in the goal while the task was after something else: they notice it, so the plan is
    // revisited from there, once per item. A task that is after it ends on its cue (or is recognized) instead. Only the first
    // time in the run: walking back past an item already heard (the product just added, on the way to the cart) is not news.
    const item = currentItem(input.observation, []);
    const heardBefore = (text: string) => input.history.some(h => currentItem(h.observation, []) === text);
    if (since.length && item && !this.noticed.has(item) && goalNamed(input.goal, item) && matchCue(task, item) === 'no' && !heardBefore(item)) { this.noticed.add(item); return 'goal-heard'; }
    // Counted since the task (re)started, so a task the planner keeps after the limit gets a fresh budget instead of tripping it again.
    // A task that keeps hearing new items is making its way (walking a long page item by item), not stuck: only actions since the
    // last newly heard item count.
    const heard = new Set<string>();
    let sinceNew = 0;
    for (const item of spoken) { if (item && !heard.has(item)) { heard.add(item); sinceNew = 0; } else sinceNew++; }
    if (sinceNew >= this.limits.stepActionLimit) return 'task-limit';
    // However well a walk goes, after this many moves the user takes stock: keep going, change the approach or give up.
    if (input.history.length - this.planFrom >= this.limits.reviewEvery) return 'effort-review';
    return undefined;
  }
  /** The effort so far, from what each action left the cursor on. */
  private effort(input: Input): Effort {
    const actions = input.history.filter(h => 'action' in h.decision);
    const items = input.history.flatMap((h, i) => 'action' in h.decision ? [currentItem(input.history[i + 1]?.observation ?? input.observation, [])] : []);
    const stretch = goalWordStretch(input.goal, items);
    return { moves: actions.length, sinceLastLook: input.history.slice(this.planFrom).filter(h => 'action' in h.decision).length, withoutGoalWords: stretch.current, longestWithoutGoalWords: stretch.longest };
  }
  private outOfCalls(): boolean { return this.plannerCalls >= this.limits.maxPlannerCalls; }
  private attempts(history: readonly HistoryEntry[], input: Input): TaskAttempt[] {
    const entries = modelHistory(history, input.observation, Number.MAX_SAFE_INTEGER);
    return entries.flatMap(entry => { const served = this.served.get(entry.step); return served ? [{ ...entry, ...served }] : []; }).slice(-this.limits.plannerHistoryLimit);
  }
  private async replan(input: Input, step: number, trigger: PlanTrigger, help?: HelpReason, refusedGiveUp?: string): Promise<void> {
    if (input.observation.kind !== 'screenreader') return;
    const actions = speechChoices(input.allowedActions, this.options, input.inputs).filter(c => 'action' in c.decision).map(({ id, label }) => ({ id, label }));
    const started = performance.now();
    this.plannerCalls++;
    const { draft, model, prompt, retried } = await this.planner.plan({ goal: input.goal, ...(input.context ? { context: input.context } : {}), ...currentItemState(input), trigger, ...(help ? { help } : {}), speech: [...input.observation.speech], ...(input.observation.title ? { title: input.observation.title } : {}), actions,
      ...(this.doc ? { document: structuredClone(this.doc) } : {}), attempts: this.attempts(input.history, input), effort: this.effort(input), ...(refusedGiveUp ? { refusedGiveUp } : {}) }, { signal: input.signal });
    input.signal.throwIfAborted();
    // Asking again for an unusable reply is another planner call.
    if (retried) { this.plannerCalls++; this.evidence.push({ kind: 'model-retry', role: 'planner', step, failure: retried }); }
    if (!draft.complete && !draft.giveUp && !draft.phases.some(p => p.tasks.length)) throw new Error('The planner returned no tasks for an unfinished goal.');
    const before = this.doc && new Map(planTasks(this.doc).map(t => [t.id, t.status]));
    this.doc = applyDraft(this.doc, draft, { goal: input.goal, step, trigger, ...(help ? { help } : {}) });
    this.planFrom = input.history.length;
    // What the planner just read is known to it: hearing it again is not news.
    for (const line of [...input.observation.speech, currentItem(input.observation, [])]) if (line?.trim()) this.noticed.add(line.trim());
    this.evidence.push({ kind: 'orchestration-plan', role: 'planner', trigger, ...(help ? { help } : {}), version: this.doc.version, plannerCalls: this.plannerCalls,
      revision: structuredClone(this.doc.revisions.at(-1)), document: structuredClone(this.doc), model, ...(prompt ? { prompt } : {}), elapsedMs: performance.now() - started,
      uncertainty: 'The plan comes from common UI conventions and what was heard; it is an expectation, not a fact about this page.' });
    for (const task of this.doc.retired) if (before?.get(task.id) && before.get(task.id) !== task.status) this.taskEvent(task, before.get(task.id)!);
    if (draft.giveUp && !draft.complete) {
      // Giving up has to rest on approaches that were tried and failed: the assumptions it names must be broken. A long walk alone, or
      // a hunch, is not enough; the refusal is kept as a sign the user wanted to stop here.
      const broken = new Set(this.doc.assumptions.filter(a => a.status === 'broken').map(a => a.id));
      const refused = !draft.giveUp.tried.length ? 'it names no approach that was tried and failed'
        : draft.giveUp.tried.some(id => !broken.has(id)) ? `it names assumptions that are not broken (${draft.giveUp.tried.filter(id => !broken.has(id)).join(', ')})` : undefined;
      this.evidence.push({ kind: 'orchestration-give-up', step, version: this.doc.version, reason: draft.giveUp.reason, tried: [...draft.giveUp.tried], accepted: !refused, ...(refused ? { refused } : {}), effort: this.effort(input) });
      if (!refused) { this.gaveUp = structuredClone(draft.giveUp); return; }
      if (!currentTask(this.doc) && !this.outOfCalls()) return this.replan(input, step, trigger, help, refused);
    }
    this.startTask(input);
  }
  /** The current task (if any) starts now: its attempts count from here. */
  private startTask(input: Input): void {
    this.taskFrom = input.history.length;
    this.lowConfidence = 0;
    this.asked.clear();
    const task = this.doc && currentTask(this.doc);
    if (task && task.actions === 0) this.evidence.push({ kind: 'orchestration-task', taskId: task.id, planVersion: this.doc!.version, fromStatus: 'pending', toStatus: 'active', actions: 0 });
  }
  private taskEvent(task: PlanTask, from: string): void {
    this.evidence.push({ kind: 'orchestration-task', taskId: task.id, planVersion: this.doc!.version, fromStatus: from, toStatus: task.status, actions: task.actions, ...(task.ending ? { ending: structuredClone(task.ending) } : {}) });
  }
  /** The user gave up (an accepted `giveUp`): the task they were on fails, and the run ends as theirs to have ended. */
  private userGaveUp(step: number): Decision {
    const task = this.doc && currentTask(this.doc);
    if (this.doc && task) { failCurrent(this.doc, step); this.taskEvent(task, 'active'); }
    return { stop: 'stuck', stopSource: 'user-gave-up' };
  }
  /** A cost limit, not the user, ends the run: whether the task can be done is not known. */
  private unmeasured(step: number, reason: PlanTrigger): Decision {
    const task = this.doc && currentTask(this.doc);
    if (this.doc && task) { failCurrent(this.doc, step); this.taskEvent(task, 'active'); }
    this.evidence.push({ kind: 'orchestration-limit', reason, plannerCalls: this.plannerCalls, maxPlannerCalls: this.limits.maxPlannerCalls, ...(this.doc ? { document: structuredClone(this.doc) } : {}),
      uncertainty: 'The run reached a cost limit before the user reached the goal or gave up; whether the task can be done is not known.' });
    return { stop: 'uncertain', stopSource: 'orchestration-limit' };
  }
}
