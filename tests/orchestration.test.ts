import { describe, expect, it } from 'vitest';
import {
  applyDraft, currentTask, matchCue, renderPlanMarkdown, OrchestratedSpeechPolicy, orchestratedPrompt, planTasks, verifyCue,
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
  it('tells a cue the way a listener would: role and state first, then all name words, else worth asking', () => {
    const button = { cue: 'Add to cart', cueRole: 'button' as const };
    expect(matchCue(button, 'Add to cart, button')).toBe('heard');
    expect(matchCue({ cue: 'cart', cueRole: 'button' }, 'Cart (0), link')).toBe('no');
    expect(matchCue({ cue: 'cart', cueRole: 'link' }, 'link, Cart (0)')).toBe('heard');
    const box = { cue: 'Email notifications for order updates', cueRole: 'checkbox' as const };
    expect(matchCue(box, 'Order updates, unchecked, checkbox')).toBe('candidate');
    expect(matchCue(box, 'Email notifications, group')).toBe('no');
    const checked = { cue: 'Order updates', cueRole: 'checkbox' as const, cueState: 'checked' as const };
    expect(matchCue(checked, 'Order updates, unchecked, checkbox')).toBe('no');
    expect(matchCue(checked, 'Special offers, checked, checkbox')).toBe('no');
    expect(matchCue(checked, 'Order updates, checked, checkbox')).toBe('heard');
    // Without a role the item must say nothing beyond the cue to count at once; a longer line is put to the planner.
    expect(matchCue({ cue: 'days' }, 'Return items within 30 days of delivery.')).toBe('candidate');
    expect(matchCue({ cue: 'days', cueRole: 'text' }, 'Return items within 30 days of delivery.')).toBe('heard');
    expect(matchCue({ cue: 'days', cueRole: 'text' }, 'Days, heading, level 2')).toBe('no');
    expect(matchCue({ cue: 'Returns', cueRole: 'heading' }, 'Help center, heading, level 1')).toBe('no');
    // A role-only cue is heard on an item with that role; an unnamed item of the expected role is worth asking about.
    expect(matchCue({ cue: '', cueRole: 'button' }, 'button')).toBe('heard');
    expect(matchCue({ cue: '', cueRole: 'button' }, 'link, Home')).toBe('no');
    expect(matchCue({ cue: 'Add to cart', cueRole: 'button' }, 'button')).toBe('candidate');
    expect(matchCue({ cue: 'Add to cart', cueRole: 'button' }, 'Reviews, heading, level 2')).toBe('no');
  });
  it('reads a structured cue from the plan, dropping a role or state it does not know', () => {
    const v1 = applyDraft(undefined, { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Move to it', done: 'Hear it', cue: { name: 'Add to cart', role: 'Button' } },
      { goal: 'Check it', done: 'Hear checked', cue: { name: 'Order updates', role: 'status', state: 'checked' } }] }] }, { goal: 'g', step: 1, trigger: 'start' });
    expect(planTasks(v1).map(t => [t.cue, t.cueRole, t.cueState])).toEqual([['Add to cart', 'button', undefined], ['Order updates', undefined, 'checked']]);
  });
  it('checks a claimed completion against the quoted cue', () => {
    expect(verifyCue({ done: 'Hear "Add to cart, button"', cue: '' }, ['add to cart,  button'])).toBe('heard');
    expect(verifyCue({ done: 'Hear “Added to cart”', cue: '' }, ['Quantity, 1'])).toBe('not-heard');
    expect(verifyCue({ done: 'The cart opens', cue: '' }, ['Cart'])).toBe('unchecked');
    // The planner's cue wins over quotes in the description.
    expect(verifyCue({ done: 'The cart opens', cue: 'Cart, 1 item' }, ['cart, 1 item, link'])).toBe('heard');
    // Whole words: "checked" is not heard in "unchecked".
    expect(verifyCue({ done: 'Hear it checked', cue: 'checked' }, ['Order updates, unchecked, checkbox'])).toBe('not-heard');
    expect(verifyCue({ done: 'Hear it checked', cue: 'checked' }, ['Order updates, checked, checkbox'])).toBe('heard');
    expect(verifyCue({ done: 'Hear "Cart"', cue: 'Cart, 1 item' }, ['Cart'])).toBe('not-heard');
  });
});

