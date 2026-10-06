import { describe, expect, it } from 'vitest';
import { OrchestratedSpeechPolicy, orchestratedPrompt, type ChoiceModel, type ChoiceRequest, type Plan, type PlanRequest, type Planner } from 'rawstep/policy';
import type { DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';

const said = (...speech: string[]) => ({ kind: 'screenreader' as const, provenance: 'simulation' as const, speech, outputEventIds: [], window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'fixture' } });
const input = (over: Partial<Parameters<DecisionPolicy['decide']>[0]> = {}): Parameters<DecisionPolicy['decide']>[0] => ({
  goal: 'Add Thor Hammer to the cart', observation: said('Thor Hammer, heading level 1'), history: [],
  allowedActions: { intents: ['next', 'activate', 'form.next'], keys: [], inputKeys: [], replaceText: false }, inputs: {}, signal: new AbortController().signal, ...over,
});
const plan = (...goals: string[]): Plan => ({ outline: ['find the product', 'add it to the cart'], steps: goals.map(goal => ({ goal, done: `${goal} done` })), complete: false });
function planner(...plans: Plan[]) {
  const requests: PlanRequest[] = [];
  const value: Planner = { plan: async request => { requests.push(structuredClone(request)); return { plan: plans[Math.min(requests.length - 1, plans.length - 1)]!, model: { id: 'planner', runtime: 'test' } }; } };
  return { planner: value, requests };
}
function executor(...answers: string[]) {
  const requests: ChoiceRequest[] = [];
  const value: ChoiceModel = { inputs: ['text'], choose: async request => { requests.push(structuredClone(request)); return { choiceId: answers[requests.length - 1]!, model: { id: 'jev', runtime: 'test' } }; } };
  return { executor: value, requests };
}
const kinds = (policy: OrchestratedSpeechPolicy) => policy.takeDecisionEvidence().map(e => (e as { kind: string }).kind);

