import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { Decision, DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';
import type { ChoiceCandidate, ModelFailure } from './choice.js';
import { modelHistory, type ModelHistoryEntry } from './history.js';
import { applyDraft, cueText, currentTask, failCurrent, finishCurrent, goalLeads, goalNamed, markCheckpoint, needsCheckpoint, phaseOf, matchCue, planTasks, verifyCue,
  type GiveUp, type PlanDocument, type PlanDraft, type PlanTask, type PlanTrigger } from './plan-document.js';
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
  /** What the screen reader says now. */
  speech: string[];
  /** The page title, as a screen reader announces it on load (absent when unknown). */
  title?: string;
  /** What the user can do: the actions the profile allows and its named inputs (secret values never included). */
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
/** Drafts and revises the plan document. Called a few times per run, so it can be a slow model. */
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
   * Actions in a row on one task that only swing between the same two items (A, B, A, B, …) before a new plan is requested
   * (default 4). The plan is stuck between them; waiting for the task limit only adds detours.
   */
  oscillationLimit?: number;
  /**
   * What the simulated user does before the first plan. `headings`: list the page's headings (a VoiceOver user's rotor, VO+U) with
   * the `headings.list` intent; it is an action like any other and counts as a step. The planner then plans from what that list said.
   */
  survey?: 'none' | 'headings';
};
const DEFAULTS = { ...RAWSTEP_DEFAULTS.orchestration, failureLimit: 2, noChangeLimit: 3, oscillationLimit: 4 };
/** Task changes in one runner step at most: finishing tasks or replanning never loops without an action. */
const MAX_CALLS_PER_STEP = 8;
/** Moves that open a list once, in which next and previous then move: opening it again would start the list over. */
const LIST_OPENERS = new Set(['formControls.rotor']);
/** The choice ID an action has among the offered ones (`intent:next`, `type:query`…). */
const choiceIdOf = (decision: Decision): string | undefined => !('action' in decision) ? undefined
  : decision.action.kind === 'intent' ? `intent:${decision.action.intent}` : decision.action.kind === 'key' ? `key:${decision.action.key}`
  : decision.action.kind === 'typeText' ? `type:${decision.action.input}` : decision.action.kind === 'replaceText' ? `replace:${decision.action.input}` : undefined;
/**
 * The action a plan prescribes for its task, among the offered ones: a typing task presses the field the cursor is on (giving it
 * focus), then types its input; a pressing task presses; a moving task takes its first move; a task that names none of those moves
 * to the next item. A list the task already opened is not opened again. `taken` are the choice IDs of the task's actions so far.
 * Undefined when none of those is offered.
 */
export function followPlan(task: Pick<PlanTask, 'activates' | 'moves' | 'types'>, offered: readonly string[], taken: readonly string[] = []): string | undefined {
  const typing = task.types ? [`type:${task.types}`, `replace:${task.types}`] : [];
  const wanted = task.types ? (taken.includes('intent:activate') ? typing : ['intent:activate', ...typing])
    : task.activates === true ? ['intent:activate']
    : [...(task.moves ?? []).filter(move => !(LIST_OPENERS.has(move) && taken.includes(`intent:${move}`))), 'next'].map(intent => `intent:${intent}`);
  return wanted.find(id => offered.includes(id));
}
/** Whether the task's input was typed by one of its actions that ran. */
const typedIn = (task: Pick<PlanTask, 'types'>, attempts: readonly { decision: Decision; execution?: { ok: boolean } }[]) =>
  !!task.types && attempts.some(h => h.execution?.ok === true && [`type:${task.types}`, `replace:${task.types}`].includes(choiceIdOf(h.decision) ?? ''));
type Input = Parameters<DecisionPolicy['decide']>[0];

