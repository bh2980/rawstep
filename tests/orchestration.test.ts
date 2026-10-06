import { describe, expect, it } from 'vitest';
import {
  applyDraft, currentTask, renderPlanMarkdown, OrchestratedSpeechPolicy, orchestratedPrompt, planTasks, verifyCue,
  type ChoiceModel, type ChoiceRequest, type PlanDraft, type PlanRequest, type Planner,
} from '@rawstep/policies/policy';
import type { DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';

const said = (...speech: string[]) => ({ kind: 'screenreader' as const, provenance: 'simulation' as const, speech, outputEventIds: [], window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'fixture' } });
const input = (over: Partial<Parameters<DecisionPolicy['decide']>[0]> = {}): Parameters<DecisionPolicy['decide']>[0] => ({
  goal: 'Add Thor Hammer to the cart', observation: said('Thor Hammer, heading level 1'), history: [],
  allowedActions: { intents: ['next', 'activate', 'form.next'], keys: [], inputKeys: [], replaceText: false }, inputs: {}, signal: new AbortController().signal, ...over,
});
/** A draft with one phase per entry; a task is "goal" or ["keep id", goal]. */
const draft = (phases: Record<string, (string | [string, string])[]>, rationale = '', extra: Partial<PlanDraft> = {}): PlanDraft => ({ complete: false, rationale,
  strategy: 'Find the button and press it', criteria: [{ id: 'C1', text: 'The cart confirms the item' }], assumptions: [{ id: 'A1', text: 'The button follows the quantity field' }], ...extra,
  phases: Object.entries(phases).map(([title, tasks]) => ({ title, tasks: tasks.map(t => typeof t === 'string' ? { goal: t, done: `Hear "${t}"` } : { keep: t[0], goal: t[1], done: `Hear "${t[1]}"` }) })) });
function planner(...drafts: PlanDraft[]) {
  const requests: PlanRequest[] = [];
  const value: Planner = { plan: async request => { requests.push(structuredClone(request)); return { draft: drafts[Math.min(requests.length - 1, drafts.length - 1)]!, model: { id: 'planner', runtime: 'test' }, prompt: { id: 'rawstep-planner', version: 'v', sha256: 'x' } }; } };
  return { planner: value, requests };
}
function executor(...answers: string[]) {
  const requests: ChoiceRequest[] = [];
  const value: ChoiceModel = { inputs: ['text'], choose: async request => { requests.push(structuredClone(request)); return { choiceId: answers[requests.length - 1]!, model: { id: 'jev', runtime: 'test' } }; } };
  return { executor: value, requests };
}
const evidence = (policy: OrchestratedSpeechPolicy) => policy.takeDecisionEvidence() as { kind: string; [key: string]: unknown }[];
const acted = (step: number, intent: string, speech: string, ok = true): HistoryEntry => ({ step, decision: { action: { kind: 'intent', intent } }, observation: said(speech), execution: ok ? { ok: true } : { ok: false, failure: 'backend' } });