/** The executor-claims mode (meta options offered), kept for comparison; Rawstep's own task control is tested below. */
const EXECUTOR_CLAIMS = { taskControl: 'executor' } as const;
describe('orchestrated speech policy', () => {
  it('plans with the real actions, then gives the executor the current task, the plan outline and the next task', async () => {
    const p = planner(draft({ Find: ['Move to Add to cart'], Buy: ['Activate it'] })), e = executor('intent:form.next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS);
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'form.next' } });
    expect(p.requests[0]).toMatchObject({ trigger: 'start', attempts: [] });
    expect(p.requests[0]!.actions.map(a => a.id)).toEqual(['intent:next', 'intent:activate', 'intent:form.next']);
    expect(e.requests[0]!.state).toMatchObject({ currentTask: { goal: 'Move to Add to cart', actions: 0, actionLimit: 12 }, nextTask: 'Activate it',
      plan: [{ number: '1.1', phase: 'Find', task: 'Move to Add to cart', status: 'active' }, { number: '2.1', phase: 'Buy', task: 'Activate it', status: 'pending' }] });
    expect(e.requests[0]!.choices.map(c => c.id)).toEqual(['intent:next', 'intent:activate', 'intent:form.next', 'task:done']);
    const kinds = evidence(policy);
    expect(kinds.map(k => k.kind)).toEqual(['orchestration-plan', 'orchestration-task', 'model-inference']);
    expect(kinds[0]).toMatchObject({ role: 'planner', version: 1, prompt: { id: 'rawstep-planner' } });
    expect(kinds[2]).toMatchObject({ role: 'executor', taskId: 't1', planVersion: 1 });
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ status: 'active', actions: 1 });
  });
  it('checks a claimed completion, reviews the finished phase, and moves on within the same runner step', async () => {
    const p = planner(draft({ Find: ['Find the button'], Buy: ['Activate it'] }), draft({ Find: [['t1', 'Find the button']], Buy: [['t2', 'Activate it']] }, 'Phase 1 met C1.')), e = executor('task:done', 'intent:activate');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS);
    expect(await policy.decide(input({ observation: said('Find the button') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { goal: 'Activate it' } });
    const done = evidence(policy).find(k => k.kind === 'orchestration-task' && k.toStatus === 'done');
    expect(done).toMatchObject({ taskId: 't1', fromStatus: 'active', ending: { reason: 'done', step: 1, verified: 'heard' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'checkpoint']);
    const doc = policy.planDocument()!;
    expect(doc).toMatchObject({ version: 2, current: 't2' }); expect(doc.phases[0]!.checkpoint).toEqual({ version: 2, step: 1 });
  });
  it('asks for a new plan with the executor\'s reason and the attempts linked to their tasks', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Move by form controls'] }, 'Not heard after 3 moves.')), e = executor('intent:next', 'intent:next', 'intent:next', 'help:no-cue', 'intent:form.next');
    // (one phase, so no checkpoint call in between)
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS);
    await policy.decide(input());
    await policy.decide(input({ history: [acted(1, 'next', 'Banner')], observation: said('Logo') }));
    await policy.decide(input({ history: [acted(1, 'next', 'Banner'), acted(2, 'next', 'Logo')], observation: said('Search') }));
    await policy.decide(input({ history: [acted(1, 'next', 'Banner'), acted(2, 'next', 'Logo'), acted(3, 'next', 'Search')], observation: said('Menu') }));
    expect(p.requests[1]).toMatchObject({ trigger: 'help', help: 'no-cue', document: { version: 1 } });
    expect(p.requests[1]!.attempts.map(a => [a.step, a.taskId, a.planVersion])).toEqual([[1, 't1', 1], [2, 't1', 1], [3, 't1', 1]]);
    const doc = policy.planDocument()!;
    expect(doc).toMatchObject({ version: 2, current: 't2', retired: [{ id: 't1', status: 'abandoned', actions: 3 }] });
    expect(doc.revisions[1]).toMatchObject({ trigger: 'help', help: 'no-cue', rationale: 'Not heard after 3 moves.' });
  });
  it('replans after repeated failures or no change on the current task', async () => {
    const failing = planner(draft({ Type: ['Type the term'] }), draft({ Type: ['Find the field first'] })), e1 = executor('intent:activate', 'intent:activate', 'intent:next');
    const p1 = new OrchestratedSpeechPolicy(failing.planner, e1.executor, EXECUTOR_CLAIMS);
    await p1.decide(input());
    await p1.decide(input({ history: [acted(1, 'activate', 'Search, heading', false)] }));
    await p1.decide(input({ history: [acted(1, 'activate', 'Search, heading', false), acted(2, 'activate', 'Search, heading', false)] }));
    expect(failing.requests.map(r => r.trigger)).toEqual(['start', 'failures']);
    const still = planner(draft({ Cart: ['Find the cart'] }), draft({ Cart: ['Use headings'] })), e2 = executor('intent:next', 'intent:activate', 'intent:next', 'intent:next');
    const p2 = new OrchestratedSpeechPolicy(still.planner, e2.executor, EXECUTOR_CLAIMS);
    const h = [acted(1, 'next', 'Banner'), acted(2, 'activate', 'Banner'), acted(3, 'next', 'Banner')];
    await p2.decide(input());
    for (let i = 1; i <= 3; i++) await p2.decide(input({ history: h.slice(0, i), observation: said('Banner') }));
    expect(still.requests.map(r => r.trigger)).toEqual(['start', 'no-change']);
  });
  it('lets a fresh plan run before the repetition guard can stop it', async () => {
    const p = planner(draft({ Cart: ['Find the cart'] }), draft({ Cart: ['Try next'] })), e = executor('intent:next', 'intent:next', 'intent:next', 'intent:next', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { ...EXECUTOR_CLAIMS, repetitionGuard: true, maxUnchangedTransitions: 4, noChangeLimit: 3 });
    const h = [1, 2, 3, 4].map(i => acted(i, 'next', 'End of content'));
    await policy.decide(input());
    for (let i = 1; i <= 3; i++) await policy.decide(input({ history: h.slice(0, i), observation: said('End of content') }));
    expect(await policy.decide(input({ history: h, observation: said('End of content') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
  });
  it('hands repeated speech to the planner while replans remain, and lets the guard stop the run only after that', async () => {
    const h = [1, 2, 3].map(i => acted(i, 'next', 'End of content'));
    const p = planner(draft({ Read: ['Read the answer'] }), draft({ Read: ['Go back and open the question'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, executor('intent:next', 'intent:next').executor, { repetitionGuard: true, maxUnchangedTransitions: 2, noChangeLimit: 5 });
    await policy.decide(input());
    expect(await policy.decide(input({ history: h, observation: said('End of content') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'no-change']);
    const last = new OrchestratedSpeechPolicy(planner(draft({ Read: ['Read the answer'] })).planner, executor('intent:next').executor, { repetitionGuard: true, maxUnchangedTransitions: 2, noChangeLimit: 5, maxReplans: 0 });
    await last.decide(input());
    expect(await last.decide(input({ history: h, observation: said('End of content') }))).toEqual({ stop: 'stuck', stopSource: 'exploration-guard' });
  });
  it('stops with its own stop sources: the planner judging the goal done, or running out of new plans', async () => {
    const p = planner(draft({ Any: ['Anything'] })), e = executor(...Array(5).fill('intent:next'));
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { ...EXECUTOR_CLAIMS, maxReplans: 1, stepActionLimit: 1 });
    // Every action lands on the same item: nothing new is heard, so each task runs out after one stale action.
    const same = 'Thor Hammer, heading level 1', at = (n: number) => Array.from({ length: n }, (_, i) => acted(i + 1, 'next', same));
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: at(1) }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: at(2) }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'task-limit']);
    expect(await policy.decide(input({ history: at(3) }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: at(4) }))).toEqual({ stop: 'stuck', stopSource: 'orchestration-limit' });
    expect(evidence(policy).some(k => k.kind === 'orchestration-limit')).toBe(true);
    expect(currentTask(policy.planDocument()!)).toMatchObject({ status: 'failed' });
    const done = new OrchestratedSpeechPolicy(planner({ ...draft({}), complete: true, rationale: 'Already in the cart.' }).planner, executor().executor);
    expect(await done.decide(input())).toEqual({ stop: 'success', stopSource: 'planner' });
  });
  it('turns down a "done" claim whose cue was not heard: the task stays open and the executor must act', async () => {
    const p = planner({ ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Activate Add to cart', done: 'The cart confirms', cue: 'Added to cart' }] }] });
    const e = executor('task:done', 'intent:activate');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS);
    expect(await policy.decide(input({ observation: said('Add to cart, button') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests[1]!.choices.map(c => c.id)).not.toContain('task:done');
    // Asking whether it is already done would be the same claim again.
    expect(e.requests[1]!.choices.map(c => c.id)).not.toContain('help:already-done');
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { cue: 'Added to cart', claimsTurnedDown: 1 } });
    const kinds = evidence(policy);
    expect(kinds.find(k => k.kind === 'orchestration-claim')).toMatchObject({ taskId: 't1', verified: 'not-heard', accepted: false, rejected: 1 });
    expect(kinds.filter(k => k.kind === 'model-inference')[0]).toMatchObject({ choiceId: 'task:done', accepted: false });
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ status: 'active', rejected: 1, actions: 1 });
    expect(p.requests).toHaveLength(1);
  });
  it('lets the executor ask for help only after a few actions on the task, and never pick a stop', async () => {
    const p = planner(draft({ Find: ['Find the button'] })), e = executor('intent:next', 'intent:next', 'intent:next', 'help:no-cue', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS);
    const history = [acted(1, 'next', 'Quantity, 1'), acted(2, 'next', 'Price'), acted(3, 'next', 'Stock')];
    for (let n = 0; n <= 3; n++) await policy.decide(input({ history: history.slice(0, n) }));
    const helps = (i: number) => e.requests[i]!.choices.map(c => c.id).filter(id => id.startsWith('help:') || id.startsWith('stop:'));
    expect([helps(0), helps(1), helps(2)]).toEqual([[], [], []]);
    expect(helps(3)).toEqual(['help:no-cue', 'help:no-effect', 'help:already-done']);
  });
  it('asks for the next plan when every task is finished', async () => {
    const p = planner(draft({ Only: ['Only task'] }), draft({ Check: ['Check the cart'] })), e = executor('task:done', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS);
    await policy.decide(input({ observation: said('Only task') }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'plan-finished']);
    expect(p.requests[1]!.document!.phases[0]!.tasks[0]).toMatchObject({ status: 'done', ending: { verified: 'heard' } });
  });
  it('appends the executor guide to the run prompt under a separate ID for each kind of task control', () => {
    const claims = orchestratedPrompt({ id: 'baseline', version: '1', instructions: 'Base.' }, 'executor');
    expect(claims.id).toBe('baseline.orchestrated'); expect(claims.instructions).toMatch(/^Base\.\nYou carry out one task of a plan.*Current task done/);
    const actions = orchestratedPrompt({ id: 'baseline', version: '1', instructions: 'Base.' });
    expect(actions.id).toBe('baseline.orchestrated-actions'); expect(actions.instructions).toMatch(/always pick an action/); expect(actions.instructions).not.toMatch(/Current task done/);
  });
});

describe('orchestrated speech policy under Rawstep\'s task control (default)', () => {
  /** An executor that also reports probabilities, as a decision model does. */
  function scored(...answers: [string, number][]) {
    const requests: ChoiceRequest[] = [];
    const value: ChoiceModel = { inputs: ['text'], choose: async request => {
      requests.push(structuredClone(request));
      const [choiceId, top] = answers[Math.min(requests.length - 1, answers.length - 1)]!;
      return { choiceId, model: { id: 'jev', runtime: 'test' }, probabilities: request.choices.map(c => c.id === choiceId ? top : (1 - top) / Math.max(1, request.choices.length - 1)) };
    } };
    return { executor: value, requests };
  }
  it('labels actions in plain words and gives the item the cursor is on as state, never in a label', async () => {
    const p = planner(draft({ Buy: ['Press it'] })), e = scored(['intent:activate', 0.9]);
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input({ observation: said('Add to cart, button') }));
    expect(e.requests[0]!.choices.map(c => c.label)).toEqual(['Move to the next item', 'Activate the current item', 'Jump to the next form control']);
    expect(e.requests[0]!.state).toMatchObject({ currentItem: 'Add to cart, button' });
    // An activation that said nothing leaves the item it was on as the current one.
    await policy.decide(input({ observation: said(), history: [{ step: 1, decision: { action: { kind: 'intent', intent: 'activate' } }, observation: said('Add to cart, button'), execution: { ok: true } }] }));
    expect(e.requests[1]!.state).toMatchObject({ currentItem: 'Add to cart, button' });
  });
  it('offers no activation on a task the plan marks as only moving', async () => {
    const moving = { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Move to the button', done: 'Hear it', cue: 'Add to cart', activates: false }, { goal: 'Press it', done: 'Hear added', cue: 'Added', activates: true }] }] };
    const p = planner(moving), e = scored(['intent:next', 0.9], ['intent:activate', 0.9]);
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input({ observation: said('Phones, link') }));
    expect(e.requests[0]!.choices.map(c => c.id)).not.toContain('intent:activate');
    await policy.decide(input({ observation: said('Add to cart, button'), history: [acted(1, 'next', 'Phones, link')] }));
    expect(e.requests[1]!.choices.map(c => c.id)).toContain('intent:activate');
  });
  it('surveys the headings as the first action before planning, plans from what it said, and never offers the survey to the executor', async () => {
    const p = planner(draft({ Buy: ['Find the button'] })), e = scored(['intent:next', 0.9]);
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { survey: 'headings' });
    const allowed = { intents: ['next', 'activate', 'headings.list'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed }))).toEqual({ action: { kind: 'intent', intent: 'headings.list' } });
    expect(p.requests).toHaveLength(0);
    expect(evidence(policy).find(k => k.kind === 'orchestration-survey')).toMatchObject({ survey: 'headings', step: 1 });
    const listed = 'Headings, 2 items: Shop, level 1; Add to cart, level 2';
    await policy.decide(input({ allowedActions: allowed, context: 'PhoneShop, an online store; a product page', observation: said(listed), history: [{ step: 1, decision: { action: { kind: 'intent', intent: 'headings.list' } }, observation: said('Shop'), execution: { ok: true } }] }));
    expect(p.requests[0]).toMatchObject({ trigger: 'start', speech: [listed], context: 'PhoneShop, an online store; a product page' });
    expect(e.requests[0]!.choices.map(c => c.id)).not.toContain('intent:headings.list');
  });
  it('offers only the task\'s moves (written with or without the action id prefix), keeps activation to activates, and tells the planner where the cursor is', async () => {
    const byHeadings = { ...draft({}), phases: [{ title: 'Find', tasks: [{ goal: 'Jump by headings to Returns', done: 'Hear Returns', cue: 'Returns, heading', activates: false, moves: ['intent:heading.next'] }, { goal: 'Press it', done: 'Hear expanded', cue: 'expanded', activates: true, moves: ['next'] }] }] };
    const p = planner(byHeadings), e = scored(['intent:heading.next', 0.9], ['intent:activate', 0.9]);
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    const allowed = { intents: ['next', 'previous', 'activate', 'heading.next', 'heading.previous'], keys: [], inputKeys: [], replaceText: false };
    await policy.decide(input({ allowedActions: allowed, observation: said('Help center, heading, level 1') }));
    expect(p.requests[0]).toMatchObject({ currentItem: 'Help center, heading, level 1' });
    expect(e.requests[0]!.choices.map(c => c.id)).toEqual(['intent:heading.next']);
    await policy.decide(input({ allowedActions: allowed, observation: said('Returns, heading, level 2'), history: [acted(1, 'heading.next', 'Help center, heading, level 1')] }));
    expect(e.requests[1]!.choices.map(c => c.id)).toEqual(['intent:next', 'intent:activate']);
  });
  it('offers the executor actions only: no "done" claim and no help request', async () => {
    const p = planner(draft({ Find: ['Find the button'] })), e = scored(['intent:next', 0.9], ['intent:next', 0.9], ['intent:next', 0.9], ['intent:next', 0.9]);
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    let history: HistoryEntry[] = [];
    for (let step = 1; step <= 4; step++) { await policy.decide(input({ history })); history = [...history, acted(step, 'next', `item ${step}`)]; }
    expect(e.requests.every(r => r.choices.every(c => c.id.startsWith('intent:')))).toBe(true);
  });
  it('asks the planner whether an item heard in other words is the cue, once per item, and ends the task when it is', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Settings', tasks: [{ goal: 'Move to the order updates checkbox', done: 'Hear it', cue: 'Email notifications for order updates', activates: false }, { goal: 'Check it', done: 'Hear checked', cue: 'checked', activates: true }] }] };
    const p = planner(plan), asked: string[] = [];
    const recognizing: Planner = { plan: p.planner.plan, recognize: async request => { asked.push(request.heard); return { matches: request.heard.startsWith('Order updates'), model: { id: 'planner', runtime: 'test' } }; } };
    const e = executor('intent:next', 'intent:next', 'intent:activate');
    const policy = new OrchestratedSpeechPolicy(recognizing, e.executor);
    const allowed = { intents: ['next', 'previous', 'activate'], keys: [], inputKeys: [], replaceText: false };
    await policy.decide(input({ allowedActions: allowed, observation: said('Notifications, heading, level 2') }));
    await policy.decide(input({ allowedActions: allowed, observation: said('Email notifications, group'), history: [acted(1, 'next', 'Notifications, heading, level 2')] }));
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { goal: 'Move to the order updates checkbox' } });
    const history = [acted(1, 'next', 'Notifications, heading, level 2'), acted(2, 'next', 'Email notifications, group')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Order updates, unchecked, checkbox'), history }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(asked).toEqual(['Email notifications, group', 'Order updates, unchecked, checkbox']);
    expect(e.requests[2]!.state).toMatchObject({ currentTask: { goal: 'Check it' } });
    // A pressing task without moves presses where the moving task ended.
    expect(e.requests[2]!.choices.map(c => c.id)).toEqual(['intent:activate']);
    expect(evidence(policy)).toContainEqual(expect.objectContaining({ kind: 'orchestration-cue', verified: 'recognized', heard: 'Order updates, unchecked, checkbox', source: 'planner' }));
  });
  it('counts only what an action on the task made the reader say, never speech heard before it', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Enter', tasks: [{ goal: 'Activate Skip to content', done: 'Hear the product', cue: 'Samsung galaxy s6', activates: true, moves: ['next'] }, { goal: 'Then', done: 'x', cue: 'x' }] }] };
    const e = executor('intent:activate', 'intent:next');
    const policy = new OrchestratedSpeechPolicy(planner(plan).planner, e.executor);
    const allowed = { intents: ['next', 'activate'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Samsung galaxy s6', 'link, Skip to content') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests[0]!.state).toMatchObject({ currentTask: { goal: 'Activate Skip to content' } });
    await policy.decide(input({ allowedActions: allowed, observation: said('Samsung galaxy s6, heading, level 1'), history: [acted(1, 'activate', 'link, Skip to content')] }));
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { goal: 'Then' } });
  });
  it('follows the plan without an executor model: a pressing task presses, a moving task takes its first move', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Move by headings to the product', done: 'Hear it', cue: { name: 'Galaxy', role: 'heading' }, activates: false, moves: ['heading.next', 'next'] },
      { goal: 'Move to the button', done: 'Hear it', cue: { name: 'Add to cart', role: 'button' }, activates: false, moves: ['next'] }, { goal: 'Press it', done: 'Hear added', cue: 'Added to cart', activates: true }] }] };
    const policy = new OrchestratedSpeechPolicy(planner(plan).planner, 'follow-plan');
    const allowed = { intents: ['next', 'previous', 'activate', 'heading.next'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Shop') }))).toEqual({ action: { kind: 'intent', intent: 'heading.next' } });
    const h1 = [acted(1, 'heading.next', 'Shop')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Galaxy S6, heading, level 1'), history: h1 }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    const h2 = [...h1, acted(2, 'next', 'Galaxy S6, heading, level 1')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Add to cart, button'), history: h2 }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(evidence(policy).filter(k => k.kind === 'orchestration-follow')).toEqual([expect.objectContaining({ choiceId: 'intent:activate' })]);
    expect(() => new OrchestratedSpeechPolicy(planner(plan).planner, 'follow-plan', { taskControl: 'executor' })).toThrow(/task control/);
  });
  it('widens the executor\'s choices with its latitude: the same moves both ways, or every move, pressing as the task says', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Find the button and press it', done: 'Hear added', cue: 'Added to cart', activates: true, moves: ['heading.next'] }] }] };
    const allowed = { intents: ['next', 'previous', 'activate', 'heading.next', 'heading.previous'], keys: [], inputKeys: [], replaceText: false };
    const offered = async (executorLatitude?: 'none' | 'direction' | 'method') => {
      const e = executor('intent:activate');
      await new OrchestratedSpeechPolicy(planner(plan).planner, e.executor, executorLatitude ? { executorLatitude } : {}).decide(input({ allowedActions: allowed, observation: said('Shop') }));
      return e.requests[0]!.choices.map(c => c.id);
    };
    expect(await offered()).toEqual(['intent:activate', 'intent:heading.next']);
    expect(await offered('direction')).toEqual(['intent:activate', 'intent:heading.next', 'intent:heading.previous']);
    expect(await offered('method')).toEqual(['intent:next', 'intent:previous', 'intent:activate', 'intent:heading.next', 'intent:heading.previous']);
  });
  it('lets a task that keeps hearing new items walk past the task limit, and stops one that hears nothing new', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Try headings'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, executor(...Array(8).fill('intent:next')).executor, { stepActionLimit: 3 });
    const walk = Array.from({ length: 6 }, (_, i) => acted(i + 1, 'next', `item ${i}`));
    await policy.decide(input({ observation: said('start') }));
    for (let n = 1; n <= 6; n++) await policy.decide(input({ observation: said(`item ${n}`), history: walk.slice(0, n) }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start']);
  });
  it('asks for a new plan when the cursor swings between the same two items', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Press the item'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, executor('intent:next', 'intent:next', 'intent:next').executor);
    const allowed = { intents: ['next', 'previous', 'activate'], keys: [], inputKeys: [], replaceText: false };
    await policy.decide(input({ allowedActions: allowed, observation: said('Newsletter, unchecked, checkbox') }));
    const history = [acted(1, 'next', 'Newsletter, unchecked, checkbox'), acted(2, 'next', 'Order updates, unchecked, checkbox'), acted(3, 'previous', 'Special offers, unchecked, checkbox'), acted(4, 'next', 'Order updates, unchecked, checkbox')];
    await policy.decide(input({ allowedActions: allowed, observation: said('Special offers, unchecked, checkbox'), history: history.slice(0, 3) }));
    expect(p.requests).toHaveLength(1);
    await policy.decide(input({ allowedActions: allowed, observation: said('Special offers, unchecked, checkbox'), history }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'oscillation']);
  });
  it('finishes a task by itself when its cue is heard, without asking the executor, and goes on to the next', async () => {
    const p = planner(draft({ Find: ['Find the button', 'Activate it'] })), e = scored(['intent:next', 0.9], ['intent:activate', 0.9]);
    const policy = new OrchestratedSpeechPolicy(p.planner, e.executor);
    await policy.decide(input({ observation: said('Quantity, 1') }));
    expect(await policy.decide(input({ observation: said('Find the button, button'), history: [acted(1, 'next', 'Quantity, 1')] }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(e.requests).toHaveLength(2);
    expect(e.requests[1]!.state).toMatchObject({ currentTask: { goal: 'Activate it' } });
    const kinds = evidence(policy);
    expect(kinds.find(k => k.kind === 'orchestration-cue')).toMatchObject({ taskId: 't1', verified: 'heard', source: 'rawstep' });
    expect(kinds.find(k => k.kind === 'orchestration-task' && k.toStatus === 'done')).toMatchObject({ taskId: 't1', ending: { verified: 'heard' } });
  });
  it('asks for a new plan after low-confidence choices in a row, and not after confident ones', async () => {
    const run = async (top: number) => {
      const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Move by headings'] })), e = scored(['intent:next', top]);
      const policy = new OrchestratedSpeechPolicy(p.planner, e.executor, { confidenceFloor: 0.25 });
      let history: HistoryEntry[] = [];
      for (let step = 1; step <= 3; step++) { await policy.decide(input({ history })); history = [...history, acted(step, 'next', `item ${step}`)]; }
      return p.requests.map(r => r.trigger);
    };
    expect(await run(0.1)).toEqual(['start', 'low-confidence']);
    expect(await run(0.8)).toEqual(['start']);
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
        backend, policy: new OrchestratedSpeechPolicy(p.planner, e.executor, EXECUTOR_CLAIMS), outDir: dir, browserSessionFactory: async () => session as never,
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
