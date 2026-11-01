import { afterAll, describe, expect, it } from 'vitest';
import type { RunPlanView } from '../packages/dashboard/src/shared/api.js';
import { i18n } from '../packages/dashboard/src/web/i18n/index.js';
import { hitMoveLimit } from '../packages/dashboard/src/web/lib/plan.js';
import { defaultRunProfileId, QUICK_RUN_REPEATS } from '../packages/dashboard/src/web/lib/quickRun.js';
import { nameFromGoal } from '../packages/dashboard/src/web/lib/taskName.js';

await i18n.changeLanguage('en');
afterAll(async () => { await i18n.changeLanguage('ko'); });

const planFile = { planFile: 'plans/{task}.json' } as never;
const model = { connectionId: 'c', modelId: 'm', instructions: '' } as never;

describe('the run dialog starts with one profile', () => {
  it('runs once by default', () => expect(QUICK_RUN_REPEATS).toBe(1));

  it('keeps the last single profile if it still exists', () => {
    const profiles = [{ id: 'demo', planner: planFile }, { id: 'a', planner: model }, { id: 'b', planner: model }];
    expect(defaultRunProfileId(profiles, 'b')).toBe('b');
    expect(defaultRunProfileId(profiles, 'demo')).toBe('demo');
  });

  it('otherwise prefers the first profile that plans with a model over a written plan', () => {
    const profiles = [{ id: 'demo', planner: planFile }, { id: 'a', planner: model }];
    expect(defaultRunProfileId(profiles, 'gone')).toBe('a');
    expect(defaultRunProfileId(profiles)).toBe('a');
  });

  it('skips a model profile that cannot run yet (no planner or key) for one that can', () => {
    const profiles = [{ id: 'demo', planner: planFile }, { id: 'a', planner: model }];
    expect(defaultRunProfileId(profiles, undefined, profile => profile.id !== 'a')).toBe('demo');
  });

  it('falls back to the first profile when none plans with a model, and to nothing without profiles', () => {
    expect(defaultRunProfileId([{ id: 'demo', planner: planFile }, { id: 'other', planner: planFile }])).toBe('demo');
    expect(defaultRunProfileId([])).toBeUndefined();
  });

  it('states the math of a run on the button', () => {
    const factors = [i18n.t('runDialog.factorProfiles', { count: 2 }), i18n.t('runDialog.factorRepeats', { count: 1 })].join(' × ');
    expect(i18n.t('runDialog.runMath', { factors, count: 2 })).toBe('Run 2 profiles × 1 repeat = 2 runs');
  });
});

describe('a new task is named from its goal', () => {
  it('takes the first six words without trailing punctuation', () => {
    expect(nameFromGoal('  Add the blue running shoes to the cart, then check out.  ')).toBe('Add the blue running shoes to');
    expect(nameFromGoal('Find the contact page.')).toBe('Find the contact page');
    expect(nameFromGoal('신발을 장바구니에 담는다')).toBe('신발을 장바구니에 담는다');
    expect(nameFromGoal('   ')).toBe('');
  });
});

describe('plan steps and the move limit', () => {
  const plan = (trigger: string): Pick<RunPlanView, 'versions' | 'stepTasks'> => ({
    versions: [{ version: 1, step: 0, trigger: 'start', rationale: '', added: [], abandoned: [], broken: [], met: [] }, { version: 2, step: 5, trigger, rationale: '', added: [], abandoned: [], broken: [], met: [] }],
    stepTasks: { 1: { taskId: 'a', planVersion: 1 }, 2: { taskId: 'a', planVersion: 1 }, 3: { taskId: 'b', planVersion: 1 }, 4: { taskId: 'b', planVersion: 1 } },
  });

  it('knows which plan step the move limit cut short', () => {
    expect(hitMoveLimit(plan('task-limit'), 'b')).toBe(true);
    expect(hitMoveLimit(plan('task-limit'), 'a')).toBe(false);
    expect(hitMoveLimit(plan('no-change'), 'b')).toBe(false);
  });

  it('says moves plainly and the limit only when it was hit', () => {
    expect(i18n.t('planDoc.moves', { count: 20 })).toBe('20 moves');
    expect(i18n.t('planDoc.moves', { count: 1 })).toBe('1 move');
    expect(i18n.t('planDoc.limitHit', { limit: 12 })).toBe('re-planned after 12 moves without anything new');
    expect(i18n.t('planDoc.factTasks', { done: 1, total: 2, count: 2 })).toBe('1 of 2 plan steps done');
    expect(i18n.t('runHeader.liveMax', { max: 100, count: 100 })).toBe('Task limit: 100 moves');
  });
});

describe('connection setup says why Add is off', () => {
  it('has a reason for each missing thing', () => {
    for (const key of ['name', 'consent', 'checking']) expect(i18n.t(`connections.addBlock.${key}`)).not.toBe(`connections.addBlock.${key}`);
    expect(i18n.t('connections.addBlock.consent')).toBe('Tick the consent box first');
  });
});