describe('plan document', () => {
  it('numbers tasks, makes the first open one current, and versions every change', () => {
    const v1 = applyDraft(undefined, draft({ Find: ['Find the button'], Buy: ['Activate it'] }), { goal: 'g', step: 1, trigger: 'start' });
    expect(v1).toMatchObject({ version: 1, current: 't1', revisions: [{ version: 1, trigger: 'start', added: ['t1', 't2'], abandoned: [] }] });
    expect(planTasks(v1).map(t => [t.id, t.status])).toEqual([['t1', 'active'], ['t2', 'pending']]);
  });
  it('keeps finished and kept tasks, abandons dropped open tasks and records why the plan changed', () => {
    const v1 = applyDraft(undefined, draft({ Find: ['Hear the title', 'Find the button'], Buy: ['Activate it'] }), { goal: 'g', step: 1, trigger: 'start' });
    planTasks(v1)[0]!.status = 'done'; planTasks(v1)[1]!.actions = 9;
    const v2 = applyDraft(v1, draft({ Find: [['t1', 'Hear the title'], 'Move by form controls'], Buy: [['t3', 'Activate it']] }, 'The button never came up.'), { goal: 'g', step: 12, trigger: 'help', help: 'no-cue' });
    expect(planTasks(v2).map(t => [t.id, t.status])).toEqual([['t1', 'done'], ['t4', 'active'], ['t3', 'pending']]);
    expect(v2.retired).toEqual([expect.objectContaining({ id: 't2', status: 'abandoned', actions: 9, phase: 'Find', ending: { reason: 'replaced', step: 12 } })]);
    expect(v2.revisions[1]).toEqual({ version: 2, step: 12, trigger: 'help', help: 'no-cue', rationale: 'The button never came up.', added: ['t4'], abandoned: ['t2'], broken: [], met: [] });
    expect(planTasks(v2).map(t => t.number)).toEqual(['1.1', '1.2', '2.1']);
  });
  it('tracks success criteria and assumptions by id, and records which turned out met or wrong', () => {
    const v1 = applyDraft(undefined, draft({ Find: ['Find it'] }), { goal: 'g', step: 1, trigger: 'start' });
    const v2 = applyDraft(v1, draft({ Find: ['Use headings'] }, 'A1 was wrong.', { assumptions: [{ id: 'A1', text: 'The button follows the quantity field', status: 'broken' }, { id: 'A2', text: 'Headings mark sections' }] }), { goal: 'g', step: 5, trigger: 'help', help: 'no-cue' });
    expect(v2.assumptions).toEqual([{ id: 'A1', text: 'The button follows the quantity field', status: 'broken', addedIn: 1, settledIn: 2 }, { id: 'A2', text: 'Headings mark sections', status: 'open', addedIn: 2 }]);
    expect(v2.revisions[1]).toMatchObject({ broken: ['A1'], met: [] });
    const v3 = applyDraft(v2, draft({ Find: ['Use headings'] }, '', { criteria: [{ id: 'C1', text: 'The cart confirms the item', status: 'met' }], assumptions: [{ id: 'A1', text: 'x', status: 'open' }] }), { goal: 'g', step: 9, trigger: 'checkpoint' });
    expect(v3.assumptions[0]).toMatchObject({ status: 'broken' });
    expect(v3.revisions[2]).toMatchObject({ met: ['C1'] });
    expect(renderPlanMarkdown(v3)).toMatch(/## Success criteria\n\n- ✓ C1 The cart confirms the item[\s\S]*- ✕ A1[\s\S]*- \[~\] 1\.1 Use headings[\s\S]*← current[\s\S]*- v2 before step 5 · help\/no-cue · broken A1 — A1 was wrong\./);
  });
  it('checks a claimed completion against the quoted cue', () => {
    expect(verifyCue({ done: 'Hear "Add to cart, button"', cue: '' }, ['add to cart,  button'])).toBe('heard');
    expect(verifyCue({ done: 'Hear “Added to cart”', cue: '' }, ['Quantity, 1'])).toBe('not-heard');
    expect(verifyCue({ done: 'The cart opens', cue: '' }, ['Cart'])).toBe('unchecked');
    // The planner's cue wins over quotes in the description.
    expect(verifyCue({ done: 'The cart opens', cue: 'Cart, 1 item' }, ['cart, 1 item, link'])).toBe('heard');
    expect(verifyCue({ done: 'Hear "Cart"', cue: 'Cart, 1 item' }, ['Cart'])).toBe('not-heard');
  });
});

describe('orchestrated speech policy', () => {
  it('plans with the real actions, then gives the executor the current task, the plan outline and the next task', async () => {
    const p = planner(draft({ Find: ['Move to Add to cart'], Buy: ['Activate it'] })), e = executor('intent:form.next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'form.next' } });
    expect(p.requests[0]).toMatchObject({ trigger: 'start', attempts: [] });
    expect(p.requests[0]!.actions.map(a => a.id)).toEqual(['intent:next', 'intent:activate', 'intent:form.next']);
    expect(e.requests[0]!.state).toMatchObject({ currentTask: { goal: 'Move to Add to cart', actions: 0, actionLimit: 12 }, nextTask: 'Activate it',
      plan: [{ number: '1.1', phase: 'Find', task: 'Move to Add to cart', status: 'active' }, { number: '2.1', phase: 'Buy', task: 'Activate it', status: 'pending' }] });
    expect(e.requests[0]!.choices.map(c => c.id)).toEqual(['intent:next', 'intent:activate', 'intent:form.next', 'stop:success', 'task:done', 'help:already-done']);
    const kinds = evidence(policy);
    expect(kinds.map(k => k.kind)).toEqual(['orchestration-plan', 'orchestration-task', 'model-inference']);
    expect(kinds[0]).toMatchObject({ role: 'planner', version: 1, prompt: { id: 'rawstep-planner' } });
    expect(kinds[2]).toMatchObject({ role: 'executor', taskId: 't1', planVersion: 1 });
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ status: 'active', actions: 1 });
  });
  it('checks a claimed completion, reviews the finished phase, and moves on within the same runner step', async () => {
    const p = planner(draft({ Find: ['Find the button'], Buy: ['Activate it'] }), draft({ Find: [['t1', 'Find the button']], Buy: [['t2', 'Activate it']] }, 'Phase 1 met C1.')), e = executor('task:done', 'intent:activate');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    expect(await policy.decide(input({ observation: said('Find the button') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { goal: 'Activate it' } });
    const done = evidence(policy).find(k => k.kind === 'orchestration-task' && k.toStatus === 'done');
    expect(done).toMatchObject({ taskId: 't1', fromStatus: 'active', ending: { reason: 'done', step: 1, verified: 'heard' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'checkpoint']);
    const doc = policy.planDocument()!;
    expect(doc).toMatchObject({ version: 2, current: 't2' }); expect(doc.phases[0]!.checkpoint).toEqual({ version: 2, step: 1 });
  });
  it('asks for a new plan with the executor\'s reason and the attempts linked to their tasks', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Move by form controls'] }, 'Not heard after 2 moves.')), e = executor('intent:next', 'intent:next', 'help:no-cue', 'intent:form.next');
    // (one phase, so no checkpoint call in between)
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input());
    await policy.decide(input({ history: [acted(1, 'next', 'Banner')], observation: said('Logo') }));
    await policy.decide(input({ history: [acted(1, 'next', 'Banner'), acted(2, 'next', 'Logo')], observation: said('Search') }));
    expect(p.requests[1]).toMatchObject({ trigger: 'help', help: 'no-cue', document: { version: 1 } });
    expect(p.requests[1]!.attempts.map(a => [a.step, a.taskId, a.planVersion])).toEqual([[1, 't1', 1], [2, 't1', 1]]);
    const doc = policy.planDocument()!;
    expect(doc).toMatchObject({ version: 2, current: 't2', retired: [{ id: 't1', status: 'abandoned', actions: 2 }] });
    expect(doc.revisions[1]).toMatchObject({ trigger: 'help', help: 'no-cue', rationale: 'Not heard after 2 moves.' });
  });
  it('replans after repeated failures or no change on the current task', async () => {
    const failing = planner(draft({ Type: ['Type the term'] }), draft({ Type: ['Find the field first'] })), e1 = executor('intent:activate', 'intent:activate', 'intent:next');
    const p1 = new OrchestratedSpeechPolicy(failing.planner, e1.executor);
    await p1.decide(input());
    await p1.decide(input({ history: [acted(1, 'activate', 'Search, heading', false)] }));
    await p1.decide(input({ history: [acted(1, 'activate', 'Search, heading', false), acted(2, 'activate', 'Search, heading', false)] }));
    expect(failing.requests.map(r => r.trigger)).toEqual(['start', 'failures']);
    const still = planner(draft({ Cart: ['Find the cart'] }), draft({ Cart: ['Use headings'] })), e2 = executor('intent:next', 'intent:activate', 'intent:next', 'intent:next');
    const p2 = new OrchestratedSpeechPolicy(still.planner, e2.executor);
    const h = [acted(1, 'next', 'Banner'), acted(2, 'activate', 'Banner'), acted(3, 'next', 'Banner')];
    await p2.decide(input());
    for (let i = 1; i <= 3; i++) await p2.decide(input({ history: h.slice(0, i), observation: said('Banner') }));
    expect(still.requests.map(r => r.trigger)).toEqual(['start', 'no-change']);
  });
  it('lets a fresh plan run before the repetition guard can stop it', async () => {
    const p = planner(draft({ Cart: ['Find the cart'] }), draft({ Cart: ['Try next'] })), e = executor('intent:next', 'intent:next', 'intent:next', 'intent:next', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { repetitionGuard: true, maxUnchangedTransitions: 4, noChangeLimit: 3 });
    const h = [1, 2, 3, 4].map(i => acted(i, 'next', 'End of content'));
    await policy.decide(input());
    for (let i = 1; i <= 3; i++) await policy.decide(input({ history: h.slice(0, i), observation: said('End of content') }));
    expect(await policy.decide(input({ history: h, observation: said('End of content') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
  });
  it('stops with its own stop sources: the planner judging the goal done, or running out of new plans', async () => {
    const p = planner(draft({ Any: ['Anything'] })), e = executor('intent:next', 'help:no-effect', 'intent:next', 'help:no-effect');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { maxReplans: 1 });
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: [acted(1, 'next', 'Quantity, 1')] }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: [acted(1, 'next', 'Quantity, 1'), acted(2, 'next', 'Price')] }))).toEqual({ stop: 'stuck', stopSource: 'orchestration-limit' });
    expect(evidence(policy).some(k => k.kind === 'orchestration-limit')).toBe(true);
    expect(currentTask(policy.planDocument()!)).toMatchObject({ status: 'failed' });
    const done = new OrchestratedSpeechPolicy(planner({ ...draft({}), complete: true, rationale: 'Already in the cart.' }).planner, executor().executor);
    expect(await done.decide(input())).toEqual({ stop: 'success', stopSource: 'planner' });
  });
  it('turns down a "done" claim whose cue was not heard: the task stays open and the executor must act', async () => {
    const p = planner({ ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Activate Add to cart', done: 'The cart confirms', cue: 'Added to cart' }] }] });
    const e = executor('task:done', 'intent:activate');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    expect(await policy.decide(input({ observation: said('Add to cart, button') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests[1]!.choices.map(c => c.id)).not.toContain('task:done');
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { cue: 'Added to cart', claimsTurnedDown: 1 } });
    const kinds = evidence(policy);
    expect(kinds.find(k => k.kind === 'orchestration-claim')).toMatchObject({ taskId: 't1', verified: 'not-heard', accepted: false, rejected: 1 });
    expect(kinds.filter(k => k.kind === 'model-inference')[0]).toMatchObject({ choiceId: 'task:done', accepted: false });
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ status: 'active', rejected: 1, actions: 1 });
    expect(p.requests).toHaveLength(1);
  });
  it('lets the executor ask for help about a missing cue or no effect only after it has tried the task', async () => {
    const p = planner(draft({ Find: ['Find the button'] })), e = executor('intent:next', 'help:no-cue', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input());
    expect(e.requests[0]!.choices.map(c => c.id).filter(id => id.startsWith('help:'))).toEqual(['help:already-done']);
    await policy.decide(input({ history: [acted(1, 'next', 'Quantity, 1')] }));
    expect(e.requests[1]!.choices.map(c => c.id).filter(id => id.startsWith('help:'))).toEqual(['help:no-cue', 'help:no-effect', 'help:already-done']);
  });
  it('asks for the next plan when every task is finished', async () => {
    const p = planner(draft({ Only: ['Only task'] }), draft({ Check: ['Check the cart'] })), e = executor('task:done', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input({ observation: said('Only task') }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'plan-finished']);
    expect(p.requests[1]!.document!.phases[0]!.tasks[0]).toMatchObject({ status: 'done', ending: { verified: 'heard' } });
  });
  it('appends the executor guide to the run prompt under a separate ID', () => {
    const prompt = orchestratedPrompt({ id: 'baseline', version: '1', instructions: 'Base.' });
    expect(prompt.id).toBe('baseline.orchestrated'); expect(prompt.instructions).toMatch(/^Base\.\nYou carry out one task of a plan/);
  });
});

