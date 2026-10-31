import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDraft, FixedPlanner, OrchestratedSpeechPolicy, planFileSchema, planTasks, renderPlanMarkdown, type PlanDraft, type PlanRequest } from '@rawstep/policies/policy';
import type { DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';
import { loadPlanFile } from '@rawstep/project/plan';
import { planFileOf, plannerSchema } from '@rawstep/project/config';
import { ProjectStore } from '@rawstep/project/store';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const said = (...speech: string[]) => ({ kind: 'screenreader' as const, provenance: 'simulation' as const, speech, outputEventIds: [], window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'fixture' } });
const input = (over: Partial<Parameters<DecisionPolicy['decide']>[0]> = {}): Parameters<DecisionPolicy['decide']>[0] => ({
  goal: 'Add the phone to the cart', observation: said('Demo phone X1, heading level 2'), history: [],
  allowedActions: { intents: ['next', 'activate'], keys: [], inputKeys: [], replaceText: false }, inputs: {}, signal: new AbortController().signal, ...over,
});
const acted = (step: number, speech: string): HistoryEntry => ({ step, decision: { action: { kind: 'intent', intent: 'next' } }, observation: said(speech), execution: { ok: true } });
/** A plan file as a person writes it: no `complete`, no `rationale`. */
const written = { strategy: 'Move down to the button and press it', criteria: [{ id: 'C1', text: 'The cart confirms the phone' }], assumptions: [],
  phases: [{ title: 'Buy', tasks: [{ goal: "Move to the 'Add to cart' button", done: "Hear 'Add to cart'", cue: 'Add to cart' }, { goal: 'Press it', done: 'Hear the confirmation', cue: 'Product added' }] }] };
describe('plan files', () => {
  it('reads a person\'s plan without complete or rationale, and fills {task} from the task file name', () => {
    expect(planFileSchema.parse(written)).toMatchObject({ complete: false, rationale: '' });
    const planner = plannerSchema.parse({ planFile: 'plans/{task}/L2.json' });
    expect(planFileOf(planner as { planFile: string }, { file: 'tasks/shop-cart.json' })).toBe('plans/shop-cart/L2.json');
    expect(plannerSchema.safeParse({ planFile: 'plans/a.txt' }).success).toBe(false);
  });
  it('reads a run\'s saved plan.json as the plan it holds: phases and tasks, without ids, statuses or history', () => {
    const doc = applyDraft(undefined, { ...planFileSchema.parse(written), complete: false, rationale: '' } as PlanDraft, { goal: 'g', step: 1, trigger: 'start' });
    doc.phases[0]!.tasks[0]!.status = 'done';
    const again = planFileSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(again).toEqual(planFileSchema.parse({ ...written, phases: written.phases.map(p => ({ ...p, criteria: [], tasks: p.tasks.map(t => ({ ...t, cue: { name: t.cue }, serves: [], relies: [] })) })) }));
  });
  it('loads a plan file inside the project with its fingerprint, and refuses one that is missing, outside or not a plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-plan-')); dirs.push(dir);
    await mkdir(join(dir, 'plans')); await writeFile(join(dir, 'plans/a.json'), JSON.stringify(written));
    await writeFile(join(dir, 'plans/empty.json'), JSON.stringify({ ...written, phases: [{ title: 'Buy', tasks: [] }] }));
    const store = new ProjectStore(dir);
    const loaded = await loadPlanFile(store, 'plans/a.json');
    expect(loaded).toMatchObject({ file: 'plans/a.json', draft: { phases: [{ tasks: [{ cue: 'Add to cart' }, { cue: 'Product added' }] }] } });
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const path of ['plans/missing.json', 'plans/empty.json', '../outside.json']) await expect(loadPlanFile(store, path)).rejects.toMatchObject({ code: 'plan-file-invalid' });
  });
});

describe('a fixed plan in the orchestrated policy', () => {
  const fixed = () => new FixedPlanner(planFileSchema.parse(written) as PlanDraft, { file: 'plans/a.json', sha256: 'f'.repeat(64) });
  it('runs the written tasks in order, records the plan file as the planner, and moves on when a cue is heard', async () => {
    const policy = new OrchestratedSpeechPolicy(fixed());
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ goal: "Move to the 'Add to cart' button", status: 'active', actions: 1 });
    const plan = (policy.takeDecisionEvidence() as { kind: string; [k: string]: unknown }[]).find(k => k.kind === 'orchestration-plan');
    expect(plan).toMatchObject({ model: { id: 'plans/a.json', runtime: 'fixed-plan' }, prompt: { id: 'rawstep-fixed-plan' } });
    // The written task does not say how to move or press, so Rawstep moves on to the next item until the cue is heard, then presses.
    expect(await policy.decide(input({ observation: said('Add to cart, button'), history: [acted(1, 'Add to cart, button')] }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(policy.planDocument()!.phases[0]!.tasks.map(t => t.status)).toEqual(['done', 'active']);
    expect(renderPlanMarkdown(policy.planDocument()!)).toContain('Press it');
  });
  it('keeps every task when nothing is stuck: a goal item heard on the way or taking stock of the effort', async () => {
    const request: PlanRequest = { goal: 'g', trigger: 'start', speech: [], actions: [], attempts: [], effort: { moves: 0, sinceLastLook: 0, withoutGoalWords: 0, longestWithoutGoalWords: 0 } };
    const planner = fixed(), first = await planner.plan(request);
    const doc = applyDraft(undefined, first.draft, { goal: 'g', step: 1, trigger: 'start' });
    for (const trigger of ['goal-heard', 'effort-review'] as const) {
      const again = await planner.plan({ ...request, trigger, document: doc });
      expect(again.draft.phases.flatMap(p => p.tasks.map(t => t.keep))).toEqual(planTasks(doc).map(t => t.id));
      expect(again.draft.rationale).toBe('Fixed plan: unchanged.');
    }
  });
  it('abandons a stuck task instead of rewriting the plan, and gives up when no task is left', async () => {
    const policy = new OrchestratedSpeechPolicy(fixed(), { noChangeLimit: 2, maxPlannerCalls: 5 });
    let history: HistoryEntry[] = [], last: readonly unknown[] = [];
    // Speech never changes and no cue is heard, so each task runs into the no-change signal.
    for (let step = 1; step <= 8; step++) {
      const decision = await policy.decide(input({ observation: said('Same item'), history }));
      last = policy.takeDecisionEvidence();
      if ('stop' in decision) { expect(decision).toMatchObject({ stop: 'stuck', stopSource: 'user-gave-up' }); break; }
      history = [...history, { ...acted(step, 'Same item'), changed: false } as HistoryEntry];
    }
    const doc = policy.planDocument()!;
    // A plan file claims nothing: it ran out, and the give-up needs no broken assumption.
    expect(doc.complete).toBe(false);
    expect(doc.revisions.at(-1)!.giveUp).toEqual({ reason: 'The written plan ran out of tasks before the goal was reached.', tried: [] });
    expect(last.find(e => (e as { kind?: string }).kind === 'orchestration-give-up')).toMatchObject({ accepted: true, ranOut: true });
    expect(doc.retired.map(t => t.status)).toEqual(['abandoned', 'abandoned']);
    expect(doc.revisions.slice(1).every(r => r.rationale.startsWith('Fixed plan'))).toBe(true);
  });
});
