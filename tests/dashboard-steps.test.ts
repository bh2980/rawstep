import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@rawstep/core/trace';
import { buildPlan, buildSteps, eventSteps } from '../packages/dashboard/src/server/steps.js';

type Pair = readonly [type: string, data: Record<string, unknown>, redacted?: boolean];
const events = (pairs: readonly Pair[]): TraceEvent[] => pairs.map(([type, data, redacted], i) => ({
  id: 'e' + (i + 1), seq: i + 1, timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, type, source: 'runner', data, redacted: redacted ?? false,
}));
const build = (pairs: readonly Pair[], options: Partial<Parameters<typeof buildSteps>[0]> = {}) => buildSteps({ experimentId: 'x', runId: 'r', events: events(pairs), live: false, ...options });
/** A diagnostic screenshot the runner saved after a step, for people reading the run. */
const shot = (step: number, path = `diagnostics/step-${step}.png`): Pair => ['browser.screenshot', { step, path, policyVisible: false }];

describe('dashboard step view', () => {
  it('folds a run into steps with actions, results, screenshots, the actions Rawstep chose among, changes and verification', () => {
    const view = build([
      shot(0),
      ['observer.focus', { kind: 'focus', step: 0, role: 'button', name: 'Start', tag: 'button' }],
      ['verifier.baseline', { passed: false, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: false }] }],
      ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-follow', taskId: 't1', planVersion: 1, choiceId: 'key:Tab', choices: [{ id: 'key:Tab', label: 'Press Tab' }, { id: 'key:Enter', label: 'Press Enter' }] } }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' }, rationale: 'private reasoning' } }],
      ['action.result', { step: 1, ok: true, action: { kind: 'key', key: 'Tab' } }],
      shot(1),
      ['observer.state', { kind: 'state', step: 1, role: 'button', name: 'Menu', attr: 'aria-expanded', value: 'true' }],
      ['observer.navigation', { kind: 'navigation', step: 1, url: 'https://example.com/next', value: null }],
      ['policy.decision', { step: 2, decision: { action: { kind: 'intent', intent: 'activate' } } }],
      ['action.result', { step: 2, ok: false }],
      ['policy.decision', { step: 3, decision: { stop: 'success', stopSource: 'model' } }],
      ['verifier.result', { step: 3, passed: true, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: true, evidenceEventIds: ['x'] }] }],
    ], { hints: [{ kind: 'backtracking', steps: [1, 2] }, { kind: 'goal-met-at-start', steps: [0] }, { kind: 'slow-run', steps: [] }, { kind: 'focus-lost', steps: [9] }], live: true });
    expect(view).toMatchObject({ experimentId: 'x', runId: 'r', live: true, baseline: { passed: false, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: false }] } });
    expect(view.steps.map(s => s.step)).toEqual([0, 1, 2, 3]);
    const [s0, s1, s2, s3] = view.steps as [typeof view.steps[0], typeof view.steps[0], typeof view.steps[0], typeof view.steps[0]];
    expect(s0.screenshot).toEqual({ eventId: 'e1' });
    expect(s0.observed).toEqual([{ kind: 'focus', role: 'button', name: 'Start' }]);
    expect(s0.hints).toEqual(['goal-met-at-start']);
    expect(s1.action).toEqual({ kind: 'key', key: 'Tab' }); expect(s1.ok).toBe(true);
    expect(s1.screenshot).toEqual({ eventId: 'e7' });
    expect(s1.follow).toEqual({ choiceId: 'key:Tab', candidates: [{ id: 'key:Tab', label: 'Press Tab' }, { id: 'key:Enter', label: 'Press Enter' }] });
    expect(s1).not.toHaveProperty('model');
    expect(s1.observed).toEqual([{ kind: 'state', role: 'button', name: 'Menu', attr: 'aria-expanded', value: 'true' }, { kind: 'navigation', url: 'https://example.com/next', value: null }]);
    expect(s1.hints).toEqual(['backtracking']); expect(s1.at).toBe('2026-01-01T00:00:04.000Z');
    expect(s2.action).toEqual({ kind: 'intent', intent: 'activate' }); expect(s2.ok).toBe(false); expect(s2.hints).toEqual(['backtracking']); expect(s2.screenshot).toBeUndefined();
    expect(s3.stop).toEqual({ stop: 'success', source: 'model' }); expect(s3.action).toBeUndefined(); expect(s3.ok).toBeUndefined();
    expect(s3.verification).toEqual({ passed: true, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: true }] });
    expect(JSON.stringify(view)).not.toContain('private reasoning');
    expect(view.steps.every(s => !s.redacted)).toBe(true);
  });
  it('shows the plan events on the step where they happened', () => {
    const doc = (version: number, tasks: [string, string][]) => ({ version, strategy: 'Search, then add', phases: [{ title: 'Find', tasks: tasks.map(([number, goal]) => ({ number, goal })) }] });
    const view = build([
      ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-plan', role: 'planner', trigger: 'start', version: 1, document: doc(1, [['1.1', 'Find search']]) } }],
      ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-task', taskId: 't1', fromStatus: 'active', toStatus: 'done', actions: 0 } }],
      ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-plan', role: 'planner', trigger: 'plan-finished', version: 2, document: doc(2, [['1.1', 'Find search'], ['1.2', 'Type the term']]) } }],
      ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-follow', taskId: 't2', planVersion: 2, choiceId: 'intent:next', choices: [] } }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'intent', intent: 'next' } } }],
      ['policy.evidence', { step: 2, evidence: { kind: 'orchestration-limit', reason: 'task-limit' } }],
      ['policy.decision', { step: 2, decision: { stop: 'stuck', stopSource: 'orchestration-limit' } }],
    ]);
    expect(view.steps[1]!.plan).toEqual({ events: [
      { kind: 'plan', reason: 'start', outline: ['Search, then add'], steps: ['1.1 Find search'] },
      { kind: 'step-done', goal: 't1' },
      { kind: 'plan', reason: 'plan-finished', outline: ['Search, then add'], steps: ['1.1 Find search', '1.2 Type the term'] },
    ] });
    expect(view.steps[2]!.plan).toEqual({ events: [{ kind: 'limit', reason: 'task-limit' }] });
    expect(view.steps[0]!.plan).toBeUndefined();
  });
  it('carries the focused element\'s box, and nothing for a redacted or malformed box', () => {
    const view = build([
      shot(0),
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['observer.focus', { kind: 'focus', step: 1, role: 'button', name: 'Pay', rect: { x: 10.4, y: 20, width: 99.6, height: 30 } }],
      ['observer.state', { kind: 'state', step: 1, role: 'button', attr: 'aria-expanded', value: 'true', rect: { x: 1, y: 1, width: 5, height: 5 } }],
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['observer.focus', { kind: 'focus', step: 2, role: 'link', name: 'Bad', rect: { x: 1, y: 2, width: 0, height: 9 } }],
      ['policy.decision', { step: 3, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['observer.focus', { kind: 'focus', step: 3, role: 'link', name: '[REDACTED]', rect: { x: 4, y: 5, width: 6, height: 7 } }, true],
    ]);
    const [s0, s1, s2, s3] = view.steps as [typeof view.steps[0], typeof view.steps[0], typeof view.steps[0], typeof view.steps[0]];
    expect(s0.screenshot).toEqual({ eventId: 'e1' });
    expect(s1.observed[0]).toEqual({ kind: 'focus', role: 'button', name: 'Pay', rect: { x: 10, y: 20, width: 100, height: 30 } });
    // Only a focus carries a box; an empty one is dropped; a redacted step shows no geometry.
    expect(s1.observed[1]).not.toHaveProperty('rect');
    expect(s2.observed[0]).not.toHaveProperty('rect');
    expect(s3.observed[0]).not.toHaveProperty('rect');
  });
  it('keeps the first diagnostic screenshot of a step and ignores paths the runner does not write', () => {
    const view = build([
      shot(0), shot(0, 'diagnostics/step-9.png'),
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' } } }],
      shot(1, '../trace.json'),
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }],
      shot(2),
    ]);
    expect(view.steps.map(s => s.screenshot?.eventId)).toEqual(['e1', undefined, 'e6']);
  });
  it('labels speech by provenance and never reports redacted speech', () => {
    const view = build([
      ['simulation.observation', { kind: 'screenreader', speech: ['Page loaded'] }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['screen-reader.observation', { kind: 'screenreader', provenance: 'native', speech: ['Button, Start'] }],
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['screen-reader.observation', { kind: 'screenreader', speech: ['Link'] }],
    ]);
    expect(view.steps.map(s => s.speech)).toEqual([{ lines: ['Page loaded'], provenance: 'simulation' }, { lines: ['Button, Start'], provenance: 'native' }, { lines: ['Link'], provenance: 'unspecified' }]);
  });
  it('marks redacted steps and never surfaces redacted values', () => {
    const view = build([
      shot(0),
      ['policy.decision', { step: 1, decision: { action: { kind: 'typeText', input: 'email' } } }],
      ['privacy.input-taint', { step: 1, reason: 'redacted after input' }, true],
      ['action.result', { step: 1, ok: true, action: { kind: 'typeText', input: 'email' } }],
      ['browser.screenshot', { step: 1, path: 'diagnostics/step-1.png', policyVisible: false }, true],
      ['observer.state', { kind: 'state', step: 1, role: 'textbox', name: '[REDACTED]', text: '[REDACTED]', value: '[REDACTED]', url: '[REDACTED]' }, true],
      ['simulation.observation', { kind: 'screenreader', speech: ['[REDACTED]'] }, true],
      ['policy.evidence', { step: 2, details: '[REDACTED]', reason: 'Model evidence omitted after text entry.' }, true],
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }, true],
      ['verifier.result', { step: 2, passed: false, failures: ['[REDACTED]'], rules: [{ ruleIndex: 0, ruleType: 'visibleText', passed: false }] }, true],
    ]);
    expect(view.steps.map(s => s.redacted)).toEqual([false, true, true]);
    expect(view.steps[1]).toMatchObject({ action: { kind: 'typeText', input: 'email' }, ok: true, observed: [{ kind: 'state', role: 'textbox' }] });
    expect(view.steps[1]!.screenshot).toBeUndefined(); expect(view.steps[1]!.speech).toBeUndefined(); expect(view.steps[1]!.follow).toBeUndefined();
    expect(view.steps[2]!.verification).toEqual({ passed: false, rules: [{ ruleIndex: 0, ruleType: 'visibleText', passed: false }] });
    expect(JSON.stringify(view)).not.toContain('REDACTED');
  });
  it('has no steps before anything is recorded and tolerates unknown or malformed events', () => {
    expect(build([]).steps).toEqual([]);
    const view = build([['run.started', {}], ['observer.metadata', { available: true }], ['policy.decision', { step: 1, decision: 'nonsense' }], ['verifier.baseline', { error: 'Error' }]]);
    expect(view.steps.map(s => s.step)).toEqual([0, 1]); expect(view.baseline).toBeUndefined(); expect(view.steps[1]!.action).toBeUndefined();
  });
});