describe('orchestrated policy inside the runner', () => {
  it('records the plan, task changes and executor choices as policy evidence while the runner verifies', async () => {
    const { mkdtemp, rm, readFile } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
    const { runTask } = await import('@rawstep/browser/runner');
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-orchestration-'));
    try {
      let pressed = 0;
      const backend = { evidenceProvenance: 'simulation' as const, capabilities: { intents: ['next', 'activate'], keys: [], textEntry: false, replaceText: false },
        start: async () => ({}), execute: async () => { pressed++; return {}; }, close: async () => {}, subscribe: () => () => {},
        observe: async () => ({ windowId: 'w', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:01Z', reason: 'fixture', outputs: [], speech: [pressed ? 'Added to cart' : 'Add to cart, button'] }) };
      const session = { page: { bringToFront: async () => {} }, browser: { version: () => 'fake' }, takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: async () => {} };
      // The executor first claims the task done before anything happened; the cue is not heard, so the claim is turned down.
      const p = planner({ ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Activate Add to cart', done: 'The cart confirms', cue: 'Added to cart' }] }] }), e = executor('task:done', 'intent:activate');
      const trace = await runTask({ url: 'https://example.test', goal: 'Add to cart', verify: { all: [{ titleIncludes: 'Done' }] } }, {
        backend, policy: new OrchestratedSpeechPolicy(p.planner, e.executor), outDir: dir, browserSessionFactory: async () => session as never,
        verifier: async () => ({ passed: pressed > 0, failures: pressed > 0 ? [] : ['not yet'] }) });
      expect(trace.outcome?.status).toBe('success');
      const kinds = trace.events.filter(ev => ev.type === 'policy.evidence').map(ev => (ev.data as { evidence: { kind: string } }).evidence.kind);
      expect(kinds).toEqual(['orchestration-plan', 'orchestration-task', 'model-inference', 'orchestration-claim', 'model-inference']);
      const { extractHints } = await import('@rawstep/reports/hints');
      expect(extractHints(trace).hints.filter(h => h.kind === 'unverified-done')).toMatchObject([{ source: 'run', certainty: 'observed', steps: [1], detail: { taskId: 't1' } }]);
      expect(await readFile(join(dir, 'trace.json'), 'utf8')).toContain('Activate Add to cart');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
