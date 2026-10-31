import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedPlanner, OrchestratedSpeechPolicy, planFileSchema, type ChoiceModel, type ChoiceRequest, type PlanDraft } from '@rawstep/policies/policy';
import type { DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';
import { loadPlanFile } from '@rawstep/project/plan';
import { planFileOf, plannerSchema } from '@rawstep/project/config';
import { ProjectStore } from '@rawstep/project/store';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const said = (...speech: string[]) => ({ kind: 'screenreader' as const, provenance: 'simulation' as const, speech, outputEventIds: [], window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'fixture' } });
const input = (over: Partial<Parameters<DecisionPolicy['decide']>[0]> = {}): Parameters<DecisionPolicy['decide']>[0] => ({
  goal: 'Add the phone to the cart', observation: said('Samsung galaxy s6, heading level 2'), history: [],
  allowedActions: { intents: ['next', 'activate'], keys: [], inputKeys: [], replaceText: false }, inputs: {}, signal: new AbortController().signal, ...over,
});
const acted = (step: number, speech: string): HistoryEntry => ({ step, decision: { action: { kind: 'intent', intent: 'next' } }, observation: said(speech), execution: { ok: true } });
/** A plan file as a person writes it: no `complete`, no `rationale`. */
const written = { strategy: 'Move down to the button and press it', criteria: [{ id: 'C1', text: 'The cart confirms the phone' }], assumptions: [],
  phases: [{ title: 'Buy', tasks: [{ goal: "Move to the 'Add to cart' button", done: "Hear 'Add to cart'", cue: 'Add to cart' }, { goal: 'Press it', done: 'Hear the confirmation', cue: 'Product added' }] }] };
function executor(answer: string) {
  const requests: ChoiceRequest[] = [];
  const value: ChoiceModel = { choose: async request => { requests.push(structuredClone(request)); return { choiceId: answer, model: { id: 'jev', runtime: 'test' }, probabilities: request.choices.map(c => c.id === answer ? 0.9 : 0.1 / (request.choices.length - 1)) }; } };
  return { executor: value, requests };
}

describe('plan files', () => {
  it('reads a person\'s plan without complete or rationale, and fills {task} from the task file name', () => {
    expect(planFileSchema.parse(written)).toMatchObject({ complete: false, rationale: '' });
    const planner = plannerSchema.parse({ planFile: 'plans/{task}/L2.json' });
    expect(planFileOf(planner as { planFile: string }, { file: 'tasks/demoblaze-cart.json' })).toBe('plans/demoblaze-cart/L2.json');
    expect(plannerSchema.safeParse({ planFile: 'plans/a.txt' }).success).toBe(false);
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
    const e = executor('intent:next'), policy = new OrchestratedSpeechPolicy(fixed(), e.executor);
    await policy.decide(input());
    expect(e.requests[0]!.state).toMatchObject({ currentTask: { goal: "Move to the 'Add to cart' button" } });
    const plan = (policy.takeDecisionEvidence() as { kind: string; [k: string]: unknown }[]).find(k => k.kind === 'orchestration-plan');
    expect(plan).toMatchObject({ model: { id: 'plans/a.json', runtime: 'fixed-plan' }, prompt: { id: 'rawstep-fixed-plan' } });
    await policy.decide(input({ observation: said('Add to cart, button'), history: [acted(1, 'Add to cart, button')] }));
    expect(e.requests.at(-1)!.state).toMatchObject({ currentTask: { goal: 'Press it' } });
  });
  it('abandons a stuck task instead of rewriting the plan, and ends when no task is left', async () => {
    const e = executor('intent:next'), policy = new OrchestratedSpeechPolicy(fixed(), e.executor, { noChangeLimit: 2, maxPlannerCalls: 5 });
    let history: HistoryEntry[] = [];
    // Speech never changes and no cue is heard, so each task runs into the no-change signal.
    for (let step = 1; step <= 8; step++) {
      const decision = await policy.decide(input({ observation: said('Same item'), history }));
      if ('stop' in decision) { expect(decision).toMatchObject({ stop: 'success', stopSource: 'planner' }); break; }
      history = [...history, { ...acted(step, 'Same item'), changed: false } as HistoryEntry];
    }
    const doc = policy.planDocument()!;
    expect(doc.complete).toBe(true);
    expect(doc.retired.map(t => t.status)).toEqual(['abandoned', 'abandoned']);
    expect(doc.revisions.slice(1).every(r => r.rationale.startsWith('Fixed plan'))).toBe(true);
  });
});
