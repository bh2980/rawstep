import { describe, expect, it } from 'vitest';
import {
  applyDraft, currentTask, goalWordStretch, matchCue, renderPlanMarkdown, OrchestratedSpeechPolicy, planTasks, plannerDraftSchema, verifyCue,
  type PlanDraft, type PlanRequest, type Planner,
} from '@rawstep/policies/policy';
import type { DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';

const said = (...speech: string[]) => ({ kind: 'screenreader' as const, provenance: 'simulation' as const, speech, outputEventIds: [], window: { id: 'w', startedAt: 's', endedAt: 'e', reason: 'fixture' } });
const input = (over: Partial<Parameters<DecisionPolicy['decide']>[0]> = {}): Parameters<DecisionPolicy['decide']>[0] => ({
  goal: 'Add Thor Hammer to the cart', observation: said('Thor Hammer, heading level 1'), history: [],
  allowedActions: { intents: ['next', 'activate', 'form.next'], keys: [], inputKeys: [], replaceText: false }, inputs: {}, signal: new AbortController().signal, ...over,
});
type DraftTask = PlanDraft['phases'][number]['tasks'][number];
/** A draft with one phase per entry; a task is "goal", ["keep id", goal] or the task's own fields (its `done` quotes the goal, which is also its cue). Without `moves` or `activates` Rawstep takes `next`. */
const draft = (phases: Record<string, (string | [string, string] | (Partial<DraftTask> & { goal: string }))[]>, rationale = '', extra: Partial<PlanDraft> = {}): PlanDraft => ({ complete: false, rationale,
  strategy: 'Find the button and press it', criteria: [{ id: 'C1', text: 'The cart confirms the item' }], assumptions: [{ id: 'A1', text: 'The button follows the quantity field' }], ...extra,
  phases: Object.entries(phases).map(([title, tasks]) => ({ title, tasks: tasks.map(t => typeof t === 'string' ? { goal: t, done: `Hear "${t}"` } : Array.isArray(t) ? { keep: t[0], goal: t[1], done: `Hear "${t[1]}"` } : { done: `Hear "${t.goal}"`, ...t }) })) });
function planner(...drafts: PlanDraft[]) {
  const requests: PlanRequest[] = [];
  const value: Planner = { plan: async request => { requests.push(structuredClone(request)); return { draft: drafts[Math.min(requests.length - 1, drafts.length - 1)]!, model: { id: 'planner', runtime: 'test' }, prompt: { id: 'rawstep-planner', version: 'v', sha256: 'x' } }; } };
  return { planner: value, requests };
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
    const v2 = applyDraft(v1, draft({ Find: [['t1', 'Hear the title'], 'Move by form controls'], Buy: [['t3', 'Activate it']] }, 'The button never came up.'), { goal: 'g', step: 12, trigger: 'no-change' });
    expect(planTasks(v2).map(t => [t.id, t.status])).toEqual([['t1', 'done'], ['t4', 'active'], ['t3', 'pending']]);
    expect(v2.retired).toEqual([expect.objectContaining({ id: 't2', status: 'abandoned', actions: 9, phase: 'Find', ending: { reason: 'replaced', step: 12 } })]);
    expect(v2.revisions[1]).toEqual({ version: 2, step: 12, trigger: 'no-change', rationale: 'The button never came up.', added: ['t4'], abandoned: ['t2'], broken: [], met: [] });
    expect(planTasks(v2).map(t => t.number)).toEqual(['1.1', '1.2', '2.1']);
  });
  it('tracks success criteria and assumptions by id, and records which turned out met or wrong', () => {
    const v1 = applyDraft(undefined, draft({ Find: ['Find it'] }), { goal: 'g', step: 1, trigger: 'start' });
    const v2 = applyDraft(v1, draft({ Find: ['Use headings'] }, 'A1 was wrong.', { assumptions: [{ id: 'A1', text: 'The button follows the quantity field', status: 'broken' }, { id: 'A2', text: 'Headings mark sections' }] }), { goal: 'g', step: 5, trigger: 'no-change' });
    expect(v2.assumptions).toEqual([{ id: 'A1', text: 'The button follows the quantity field', status: 'broken', addedIn: 1, settledIn: 2 }, { id: 'A2', text: 'Headings mark sections', status: 'open', addedIn: 2 }]);
    expect(v2.revisions[1]).toMatchObject({ broken: ['A1'], met: [] });
    const v3 = applyDraft(v2, draft({ Find: ['Use headings'] }, '', { criteria: [{ id: 'C1', text: 'The cart confirms the item', status: 'met' }], assumptions: [{ id: 'A1', text: 'x', status: 'open' }] }), { goal: 'g', step: 9, trigger: 'checkpoint' });
    expect(v3.assumptions[0]).toMatchObject({ status: 'broken' });
    expect(v3.revisions[2]).toMatchObject({ met: ['C1'] });
    expect(renderPlanMarkdown(v3)).toMatch(/## Success criteria\n\n- ✓ C1 The cart confirms the item[\s\S]*- ✕ A1[\s\S]*- \[~\] 1\.1 Use headings[\s\S]*← current[\s\S]*- v2 before step 5 · no-change · broken A1 — A1 was wrong\./);
  });
  it('keeps settled assumptions the planner leaves out, and drops settled ones before failing a draft over the limit', () => {
    const v1 = applyDraft(undefined, draft({ Find: ['Find it'] }, '', { assumptions: [{ id: 'A1', text: 'Cart is in the header' }, { id: 'A2', text: 'The item is a link' }] }), { goal: 'g', step: 1, trigger: 'start' });
    const v2 = applyDraft(v1, draft({ Find: ['Find it'] }, '', { assumptions: [{ id: 'A1', text: 'Cart is in the header', status: 'held' }, { id: 'A2', text: 'The item is a link', status: 'broken' }] }), { goal: 'g', step: 5, trigger: 'checkpoint' });
    // The next draft lists only what the plan still relies on.
    const v3 = applyDraft(v2, draft({ Find: ['Use headings'] }, '', { assumptions: [{ id: 'A3', text: 'Headings mark products' }] }), { goal: 'g', step: 9, trigger: 'no-change' });
    expect(v3.assumptions.map(a => [a.id, a.status])).toEqual([['A3', 'open'], ['A1', 'held'], ['A2', 'broken']]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `A${i + 1}`, text: `Assumption ${i + 1}`, ...(i < 4 ? { status: 'held' } : {}) }));
    const over = draft({ Find: ['Find it'] }, '', { assumptions: many as PlanDraft['assumptions'] });
    over.phases[0]!.tasks[0] = { ...over.phases[0]!.tasks[0]!, cue: 'it', relies: ['A1'] };
    // A1 is relied on, so A2 and A3 (settled, oldest) go; the open ones stay.
    expect(plannerDraftSchema.parse(over).assumptions.map(a => a.id)).toEqual(['A1', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12']);
  });
  it('tells a cue the way a listener would: role and state first, then all name words, else worth asking', () => {
    const button = { cue: 'Add to cart', cueRole: 'button' as const };
    expect(matchCue(button, 'Add to cart, button')).toBe('heard');
    expect(matchCue({ cue: 'cart', cueRole: 'button' }, 'Cart (0), link')).toBe('no');
    expect(matchCue({ cue: 'cart', cueRole: 'link' }, 'link, Cart (0)')).toBe('heard');
    // Exactly the name in another role than the planner guessed: a listener stops there, so the planner is asked.
    expect(matchCue({ cue: 'Kimchi Fried Rice', cueRole: 'heading' }, 'Kimchi Fried Rice')).toBe('candidate');
    expect(matchCue({ cue: 'Kimchi Fried Rice', cueRole: 'heading' }, 'Add Kimchi Fried Rice to cart, button')).toBe('no');
    // Part of the name with nothing against it is worth asking; a name with words the cue lacks is another item.
    expect(matchCue({ cue: 'Add Kimchi Fried Rice', cueRole: 'button' }, 'Add, button')).toBe('candidate');
    expect(matchCue({ cue: 'Add Kimchi Fried Rice', cueRole: 'button' }, 'Add Sikhye to cart, button')).toBe('no');
    expect(matchCue({ cue: 'Kimchi Fried Rice' }, 'Kimchi Fried Rice (Spicy), 9,000 won.')).toBe('candidate');
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
    // Exactly the name, in another role: worth asking. With other words as well, another role is not it.
    expect(matchCue({ cue: 'days', cueRole: 'text' }, 'Days, heading, level 2')).toBe('candidate');
    expect(matchCue({ cue: 'days', cueRole: 'text' }, 'Delivery days, heading, level 2')).toBe('no');
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
    // A rotor list's name is said apart from its first item, so a cue for the list (as plain text) is heard.
    expect(verifyCue({ done: 'The rotor opens', cue: 'Form controls', cueRole: 'text' }, ['Form controls, 73 items', 'Sign up, button'])).toBe('heard');
  });
});