describe('event steps and run notices', () => {
  it('puts each event on its own step, otherwise on the decision before it, so LLM explanations can point at steps', () => {
    const list = events([['simulation.observation', { speech: ['A'] }], ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' } } }], ['action.result', { step: 1, ok: true }], ['observer.focus', { kind: 'focus' }], ['policy.decision', { step: 2, decision: { stop: 'success' } }]]);
    expect([...eventSteps(list).values()]).toEqual([0, 1, 1, 1, 2]);
  });

  it('names a bot check page and other blocked navigations once each, with their hosts', () => {
    const view = build([
      ['observer.navigation', { kind: 'navigation', url: 'https://shop.example/item?__cf_chl_rt_tk=x' }],
      ['browser.navigation-blocked', { url: 'https://challenges.cloudflare.com/turnstile' }],
      ['browser.navigation-blocked', { url: 'https://example.org/' }],
      ['browser.navigation-blocked', { url: 'https://example.org/again' }],
    ]);
    expect(view.notices).toEqual([
      { kind: 'bot-check', step: 0, hosts: ['shop.example', 'challenges.cloudflare.com'], count: 2 },
      { kind: 'navigation-blocked', step: 0, hosts: ['example.org'], count: 2 },
    ]);
  });

  it('says a live run waits for a person, and a finished one how long the person took', () => {
    const waiting: Pair[] = [['run.waiting-for-person', { step: 0, reason: 'bot-check' }]];
    expect(build(waiting, { live: true }).waitingForPerson).toBe(true);
    const passed = build([...waiting, ['run.person-resumed', { step: 0, waitedMs: 12000 }]]);
    expect(passed.waitingForPerson).toBeUndefined();
    expect(passed.notices).toEqual([{ kind: 'person-check', step: 0, waitedMs: 12000, hosts: [], count: 1 }]);
  });
});

describe('plan document view', () => {
  const task = (id: string, number: string, goal: string, status: string, extra: Record<string, unknown> = {}) => ({ id, number, goal, done: `"${goal}"`, serves: ['C1'], relies: [], status, actions: 0, addedIn: 1, ...extra });
  const v1 = { goal: 'Add to cart', version: 1, complete: false, strategy: 'Find the button', current: 't1',
    criteria: [{ id: 'C1', text: 'Added is heard', status: 'open', addedIn: 1 }], assumptions: [{ id: 'A1', text: 'Button after quantity', status: 'open', addedIn: 1 }],
    phases: [{ id: 'p1.1', number: '1', title: 'Add', criteria: ['C1'], tasks: [task('t1', '1.1', 'Find button', 'active'), task('t2', '1.2', 'Press it', 'pending')] }], retired: [],
    revisions: [{ version: 1, step: 1, trigger: 'start', rationale: 'first', added: ['t1', 't2'], abandoned: [], broken: [], met: [] }] };
  const v2 = { ...v1, version: 2, current: 't3',
    assumptions: [{ id: 'A1', text: 'Button after quantity', status: 'broken', addedIn: 1, settledIn: 2 }],
    phases: [{ id: 'p2.1', number: '1', title: 'Add', criteria: ['C1'], tasks: [task('t3', '1.1', 'Find by form controls', 'active', { addedIn: 2 }), task('t2', '1.2', 'Press it', 'pending')] }],
    retired: [{ ...task('t1', '1.1', 'Find button', 'abandoned', { actions: 2, ending: { reason: 'replaced', step: 3 } }), phase: 'Add' }] };
  const revision2 = { version: 2, step: 3, trigger: 'no-change', rationale: 'Not heard after two moves', added: ['t3'], abandoned: ['t1'], broken: ['A1'], met: [] };
  const follow = (step: number, taskId: string, version: number, choiceId: string) =>
    ['policy.evidence', { step, evidence: { kind: 'orchestration-follow', taskId, planVersion: version, choiceId, choices: [{ id: 'intent:next', label: 'Next' }, { id: 'intent:activate', label: 'Activate' }] } }] as const;
  const run: Pair[] = [
    ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-plan', role: 'planner', trigger: 'start', version: 1, revision: v1.revisions[0], document: v1, model: { id: 'gemini' }, elapsedMs: 900 } }],
    ['policy.evidence', { step: 1, evidence: { kind: 'orchestration-task', taskId: 't1', planVersion: 1, fromStatus: 'pending', toStatus: 'active', actions: 0 } }],
    follow(1, 't1', 1, 'intent:next'),
    ['policy.decision', { step: 1, decision: { action: { kind: 'intent', intent: 'next' } } }],
    follow(2, 't1', 1, 'intent:next'),
    ['policy.decision', { step: 2, decision: { action: { kind: 'intent', intent: 'next' } } }],
    follow(3, 't1', 1, 'intent:next'),
    ['policy.evidence', { step: 3, evidence: { kind: 'orchestration-plan', role: 'planner', trigger: 'no-change', version: 2, revision: revision2, document: { ...v2, revisions: [...v1.revisions, revision2] }, model: { id: 'gemini' }, elapsedMs: 800 } }],
    follow(3, 't3', 2, 'intent:activate'),
    ['policy.decision', { step: 3, decision: { action: { kind: 'intent', intent: 'next' } } }],
  ];

  it('rebuilds versions, the current task, action counts and which task each action served', () => {
    const plan = buildPlan(events(run))!;
    expect(plan.document.version).toBe(2);
    expect(plan.document.current).toBe('t3');
    expect(plan.versions.map(v => [v.version, v.step, v.trigger, v.rationale])).toEqual([[1, 1, 'start', 'first'], [2, 3, 'no-change', 'Not heard after two moves']]);
    expect(plan.versions[1]).toMatchObject({ broken: ['A1'], abandoned: ['t1'], added: ['t3'] });
    expect(plan.stepTasks).toEqual({ 1: { taskId: 't1', planVersion: 1 }, 2: { taskId: 't1', planVersion: 1 }, 3: { taskId: 't3', planVersion: 2 } });
    expect(plan.document.retired[0]).toMatchObject({ id: 't1', status: 'abandoned', actions: 2, phase: 'Add', ending: { reason: 'replaced', step: 3 } });
    expect(plan.document.phases[0]!.tasks.map(t => [t.id, t.status, t.actions])).toEqual([['t3', 'active', 1], ['t2', 'pending', 0]]);
    expect(plan.documents[1]!.phases[0]!.tasks.map(t => [t.id, t.actions])).toEqual([['t1', 2], ['t2', 0]]);
    expect(plan.document.revisions.map(r => r.version)).toEqual([1, 2]);
    expect(plan.redacted).toBe(false);
  });

  it('keeps every planner call of a step, and which action Rawstep took for the task the plan was on', () => {
    const plan = buildPlan(events(run))!;
    // The follow records are not calls: only the planner is asked.
    expect(plan.calls[3]).toEqual([{ modelId: 'gemini', elapsedMs: 800, trigger: 'no-change', version: 2 }]);
    expect(plan.calls[1]).toEqual([{ modelId: 'gemini', elapsedMs: 900, trigger: 'start', version: 1 }]);
    expect(plan.calls[2]).toBeUndefined();
    const steps = build(run).steps;
    expect(steps[3]!.calls).toEqual([{ modelId: 'gemini', elapsedMs: 800, trigger: 'no-change', version: 2 }]);
    expect(steps[3]!.follow?.choiceId).toBe('intent:activate');
  });

  it('moves statuses on from the structure kept after text entry, without the plan wording', () => {
    const summary = (step: number, s: Record<string, unknown>): Pair => ['policy.evidence', { step, details: '[REDACTED]', summary: s }, true];
    const plan = buildPlan(events([
      ...run,
      summary(4, { kind: 'orchestration-follow', taskId: 't3', planVersion: 2, choiceId: 'intent:activate' }),
      summary(4, { kind: 'orchestration-task', taskId: 't3', planVersion: 2, fromStatus: 'active', toStatus: 'done', actions: 1, ending: { reason: 'done', step: 4, verified: 'heard' } }),
      summary(4, { kind: 'orchestration-task', taskId: 't2', planVersion: 2, fromStatus: 'pending', toStatus: 'active', actions: 0 }),
      summary(4, { kind: 'orchestration-follow', taskId: 't2', planVersion: 2, choiceId: 'intent:activate' }),
      ['policy.decision', { step: 4, decision: { action: { kind: 'intent', intent: 'activate' } } }, true],
      summary(5, { kind: 'orchestration-plan', role: 'planner', trigger: 'plan-finished', version: 3 }),
    ]))!;
    expect(plan.redacted).toBe(true);
    expect(plan.document.version).toBe(3);
    expect(plan.versions.at(-1)).toEqual({ version: 3, step: 5, trigger: 'plan-finished', rationale: '', added: [], abandoned: [], broken: [], met: [] });
    expect(plan.documents[2]!.phases[0]!.tasks.map(t => [t.id, t.status, t.ending?.verified])).toEqual([['t3', 'done', 'heard'], ['t2', 'active', undefined]]);
    expect(plan.document.current).toBe('t2');
    expect(plan.stepTasks[4]).toEqual({ taskId: 't2', planVersion: 2 });
    expect(plan.calls[4]).toBeUndefined();
  });

  it('is absent for a run without a planner', () => {
    expect(buildPlan(events([['policy.evidence', { step: 1, evidence: { kind: 'speech-state', state: {} } }]]))).toBeUndefined();
  });
});