/**
 * Screen reader decisions from a plan document (plan-document.ts). The planner (an LLM or a plan file, called rarely) drafts and
 * revises phases of tasks; Rawstep owns the document — task statuses, the current task, versions and history — carries out each task
 * as written and links every action to its task. A task ends when its cue is heard; Rawstep asks for a new plan when a task's
 * actions keep failing, change nothing or run long. Every judgement is the planner's and the cue's, and a run costs only planner
 * calls. Every plan, task change and model call is policy evidence.
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
  private surveyed = false;
  /** Spoken items already put to the planner for the current task: one question per item. */
  private asked = new Set<string>();
  /** Items named as in the goal that the planner was already told about. */
  private readonly noticed = new Set<string>();
  constructor(readonly planner: Planner, private readonly options: OrchestrationOptions = {}) {
    this.limits = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([key, v]) => key in DEFAULTS && v !== undefined)) } as typeof DEFAULTS;
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error(`Invalid orchestration limit ${key}.`);
    }
  }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  /** The plan document as it stands, for callers that save it (a copy). */
  planDocument(): PlanDocument | undefined { return this.doc && structuredClone(this.doc); }

  async decide(input: Input): Promise<Decision> {
    this.evidence = []; input.signal.throwIfAborted();
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
      const attempts = modelHistory(input.history, input.observation, Number.MAX_SAFE_INTEGER).slice(this.taskFrom);
      // A typing task is done once its input is typed: pressing the field already says the field's name, which is not the typing.
      if (task.types) {
        if (typedIn(task, attempts)) { await this.finishTask(input, step, doc, task, verifyCue(task, input.observation.speech)); continue; }
      } else if (attempts.length) {
        // A task ends when its cue is heard after an action. Only what an action on this task made the reader say counts: a page
        // title heard before it, or the cue of the task just finished, is not this task's doing.
        if (verifyCue(task, input.observation.speech) === 'heard') {
          this.evidence.push({ kind: 'orchestration-cue', taskId: task.id, planVersion: doc.version, verified: 'heard', source: 'rawstep' });
          await this.finishTask(input, step, doc, task, 'heard');
          continue;
        }
        // The cue was a guess written before the item was heard. An item that shares a name word with it is put to the planner, as a
        // person who hears "Order updates, checkbox" knows it is the order-updates setting they were looking for.
        if (await this.recognized(input, doc, task)) { await this.finishTask(input, step, doc, task, 'recognized'); continue; }
      }
      // Rawstep carries out the task as written. The headings survey is the user's move before the first plan, never a task's.
      const actions = speechChoices(input.allowedActions, input.inputs).filter(c => !(c.decision.action.kind === 'intent' && c.decision.action.intent === 'headings.list'));
      const choiceId = followPlan(task, actions.map(c => c.id), attempts.flatMap(h => choiceIdOf(h.decision) ?? []));
      if (!choiceId) return this.unmeasured(step, 'plan-finished');
      this.evidence.push({ kind: 'orchestration-follow', taskId: task.id, planVersion: doc.version, choices: actions.map(({ id, label }) => ({ id, label })), choiceId,
        uncertainty: 'Rawstep carried out the plan as written; no model chose this action.' });
      task.actions++;
      this.served.set(step, { taskId: task.id, planVersion: doc.version });
      return structuredClone(actions.find(c => c.id === choiceId)!.decision);
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
    const heard = [...input.observation.speech].reverse().map(t => t.trim()).find(t => t && !this.asked.has(t) && matchCue(task, t) === 'candidate');
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
    const since = modelHistory(input.history, input.observation, Number.MAX_SAFE_INTEGER).slice(this.taskFrom).filter(h => 'action' in h.decision);
    const last = (n: number) => since.length >= n ? since.slice(-n) : undefined;
    if (last(this.limits.failureLimit)?.every(h => h.execution?.ok === false)) return 'failures';
    if (last(this.limits.noChangeLimit)?.every(h => h.changed === false)) return 'no-change';
    // Where each action left the cursor: two items taking turns means the plan is swinging between them.
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
  private async replan(input: Input, step: number, trigger: PlanTrigger, refusedGiveUp?: string): Promise<void> {
    const actions = speechChoices(input.allowedActions, input.inputs).map(({ id, label }) => ({ id, label }));
    const started = performance.now();
    this.plannerCalls++;
    const { draft, model, prompt, retried } = await this.planner.plan({ goal: input.goal, ...(input.context ? { context: input.context } : {}), ...currentItemState(input), trigger, speech: [...input.observation.speech], ...(input.observation.title ? { title: input.observation.title } : {}), actions,
      ...(this.doc ? { document: structuredClone(this.doc) } : {}), attempts: this.attempts(input.history, input), effort: this.effort(input), ...(refusedGiveUp ? { refusedGiveUp } : {}) }, { signal: input.signal });
    input.signal.throwIfAborted();
    // Asking again for an unusable reply is another planner call.
    if (retried) { this.plannerCalls++; this.evidence.push({ kind: 'model-retry', role: 'planner', step, failure: retried }); }
    if (!draft.complete && !draft.giveUp && !draft.phases.some(p => p.tasks.length)) throw new Error('The planner returned no tasks for an unfinished goal.');
    const before = this.doc && new Map(planTasks(this.doc).map(t => [t.id, t.status]));
    this.doc = applyDraft(this.doc, draft, { goal: input.goal, step, trigger });
    this.planFrom = input.history.length;
    // What the planner just read is known to it: hearing it again is not news.
    for (const line of [...input.observation.speech, currentItem(input.observation, [])]) if (line?.trim()) this.noticed.add(line.trim());
    this.evidence.push({ kind: 'orchestration-plan', role: 'planner', trigger, version: this.doc.version, plannerCalls: this.plannerCalls,
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
      if (!currentTask(this.doc) && !this.outOfCalls()) return this.replan(input, step, trigger, refused);
    }
    this.startTask(input);
  }
  /** The current task (if any) starts now: its attempts count from here. */
  private startTask(input: Input): void {
    this.taskFrom = input.history.length;
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