describe('orchestrated speech policy', () => {
  it('plans with the real actions, then carries out the current task with its first move and records how it chose', async () => {
    const p = planner(draft({ Find: [{ goal: 'Move to Add to cart', moves: ['form.next'] }], Buy: ['Activate it'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'form.next' } });
    expect(p.requests[0]).toMatchObject({ trigger: 'start', attempts: [] });
    expect(p.requests[0]!.actions.map(a => a.id)).toEqual(['intent:next', 'intent:activate', 'intent:form.next']);
    const kinds = evidence(policy);
    expect(kinds.map(k => k.kind)).toEqual(['orchestration-plan', 'orchestration-task', 'orchestration-follow']);
    expect(kinds[0]).toMatchObject({ role: 'planner', version: 1, prompt: { id: 'rawstep-planner' } });
    expect(kinds[2]).toMatchObject({ taskId: 't1', planVersion: 1, choiceId: 'intent:form.next', choices: [{ id: 'intent:next' }, { id: 'intent:activate' }, { id: 'intent:form.next' }] });
    expect(kinds.map(k => k.kind)).not.toContain('model-inference');
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ status: 'active', actions: 1 });
  });
  it('ends a task when its cue is heard after an action, reviews the finished phase, and moves on within the same runner step', async () => {
    const p = planner(draft({ Find: ['Find the button'], Buy: [{ goal: 'Activate it', activates: true }] }), draft({ Find: [['t1', 'Find the button']], Buy: [{ keep: 't2', goal: 'Activate it', activates: true }] }, 'Phase 1 met C1.'));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ observation: said('Find the button'), history: [acted(1, 'next', 'Thor Hammer, heading level 1')] }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    const done = evidence(policy).find(k => k.kind === 'orchestration-task' && k.toStatus === 'done');
    expect(done).toMatchObject({ taskId: 't1', fromStatus: 'active', ending: { reason: 'done', step: 2, verified: 'heard' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'checkpoint']);
    const doc = policy.planDocument()!;
    expect(doc).toMatchObject({ version: 2, current: 't2' }); expect(doc.phases[0]!.checkpoint).toEqual({ version: 2, step: 2 });
  });
  it('asks for a new plan after failed actions, with the attempts linked to their tasks', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Move by form controls'] }, 'Both moves failed.'));
    // (one phase, so no checkpoint call in between)
    const policy = new OrchestratedSpeechPolicy(p.planner);
    await policy.decide(input());
    await policy.decide(input({ history: [acted(1, 'next', 'Banner', false)], observation: said('Logo') }));
    await policy.decide(input({ history: [acted(1, 'next', 'Banner', false), acted(2, 'next', 'Logo', false)], observation: said('Search') }));
    expect(p.requests[1]).toMatchObject({ trigger: 'failures', document: { version: 1 } });
    expect(p.requests[1]!.attempts.map(a => [a.step, a.taskId, a.planVersion])).toEqual([[1, 't1', 1], [2, 't1', 1]]);
    const doc = policy.planDocument()!;
    expect(doc).toMatchObject({ version: 2, current: 't2', retired: [{ id: 't1', status: 'abandoned', actions: 2 }] });
    expect(doc.revisions[1]).toMatchObject({ trigger: 'failures', rationale: 'Both moves failed.' });
  });
  it('gives the planner only the last plannerHistoryLimit attempts', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Move by form controls'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { plannerHistoryLimit: 2, failureLimit: 3 });
    const failed = [acted(1, 'next', 'Banner', false), acted(2, 'next', 'Logo', false), acted(3, 'next', 'Search', false)];
    await policy.decide(input());
    await policy.decide(input({ history: failed.slice(0, 1), observation: said('Logo') }));
    await policy.decide(input({ history: failed.slice(0, 2), observation: said('Search') }));
    await policy.decide(input({ history: failed, observation: said('Menu') }));
    expect(p.requests[1]!.trigger).toBe('failures');
    expect(p.requests[1]!.attempts.map(a => a.step)).toEqual([2, 3]);
  });
  it('replans after repeated failures or no change on the current task', async () => {
    const failing = planner(draft({ Type: [{ goal: 'Press the search field', activates: true }] }), draft({ Type: ['Find the field first'] }));
    const p1 = new OrchestratedSpeechPolicy(failing.planner);
    await p1.decide(input());
    await p1.decide(input({ history: [acted(1, 'activate', 'Search, heading', false)] }));
    await p1.decide(input({ history: [acted(1, 'activate', 'Search, heading', false), acted(2, 'activate', 'Search, heading', false)] }));
    expect(failing.requests.map(r => r.trigger)).toEqual(['start', 'failures']);
    const still = planner(draft({ Cart: ['Find the cart'] }), draft({ Cart: ['Use headings'] }));
    const p2 = new OrchestratedSpeechPolicy(still.planner);
    const h = [acted(1, 'next', 'Banner'), acted(2, 'activate', 'Banner'), acted(3, 'next', 'Banner')];
    await p2.decide(input());
    for (let i = 1; i <= 3; i++) await p2.decide(input({ history: h.slice(0, i), observation: said('Banner') }));
    expect(still.requests.map(r => r.trigger)).toEqual(['start', 'no-change']);
  });
  it('lets a fresh plan run before the repetition guard can stop it', async () => {
    const p = planner(draft({ Cart: ['Find the cart'] }), draft({ Cart: ['Try next'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { repetitionGuard: true, maxUnchangedTransitions: 4, noChangeLimit: 3 });
    const h = [1, 2, 3, 4].map(i => acted(i, 'next', 'End of content'));
    await policy.decide(input());
    for (let i = 1; i <= 3; i++) await policy.decide(input({ history: h.slice(0, i), observation: said('End of content') }));
    expect(await policy.decide(input({ history: h, observation: said('End of content') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
  });
  it('hands repeated speech to the planner while planner calls remain, and ends the run unmeasured after that', async () => {
    const h = [1, 2, 3].map(i => acted(i, 'next', 'End of content'));
    const p = planner(draft({ Read: ['Read the answer'] }), draft({ Read: ['Go back and open the question'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { repetitionGuard: true, maxUnchangedTransitions: 2, noChangeLimit: 5 });
    await policy.decide(input());
    expect(await policy.decide(input({ history: h, observation: said('End of content') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'no-change']);
    const last = new OrchestratedSpeechPolicy(planner(draft({ Read: ['Read the answer'] })).planner, { repetitionGuard: true, maxUnchangedTransitions: 2, noChangeLimit: 5, maxPlannerCalls: 1 });
    await last.decide(input());
    expect(await last.decide(input({ history: h, observation: said('End of content') }))).toEqual({ stop: 'uncertain', stopSource: 'orchestration-limit' });
  });
  it('stops with its own stop sources: the planner judging the goal done, or the planner calls running out (unmeasured)', async () => {
    const p = planner(draft({ Any: ['Anything'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { maxPlannerCalls: 2, stepActionLimit: 1 });
    // Every action lands on the same item: nothing new is heard, so each task runs out after one stale action.
    const same = 'Thor Hammer, heading level 1', at = (n: number) => Array.from({ length: n }, (_, i) => acted(i + 1, 'next', same));
    expect(await policy.decide(input())).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: at(1) }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: at(2) }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'task-limit']);
    expect(await policy.decide(input({ history: at(3) }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(await policy.decide(input({ history: at(4) }))).toEqual({ stop: 'uncertain', stopSource: 'orchestration-limit' });
    expect(evidence(policy).some(k => k.kind === 'orchestration-limit')).toBe(true);
    expect(currentTask(policy.planDocument()!)).toMatchObject({ status: 'failed' });
    const done = new OrchestratedSpeechPolicy(planner({ ...draft({}), complete: true, rationale: 'Already in the cart.' }).planner);
    expect(await done.decide(input())).toEqual({ stop: 'success', stopSource: 'planner' });
  });
  it('ends the run unmeasured when none of the actions a task needs is allowed', async () => {
    const p = planner(draft({ Buy: [{ goal: 'Press it', activates: true }] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    const noPress = { intents: ['next'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: noPress }))).toEqual({ stop: 'uncertain', stopSource: 'orchestration-limit' });
    expect(evidence(policy).some(k => k.kind === 'orchestration-follow')).toBe(false);
  });
  it('does not end a task on a "done" it was never shown: the cue must be heard after an action on it', async () => {
    const p = planner({ ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Activate Add to cart', done: 'The cart confirms', cue: 'Added to cart', activates: true }] }] });
    const policy = new OrchestratedSpeechPolicy(p.planner);
    // The cue is already heard before any action on the task: that is the page's doing, not the task's.
    expect(await policy.decide(input({ observation: said('Added to cart') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(p.requests).toHaveLength(1);
    expect(evidence(policy).map(k => k.kind)).not.toContain('orchestration-cue');
    expect(policy.planDocument()!.phases[0]!.tasks[0]).toMatchObject({ status: 'active', actions: 1 });
  });
  it('asks for the next plan when every task is finished', async () => {
    const p = planner(draft({ Only: ['Only task'] }), draft({ Check: ['Check the cart'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    await policy.decide(input());
    await policy.decide(input({ observation: said('Only task'), history: [acted(1, 'next', 'Thor Hammer, heading level 1')] }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'plan-finished']);
    expect(p.requests[1]!.document!.phases[0]!.tasks[0]).toMatchObject({ status: 'done', ending: { verified: 'heard' } });
  });
});

describe('orchestrated speech policy carrying out the plan', () => {
  it('plans with actions in plain words and tells the planner the item the cursor is on, and keeps it when an action said nothing', async () => {
    const p = planner(draft({ Buy: [{ goal: 'Press it', activates: true }] }), draft({ Buy: ['Look again'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { failureLimit: 1 });
    await policy.decide(input({ observation: said('Add to cart, button') }));
    expect(p.requests[0]!.actions.map(a => a.label)).toEqual(['Move to the next item', 'Activate the current item', 'Jump to the next form control']);
    expect(p.requests[0]).toMatchObject({ currentItem: 'Add to cart, button' });
    // An activation that failed and said nothing leaves the item it was on as the current one.
    await policy.decide(input({ observation: said(), history: [{ step: 1, decision: { action: { kind: 'intent', intent: 'activate' } }, observation: said('Add to cart, button'), execution: { ok: false, failure: 'backend' } }] }));
    expect(p.requests[1]).toMatchObject({ trigger: 'failures', currentItem: 'Add to cart, button' });
  });
  it('takes only moves on a task that only moves, and presses on the task that presses', async () => {
    const moving = { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Move to the button', done: 'Hear it', cue: 'Add to cart', activates: false }, { goal: 'Press it', done: 'Hear added', cue: 'Added', activates: true }] }] };
    const policy = new OrchestratedSpeechPolicy(planner(moving).planner);
    const followed = () => evidence(policy).filter(k => k.kind === 'orchestration-follow').map(k => [k.taskId, k.choiceId]);
    expect(await policy.decide(input({ observation: said('Phones, link') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(followed()).toEqual([['t1', 'intent:next']]);
    expect(await policy.decide(input({ observation: said('Add to cart, button'), history: [acted(1, 'next', 'Phones, link')] }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(followed()).toEqual([['t2', 'intent:activate']]);
  });
  it('surveys the headings as the first action before planning, plans from what it said, and never follows into the survey', async () => {
    const p = planner(draft({ Buy: ['Find the button'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { survey: 'headings' });
    const allowed = { intents: ['next', 'activate', 'headings.list'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed }))).toEqual({ action: { kind: 'intent', intent: 'headings.list' } });
    expect(p.requests).toHaveLength(0);
    expect(evidence(policy).find(k => k.kind === 'orchestration-survey')).toMatchObject({ survey: 'headings', step: 1 });
    const listed = 'Headings, 2 items: Shop, level 1; Add to cart, level 2';
    expect(await policy.decide(input({ allowedActions: allowed, context: 'PhoneShop, an online store; a product page', observation: said(listed), history: [{ step: 1, decision: { action: { kind: 'intent', intent: 'headings.list' } }, observation: said('Shop'), execution: { ok: true } }] }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(p.requests[0]).toMatchObject({ trigger: 'start', speech: [listed], context: 'PhoneShop, an online store; a product page' });
    const follow = evidence(policy).find(k => k.kind === 'orchestration-follow')!;
    expect((follow.choices as { id: string }[]).map(c => c.id)).toEqual(['intent:next', 'intent:activate']);
  });
  it('takes the task\'s first move (written with or without the action id prefix), presses only when the task activates, and tells the planner where the cursor is', async () => {
    const byHeadings = { ...draft({}), phases: [{ title: 'Find', tasks: [{ goal: 'Jump by headings to Returns', done: 'Hear Returns', cue: 'Returns, heading', activates: false, moves: ['intent:heading.next'] }, { goal: 'Press it', done: 'Hear expanded', cue: 'expanded', activates: true, moves: ['next'] }] }] };
    const p = planner(byHeadings);
    const policy = new OrchestratedSpeechPolicy(p.planner);
    const allowed = { intents: ['next', 'previous', 'activate', 'heading.next', 'heading.previous'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Help center, heading, level 1') }))).toEqual({ action: { kind: 'intent', intent: 'heading.next' } });
    expect(p.requests[0]).toMatchObject({ currentItem: 'Help center, heading, level 1' });
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Returns, heading, level 2'), history: [acted(1, 'heading.next', 'Help center, heading, level 1')] }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
  });
  it('asks the planner whether an item heard in other words is the cue, once per item, and ends the task when it is', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Settings', tasks: [{ goal: 'Move to the order updates checkbox', done: 'Hear it', cue: 'Email notifications for order updates', activates: false }, { goal: 'Check it', done: 'Hear checked', cue: 'checked', activates: true }] }] };
    const p = planner(plan), asked: string[] = [];
    const recognizing: Planner = { plan: p.planner.plan, recognize: async request => { asked.push(request.heard); return { matches: request.heard.startsWith('Order updates'), model: { id: 'planner', runtime: 'test' } }; } };
    const policy = new OrchestratedSpeechPolicy(recognizing);
    const allowed = { intents: ['next', 'previous', 'activate'], keys: [], inputKeys: [], replaceText: false };
    await policy.decide(input({ allowedActions: allowed, observation: said('Notifications, heading, level 2') }));
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Email notifications, group'), history: [acted(1, 'next', 'Notifications, heading, level 2')] }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(currentTask(policy.planDocument()!)).toMatchObject({ goal: 'Move to the order updates checkbox' });
    const history = [acted(1, 'next', 'Notifications, heading, level 2'), acted(2, 'next', 'Email notifications, group')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Order updates, unchecked, checkbox'), history }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(asked).toEqual(['Email notifications, group', 'Order updates, unchecked, checkbox']);
    // The pressing task presses where the moving task ended.
    const found = evidence(policy);
    expect(found).toContainEqual(expect.objectContaining({ kind: 'orchestration-cue', verified: 'recognized', heard: 'Order updates, unchecked, checkbox', source: 'planner' }));
    expect(found).toContainEqual(expect.objectContaining({ kind: 'orchestration-follow', taskId: 't2', choiceId: 'intent:activate' }));
  });
  it('counts only what an action on the task made the reader say, never speech heard before it', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Enter', tasks: [{ goal: 'Activate Skip to content', done: 'Hear the product', cue: 'Samsung galaxy s6', activates: true, moves: ['next'] }, { goal: 'Then', done: 'x', cue: 'x' }] }] };
    const policy = new OrchestratedSpeechPolicy(planner(plan).planner);
    const allowed = { intents: ['next', 'activate'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Samsung galaxy s6', 'link, Skip to content') }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(currentTask(policy.planDocument()!)).toMatchObject({ goal: 'Activate Skip to content' });
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Samsung galaxy s6, heading, level 1'), history: [acted(1, 'activate', 'link, Skip to content')] }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(currentTask(policy.planDocument()!)).toMatchObject({ goal: 'Then' });
  });
  it('carries out the plan as written: a pressing task presses, a moving task takes its first move', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Move by headings to the product', done: 'Hear it', cue: { name: 'Galaxy', role: 'heading' }, activates: false, moves: ['heading.next', 'next'] },
      { goal: 'Move to the button', done: 'Hear it', cue: { name: 'Add to cart', role: 'button' }, activates: false, moves: ['next'] }, { goal: 'Press it', done: 'Hear added', cue: 'Added to cart', activates: true }] }] };
    const policy = new OrchestratedSpeechPolicy(planner(plan).planner);
    const allowed = { intents: ['next', 'previous', 'activate', 'heading.next'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Shop') }))).toEqual({ action: { kind: 'intent', intent: 'heading.next' } });
    const h1 = [acted(1, 'heading.next', 'Shop')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Galaxy S6, heading, level 1'), history: h1 }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    const h2 = [...h1, acted(2, 'next', 'Galaxy S6, heading, level 1')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Add to cart, button'), history: h2 }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(evidence(policy).filter(k => k.kind === 'orchestration-follow')).toEqual([expect.objectContaining({ choiceId: 'intent:activate' })]);
  });
  it('types a named input when the plan says so: presses the field, types, and only then moves on', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Search', tasks: [{ goal: 'Move to the search field', done: 'Hear it', cue: { name: 'Search', role: 'text field' }, activates: false, moves: ['form.next'] },
      { goal: 'Type the search words', done: 'The words are typed', cue: { name: 'Search', role: 'text field' }, types: 'type:query' }, { goal: 'Then', done: 'x', cue: 'x' }] }] };
    const p = planner(plan);
    const policy = new OrchestratedSpeechPolicy(p.planner);
    const allowed = { intents: ['next', 'activate', 'form.next'], keys: [], inputKeys: ['query'], typeText: true, replaceText: false };
    const typed = (step: number, speech: string, ok = true): HistoryEntry => ({ step, decision: { action: { kind: 'typeText', input: 'query' } }, observation: said(speech), execution: ok ? { ok: true } : { ok: false, failure: 'backend' } });
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Shop') }))).toEqual({ action: { kind: 'intent', intent: 'form.next' } });
    const h1 = [acted(1, 'form.next', 'Shop')];
    // The field's name is heard on pressing it: that is not the typing, so the task goes on to type.
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Search, search text field'), history: h1 }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    const h2 = [...h1, acted(2, 'activate', 'Search, search text field')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Search, search text field'), history: h2 }))).toEqual({ action: { kind: 'typeText', input: 'query' } });
    // A typing that failed is tried again; one that ran ends the task.
    const h3 = [...h2, typed(3, 'Search, search text field', false)];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Search, search text field'), history: h3 }))).toEqual({ action: { kind: 'typeText', input: 'query' } });
    const h4 = [...h3, typed(4, 'Search, search text field')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Search, search text field, Thor Hammer'), history: h4 }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(policy.planDocument()!.phases[0]!.tasks.map(t => [t.status, t.types ?? '-'])).toEqual([['done', '-'], ['done', 'query'], ['active', '-']]);
    expect(renderPlanMarkdown(policy.planDocument()!)).toContain('· types query');
  });
  it('opens the rotor list once per task and then moves through it, even when the task names only the opening', async () => {
    const plan = { ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Open the form controls rotor and find buy now', done: 'Hear it', cue: { name: 'Buy now', role: 'button' }, activates: false, moves: ['formControls.rotor'] }] }] };
    const policy = new OrchestratedSpeechPolicy(planner(plan).planner);
    const allowed = { intents: ['next', 'previous', 'activate', 'formControls.rotor'], keys: [], inputKeys: [], replaceText: false };
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Shop') }))).toEqual({ action: { kind: 'intent', intent: 'formControls.rotor' } });
    const h1 = [acted(1, 'formControls.rotor', 'Shop')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Form controls, 3 items. Search, button'), history: h1 }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    const h2 = [...h1, acted(2, 'next', 'Form controls, 3 items. Search, button')];
    expect(await policy.decide(input({ allowedActions: allowed, observation: said('Gift, button'), history: h2 }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
  });
  it('lets a task that keeps hearing new items walk past the task limit, and stops one that hears nothing new', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Try headings'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { stepActionLimit: 3 });
    const walk = Array.from({ length: 6 }, (_, i) => acted(i + 1, 'next', `item ${i}`));
    await policy.decide(input({ observation: said('start') }));
    for (let n = 1; n <= 6; n++) await policy.decide(input({ observation: said(`item ${n}`), history: walk.slice(0, n) }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start']);
  });
  it('tells the planner, once, when an item named as in the goal is heard while the task is after something else', async () => {
    const p = planner(draft({ Order: ['Move to the Add Kimchi Fried Rice button'] }), draft({ Order: ['Move to the Add button'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    const goal = 'Add one Kimchi Fried Rice to the cart.';
    // Each history entry holds what was heard before that action, as the runner records it.
    const walk = [acted(1, 'next', 'Hanok Kitchen'), acted(2, 'next', 'Fried rice and kimbap'), acted(3, 'next', 'Kimchi Fried Rice')];
    await policy.decide(input({ goal, observation: said('Hanok Kitchen') }));
    await policy.decide(input({ goal, observation: said('Fried rice and kimbap'), history: walk.slice(0, 1) }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start']);
    await policy.decide(input({ goal, observation: said('Kimchi Fried Rice'), history: walk.slice(0, 2) }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'goal-heard']);
    expect(p.requests[1]!.currentItem).toBe('Kimchi Fried Rice');
  });
  it('ends the run when the user gives up on approaches that failed, and asks again when the give-up names none', async () => {
    const goal = 'Add Thor Hammer to the cart.';
    const giveUp = (tried: string[], assumptions: PlanDraft['assumptions']): PlanDraft => ({ ...draft({}, 'Nothing left to try.', { assumptions }), phases: [], giveUp: { reason: 'No add button anywhere', tried } });
    const failed = [{ id: 'A1', text: 'The add button follows the price', status: 'broken' as const }];
    const p = planner(draft({ Find: ['Walk to the button'] }), giveUp(['A1'], failed));
    const policy = new OrchestratedSpeechPolicy(p.planner, { stepActionLimit: 1 });
    await policy.decide(input({ goal }));
    const stale = [acted(1, 'next', 'Thor Hammer'), acted(2, 'next', 'Thor Hammer')];
    expect(await policy.decide(input({ goal, history: stale, observation: said('Thor Hammer') }))).toEqual({ stop: 'stuck', stopSource: 'user-gave-up' });
    expect(evidence(policy).find(k => k.kind === 'orchestration-give-up')).toMatchObject({ accepted: true, tried: ['A1'], effort: { moves: 2 } });
    expect(policy.planDocument()!.revisions.at(-1)).toMatchObject({ giveUp: { tried: ['A1'] } });
    // Giving up on a hunch (no broken assumption) is refused: the planner is asked again and the run goes on.
    const q = planner(draft({ Find: ['Walk to the button'] }), giveUp([], []), draft({ Find: ['Try the headings'] }));
    const stubborn = new OrchestratedSpeechPolicy(q.planner, { stepActionLimit: 1 });
    await stubborn.decide(input({ goal }));
    expect(await stubborn.decide(input({ goal, history: stale, observation: said('Thor Hammer') }))).toEqual({ action: { kind: 'intent', intent: 'next' } });
    expect(q.requests.map(r => r.refusedGiveUp)).toEqual([undefined, undefined, 'it names no approach that was tried and failed']);
    expect(evidence(stubborn).find(k => k.kind === 'orchestration-give-up')).toMatchObject({ accepted: false });
  });
  it('lets the user take stock after many moves, telling the planner the effort spent and the moves without a word of the goal', async () => {
    const goal = 'Add Thor Hammer to the cart.';
    const p = planner(draft({ Find: ['Walk to the button'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner, { reviewEvery: 4 });
    await policy.decide(input({ goal }));
    // Each entry holds what was heard before its move: after the first move the user hears Rubber Mallet, and so on.
    const items = ['Toolshop', 'Rubber Mallet', 'Hacksaw', 'Level', 'Stud Finder'], walk = items.slice(0, 4).map((item, i) => acted(i + 1, 'next', item));
    for (let n = 1; n <= 4; n++) await policy.decide(input({ goal, history: walk.slice(0, n), observation: said(items[n]!) }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'effort-review']);
    expect(p.requests[1]!.effort).toEqual({ moves: 4, sinceLastLook: 4, withoutGoalWords: 4, longestWithoutGoalWords: 4 });
    expect(goalWordStretch(goal, ['Rubber Mallet', 'Thor Hammer', 'Hacksaw', 'Level', 'Cart'])).toEqual({ current: 0, longest: 2 });
  });
  it('does not tell the planner again when walking back past a goal item heard earlier in the run', async () => {
    const p = planner(draft({ Cart: ['Move back to the Cart link'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    const goal = 'Add one Kimchi Fried Rice to the cart, then open the cart.';
    await policy.decide(input({ goal, observation: said('Hanok Kitchen') }));
    // Already heard at step 2 (the item that was added); hearing it again on the way back is not news.
    const history = [acted(1, 'next', 'Hanok Kitchen'), acted(2, 'next', 'Kimchi Fried Rice'), acted(3, 'next', 'Fried rice and kimbap')];
    await policy.decide(input({ goal, observation: said('Kimchi Fried Rice'), history }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start']);
  });
  it('asks for a new plan when the cursor swings between the same two items', async () => {
    const p = planner(draft({ Find: ['Find the button'] }), draft({ Find: ['Press the item'] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    const allowed = { intents: ['next', 'previous', 'activate'], keys: [], inputKeys: [], replaceText: false };
    await policy.decide(input({ allowedActions: allowed, observation: said('Newsletter, unchecked, checkbox') }));
    const history = [acted(1, 'next', 'Newsletter, unchecked, checkbox'), acted(2, 'next', 'Order updates, unchecked, checkbox'), acted(3, 'previous', 'Special offers, unchecked, checkbox'), acted(4, 'next', 'Order updates, unchecked, checkbox')];
    await policy.decide(input({ allowedActions: allowed, observation: said('Special offers, unchecked, checkbox'), history: history.slice(0, 3) }));
    expect(p.requests).toHaveLength(1);
    await policy.decide(input({ allowedActions: allowed, observation: said('Special offers, unchecked, checkbox'), history }));
    expect(p.requests.map(r => r.trigger)).toEqual(['start', 'oscillation']);
  });
  it('finishes a task by itself when its cue is heard, and goes on to the next', async () => {
    const p = planner(draft({ Find: ['Find the button', { goal: 'Activate it', activates: true }] }));
    const policy = new OrchestratedSpeechPolicy(p.planner);
    await policy.decide(input({ observation: said('Quantity, 1') }));
    expect(await policy.decide(input({ observation: said('Find the button, button'), history: [acted(1, 'next', 'Quantity, 1')] }))).toEqual({ action: { kind: 'intent', intent: 'activate' } });
    expect(currentTask(policy.planDocument()!)).toMatchObject({ goal: 'Activate it', actions: 1 });
    const kinds = evidence(policy);
    expect(kinds.find(k => k.kind === 'orchestration-cue')).toMatchObject({ taskId: 't1', verified: 'heard', source: 'rawstep' });
    expect(kinds.find(k => k.kind === 'orchestration-task' && k.toStatus === 'done')).toMatchObject({ taskId: 't1', ending: { verified: 'heard' } });
    expect(kinds.find(k => k.kind === 'orchestration-follow')).toMatchObject({ taskId: 't2', choiceId: 'intent:activate' });
  });
});

describe('orchestrated policy inside the runner', () => {
  it('records the plan, task changes and followed actions as policy evidence while the runner verifies', async () => {
    const { mkdtemp, rm, readFile } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
    const { runTask } = await import('@rawstep/browser/runner');
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-orchestration-'));
    try {
      let pressed = 0;
      const backend = { evidenceProvenance: 'simulation' as const, capabilities: { intents: ['next', 'activate'], keys: [], textEntry: false, replaceText: false },
        start: async () => ({}), execute: async () => { pressed++; return {}; }, close: async () => {}, subscribe: () => () => {},
        observe: async () => ({ windowId: 'w', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T00:00:01Z', reason: 'fixture', outputs: [], speech: [pressed ? 'Added to cart' : 'Add to cart, button'] }) };
      const session = { page: { bringToFront: async () => {} }, browser: { version: () => 'fake' }, takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: async () => {} };
      const p = planner({ ...draft({}), phases: [{ title: 'Buy', tasks: [{ goal: 'Activate Add to cart', done: 'The cart confirms', cue: 'Added to cart', activates: true }] }] });
      const trace = await runTask({ url: 'https://example.test', goal: 'Add to cart', verify: { all: [{ titleIncludes: 'Done' }] } }, {
        backend, policy: new OrchestratedSpeechPolicy(p.planner), outDir: dir, browserSessionFactory: async () => session as never,
        verifier: async () => ({ passed: pressed > 0, failures: pressed > 0 ? [] : ['not yet'] }) });
      expect(trace.outcome?.status).toBe('success');
      const kinds = trace.events.filter(ev => ev.type === 'policy.evidence').map(ev => (ev.data as { evidence: { kind: string } }).evidence.kind);
      expect(kinds).toEqual(['orchestration-plan', 'orchestration-task', 'orchestration-follow']);
      expect(await readFile(join(dir, 'trace.json'), 'utf8')).toContain('Activate Add to cart');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
