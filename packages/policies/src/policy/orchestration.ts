import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { Decision, DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';
import type { ChoiceCandidate, ChoiceModel } from './choice.js';
import { modelHistory, type ModelHistoryEntry } from './history.js';
import { applyDraft, currentTask, failCurrent, finishCurrent, markCheckpoint, needsCheckpoint, phaseOf, planOutline, planTasks, verifyCue,
  type HelpReason, type PlanDocument, type PlanDraft, type PlanTask, type PlanTrigger } from './plan-document.js';
import { currentItemState, speechChoices, speechGuardStop, type SpeechPolicyOptions } from './speech.js';

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
};
/** `prompt` fingerprints the planner's full instructions, so runs with different planner instructions stay apart. */
export type PlanResult = { draft: PlanDraft; model: { id: string; runtime: string }; prompt?: { id: string; version: string; sha256: string } };
/** Drafts and revises the plan document. Called a few times per run, so it can be a slower model than the executor. */
export interface Planner {
  plan(request: PlanRequest, options: { signal: AbortSignal }): Promise<PlanResult>;
}

export type OrchestrationOptions = SpeechPolicyOptions & {
  /** New plans after the first before the run stops (default 4). */
  maxReplans?: number;
  /** Actions on one task before a new plan is requested (default 12). */
  stepActionLimit?: number;
  /** Failed actions in a row on one task before a new plan is requested (default 2). */
  failureLimit?: number;
  /** Actions in a row on one task that changed nothing before a new plan is requested (default 3). */
  noChangeLimit?: number;
  /** Past actions the planner sees (default 60). */
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
   * What the simulated user does before the first plan. `headings`: list the page's headings (a VoiceOver user's rotor, VO+U) with
   * the `headings.list` intent; it is an action like any other and counts as a step. The planner then plans from what that list said.
   */
  survey?: 'none' | 'headings';
};
const DEFAULTS = { ...RAWSTEP_DEFAULTS.orchestration, failureLimit: 2, noChangeLimit: 3, plannerHistoryLimit: 60, historyLimit: RAWSTEP_DEFAULTS.policy.historyLimit, lowConfidenceSteps: 2 };
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
  private replans = 0;
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
  constructor(readonly planner: Planner, readonly executor: ChoiceModel, private readonly options: OrchestrationOptions = {}) {
    if (!executor.inputs.includes('text')) throw new Error('The executor needs a model that takes text.');
    this.limits = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([key, v]) => key in DEFAULTS && v !== undefined)) } as typeof DEFAULTS;
    this.control = options.taskControl ?? 'rawstep';
    this.confidenceFloor = options.confidenceFloor ?? 0.25;
    if (!(this.confidenceFloor >= 0 && this.confidenceFloor <= 1)) throw new Error('Invalid orchestration confidence floor.');
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < (key === 'maxReplans' ? 0 : 1) || value > 10_000) throw new Error(`Invalid orchestration limit ${key}.`);
    }
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  /** The plan document as it stands, for callers that save it (a copy). */
  planDocument(): PlanDocument | undefined { return this.doc && structuredClone(this.doc); }

  async decide(input: Input): Promise<Decision> {
    this.evidence = []; input.signal.throwIfAborted();
    if (input.observation.kind !== 'screenreader') throw new Error('The orchestrated speech policy requires screen reader observations.');
    const guarded = speechGuardStop(this.options, { ...input, history: input.history.slice(this.planFrom) });
    if (guarded) { this.evidence.push(guarded.evidence); return guarded.decision; }
    const step = (input.history.at(-1)?.step ?? 0) + 1;
    // A survey before the first plan is the user's own move, so it is taken as an action and the plan is written on what it said.
    if (!this.doc && this.options.survey === 'headings' && !this.surveyed && input.allowedActions.intents.includes('headings.list')) {
      this.surveyed = true;
      this.evidence.push({ kind: 'orchestration-survey', survey: 'headings', step });
      return { action: { kind: 'intent', intent: 'headings.list' } };
    }
    if (!this.doc) await this.replan(input, step, 'start');
    else {
      const trigger = this.trigger(input);
      if (trigger) { if (this.replans >= this.limits.maxReplans) return this.giveUp(step, trigger); await this.replan(input, step, trigger); }
    }
    // A "done" claim turned down in this step is not offered again until an action has been taken.
    let refused: string | undefined;
    for (let call = 0; call < MAX_CALLS_PER_STEP; call++) {
      const doc = this.doc!;
      if (doc.complete) return { stop: 'success', stopSource: 'planner' };
      const task = currentTask(doc);
      if (!task) {
        if (this.replans >= this.limits.maxReplans) return this.giveUp(step, 'plan-finished');
        const unreviewed = doc.phases.filter(needsCheckpoint).map(p => p.title);
        await this.replan(input, step, 'plan-finished');
        for (const title of unreviewed) markCheckpoint(this.doc!, title, step);
        continue;
      }
      // Under Rawstep's task control a task ends when its cue is heard after an action: the executor never has to say so.
      if (this.control === 'rawstep' && verifyCue(task, input.observation.speech) === 'heard') {
        this.evidence.push({ kind: 'orchestration-cue', taskId: task.id, planVersion: doc.version, verified: 'heard', source: 'rawstep' });
        await this.finishTask(input, step, doc, task, 'heard');
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
      const narrowed = this.control === 'rawstep' && task.moves?.length
        ? actions.filter(c => !('action' in c.decision) || c.decision.action.kind !== 'intent' || c.decision.action.intent === 'activate' || task.moves!.includes(c.decision.action.intent))
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
      const tasks = planTasks(doc), next = tasks[tasks.findIndex(t => t.id === task.id) + 1];
      const started = performance.now();
      const response = await this.executor.choose({ state: {
        goal: input.goal, plan: planOutline(doc),
        currentTask: { goal: task.goal, done: task.done, ...(task.cue ? { cue: task.cue } : {}), actions: tried, actionLimit: this.limits.stepActionLimit,
          ...(task.rejected ? { claimsTurnedDown: task.rejected } : {}) }, ...(next ? { nextTask: next.goal } : {}),
        taskAttempts,
        speech: [...input.observation.speech], ...currentItemState(input), history: modelHistory(input.history, input.observation, this.limits.historyLimit),
      }, choices: candidates }, { signal: input.signal });
      input.signal.throwIfAborted();
      if (!candidates.some(c => c.id === response.choiceId)) throw new Error('The model selected an unknown choice.');
      this.evidence.push({ kind: 'model-inference', role: 'executor', model: response.model, ...(response.prompt ? { prompt: response.prompt } : {}), elapsedMs: performance.now() - started,
        observationSource: input.observation.provenance === 'simulation' ? 'simulated-speech-only' : 'screen-reader-output-only',
        taskId: task.id, planVersion: doc.version, stepGoal: task.goal, choices: candidates, choiceId: response.choiceId, ...(response.probabilities ? { probabilities: response.probabilities } : {}),
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
        if (this.replans >= this.limits.maxReplans) return this.giveUp(step, 'help');
        await this.replan(input, step, 'help', help); continue;
      }
      // A top probability close to a uniform guess is the executor not knowing what to do; a few in a row ask for a new plan.
      const confidence = confidenceOf(response.probabilities);
      this.lowConfidence = confidence !== undefined && confidence < this.confidenceFloor ? this.lowConfidence + 1 : 0;
      task.actions++;
      this.served.set(step, { taskId: task.id, planVersion: doc.version });
      return structuredClone(actions.find(c => c.id === response.choiceId)!.decision);
    }
    return this.giveUp(step, 'plan-finished');
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
  /** What went wrong on the current task, if anything warrants a new plan. */
  private trigger(input: Input): PlanTrigger | undefined {
    const task = this.doc && currentTask(this.doc);
    if (!task) return undefined;
    if (this.control === 'rawstep' && this.lowConfidence >= this.limits.lowConfidenceSteps) return 'low-confidence';
    const since = modelHistory(input.history, input.observation, Number.MAX_SAFE_INTEGER).slice(this.taskFrom).filter(h => 'action' in h.decision);
    const last = (n: number) => since.length >= n ? since.slice(-n) : undefined;
    if (last(this.limits.failureLimit)?.every(h => h.execution?.ok === false)) return 'failures';
    if (last(this.limits.noChangeLimit)?.every(h => h.changed === false)) return 'no-change';
    // Counted since the task (re)started, so a task the planner keeps after the limit gets a fresh budget instead of tripping it again.
    if (since.length >= this.limits.stepActionLimit) return 'task-limit';
    return undefined;
  }
  private attempts(history: readonly HistoryEntry[], input: Input): TaskAttempt[] {
    const entries = modelHistory(history, input.observation, Number.MAX_SAFE_INTEGER);
    return entries.flatMap(entry => { const served = this.served.get(entry.step); return served ? [{ ...entry, ...served }] : []; }).slice(-this.limits.plannerHistoryLimit);
  }
  private async replan(input: Input, step: number, trigger: PlanTrigger, help?: HelpReason): Promise<void> {
    if (input.observation.kind !== 'screenreader') return;
    const actions = speechChoices(input.allowedActions, this.options, input.inputs).filter(c => 'action' in c.decision).map(({ id, label }) => ({ id, label }));
    const started = performance.now();
    const { draft, model, prompt } = await this.planner.plan({ goal: input.goal, ...(input.context ? { context: input.context } : {}), ...currentItemState(input), trigger, ...(help ? { help } : {}), speech: [...input.observation.speech], ...(input.observation.title ? { title: input.observation.title } : {}), actions,
      ...(this.doc ? { document: structuredClone(this.doc) } : {}), attempts: this.attempts(input.history, input) }, { signal: input.signal });
    input.signal.throwIfAborted();
    if (!draft.complete && !draft.phases.some(p => p.tasks.length)) throw new Error('The planner returned no tasks for an unfinished goal.');
    const before = this.doc && new Map(planTasks(this.doc).map(t => [t.id, t.status]));
    // A checkpoint is the plan working as intended; only corrections and running out of tasks count toward maxReplans.
    if (trigger !== 'start' && trigger !== 'checkpoint') this.replans++;
    this.doc = applyDraft(this.doc, draft, { goal: input.goal, step, trigger, ...(help ? { help } : {}) });
    this.planFrom = input.history.length;
    this.evidence.push({ kind: 'orchestration-plan', role: 'planner', trigger, ...(help ? { help } : {}), version: this.doc.version, replans: this.replans,
      revision: structuredClone(this.doc.revisions.at(-1)), document: structuredClone(this.doc), model, ...(prompt ? { prompt } : {}), elapsedMs: performance.now() - started,
      uncertainty: 'The plan comes from common UI conventions and what was heard; it is an expectation, not a fact about this page.' });
    for (const task of this.doc.retired) if (before?.get(task.id) && before.get(task.id) !== task.status) this.taskEvent(task, before.get(task.id)!);
    this.startTask(input);
  }
  /** The current task (if any) starts now: its attempts count from here. */
  private startTask(input: Input): void {
    this.taskFrom = input.history.length;
    this.lowConfidence = 0;
    const task = this.doc && currentTask(this.doc);
    if (task && task.actions === 0) this.evidence.push({ kind: 'orchestration-task', taskId: task.id, planVersion: this.doc!.version, fromStatus: 'pending', toStatus: 'active', actions: 0 });
  }
  private taskEvent(task: PlanTask, from: string): void {
    this.evidence.push({ kind: 'orchestration-task', taskId: task.id, planVersion: this.doc!.version, fromStatus: from, toStatus: task.status, actions: task.actions, ...(task.ending ? { ending: structuredClone(task.ending) } : {}) });
  }
  private giveUp(step: number, reason: PlanTrigger): Decision {
    const task = this.doc && currentTask(this.doc);
    if (this.doc && task) { failCurrent(this.doc, step); this.taskEvent(task, 'active'); }
    this.evidence.push({ kind: 'orchestration-limit', reason, replans: this.replans, maxReplans: this.limits.maxReplans, ...(this.doc ? { document: structuredClone(this.doc) } : {}),
      uncertainty: 'The planner and executor could not make progress within the limits; this ends exploration, it does not establish an accessibility defect.' });
    return { stop: 'stuck', stopSource: 'orchestration-limit' };
  }
}