describe('orchestrated speech policy', () => {
  it('plans once, then gives the executor only the current small step', async () => {
    const p = planner(plan('Move to the Add to cart button', 'Activate it')), e = executor('intent:form.next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'form.next' } });
    expect(p.requests).toHaveLength(1); expect(p.requests[0]).toMatchObject({ reason: 'start', completed: [] });
    expect(e.requests[0]!.state).toMatchObject({ goal: 'Add Thor Hammer to the cart', currentStep: { goal: 'Move to the Add to cart button' }, completedSteps: [] });
    expect(e.requests[0]!.choices.map(c => c.id)).toEqual(['intent:next', 'intent:activate', 'intent:form.next', 'stop:success', 'step:done', 'step:help']);
    expect(kinds(policy)).toEqual(['orchestration-plan', 'model-inference']);
  });
  it('moves to the next step when the executor says the step is done, within the same runner step', async () => {
    const p = planner(plan('Find the button', 'Activate it')), e = executor('step:done', 'intent:activate');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests[1]!.state).toMatchObject({ currentStep: { goal: 'Activate it' }, completedSteps: ['Find the button'] });
    expect(kinds(policy)).toEqual(['orchestration-plan', 'model-inference', 'orchestration-step-done', 'model-inference']);
  });
  it('asks the planner again when the executor asks for help, passing the old plan and finished steps', async () => {
    const p = planner(plan('Find search', 'Search'), plan('Move by headings to the product')), e = executor('step:done', 'step:help', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input());
    expect(p.requests[1]).toMatchObject({ reason: 'help', completed: ['Find search'], previous: { step: 1 } });
    expect(e.requests[2]!.state).toMatchObject({ currentStep: { goal: 'Move by headings to the product' } });
  });
  it('replans after repeated failed actions since the current plan', async () => {
    const p = planner(plan('Type the search term'), plan('Move to the search field first')), e = executor('intent:activate', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input());
    const failed = (step: number): HistoryEntry => ({ step, decision: { action: { kind: 'intent', intent: 'activate' } }, observation: said('Search, heading'), execution: { ok: false, failure: 'backend' } });
    await policy.decide(input({ history: [failed(1), failed(2)], observation: said('Search, heading') }));
    expect(p.requests.map(r => r.reason)).toEqual(['start', 'failures']);
  });
  it('replans when actions keep changing nothing', async () => {
    const p = planner(plan('Find the cart'), plan('Use headings')), e = executor('intent:next', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input());
    const same = (step: number): HistoryEntry => ({ step, decision: { action: { kind: 'intent', intent: step % 2 ? 'next' : 'activate' } }, observation: said('Banner'), execution: { ok: true } });
    await policy.decide(input({ history: [same(1), same(2), same(3)], observation: said('Banner') }));
    expect(p.requests.map(r => r.reason)).toEqual(['start', 'no-change']);
  });
  it('stops as stuck once new plans run out, and stops for the verifier when the planner says the goal is done', async () => {
    const p = planner(plan('Anything')), e = executor('step:help', 'step:help');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { maxReplans: 1 });
    expect(await policy.decide(input())).toEqual({ stop: 'stuck', stopSource: 'exploration-guard' });
    expect(kinds(policy)).toContain('orchestration-limit');
    const done = new OrchestratedSpeechPolicy(planner({ outline: [], steps: [], complete: true }).planner, executor().executor);
    expect(await done.decide(input())).toEqual({ stop: 'success', stopSource: 'model' });
  });
  it('asks for the next plan when every step is finished', async () => {
    const p = planner(plan('Only step'), plan('Check the cart')), e = executor('step:done', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input());
    expect(p.requests.map(r => r.reason)).toEqual(['start', 'plan-finished']);
  });
  it('appends the executor guide to the run prompt under a separate ID', () => {
    const prompt = orchestratedPrompt({ id: 'baseline', version: '1', instructions: 'Base.' });
    expect(prompt.id).toBe('baseline.orchestrated'); expect(prompt.instructions).toMatch(/^Base\.\nYou carry out one small step/);
  });
});

describe('orchestrated policy inside the runner', () => {
  it('records the plan, finished steps and executor choices as policy evidence while the runner verifies', async () => {
    const { mkdtemp, rm, readFile } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
    const { runTask } = await import('@rawstep/browser/runner');
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-orchestration-'));
    try {
      let pressed = 0;
      const backend = { evidenceProvenance: 'simulation' as const, capabilities: { intents: ['next', 'activate'], keys: [], textEntry: false, replaceText: false },
        start: async () => ({}), execute: async () => { pressed++; return {}; }, close: async () => {}, subscribe: () => () => {},
        observe: async () => ({ windowId: 'w', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:01Z', reason: 'fixture', outputs: [], speech: [pressed ? 'Added to cart' : 'Add to cart, button'] }) };
      const session = { page: { bringToFront: async () => {} }, browser: { version: () => 'fake' }, takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: async () => {} };
      const p = planner(plan('Activate Add to cart')), e = executor('intent:activate');
      const trace = await runTask({ url: 'https://example.test', goal: 'Add to cart', verify: { all: [{ titleIncludes: 'Done' }] } }, {
        backend, policy: new OrchestratedSpeechPolicy(p.planner, e.executor), outDir: dir, browserSessionFactory: async () => session as never,
        verifier: async () => ({ passed: pressed > 0, failures: pressed > 0 ? [] : ['not yet'] }) });
      expect(trace.outcome?.status).toBe('success');
      const evidence = trace.events.filter(ev => ev.type === 'policy.evidence').map(ev => (ev.data as { evidence: { kind: string } }).evidence.kind);
      expect(evidence).toEqual(['orchestration-plan', 'model-inference']);
      expect(await readFile(join(dir, 'trace.json'), 'utf8')).toContain('Activate Add to cart');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
