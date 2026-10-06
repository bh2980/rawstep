import { describe, expect, it } from 'vitest';
import type { HintFinding, StepView } from '../packages/dashboard/src/shared/api.js';
import type { Experiment, RunRecord } from '../packages/dashboard/src/shared/config.js';
import '../packages/dashboard/src/web/i18n/index.js';
import { describeFinding, firstOccurrence, stepRange } from '../packages/dashboard/src/web/lib/findings.js';
import { eventsByStep } from '../packages/dashboard/src/web/lib/rawEvents.js';
import { fastestRun, taskRunNumbers, type RunRef } from '../packages/dashboard/src/web/lib/runs.js';
import { defaultStep, dotKind, dotLabel, isUnsure } from '../packages/dashboard/src/web/lib/stepDots.js';

const hangul = /[가-힣]/;

describe('finding descriptions', () => {
  const finding = (kind: HintFinding['kind'], details: Record<string, unknown>[], counts?: HintFinding['counts']): HintFinding => ({
    kind, source: 'page', runs: details.length, totalRuns: 10, counts,
    occurrences: details.map((detail, i) => ({ runId: 'r' + i, steps: [3, 1, 1], certainty: 'observed' as const, detail })),
  } as HintFinding);

  it('words excess keystrokes with the average, fewest and most', () => {
    const text = describeFinding(finding('excess-keystrokes', [{ count: 9 }, { count: 20 }], { min: 9, max: 20, mean: 14.5 }))!;
    expect(text).toMatch(hangul);
    for (const part of ['평균 14.5번', '9번', '20번']) expect(text).toContain(part);
    expect(describeFinding(finding('excess-keystrokes', [{ count: 9 }]))).toMatch(hangul);
  });

  it('chooses the sentence from what the first occurrence recorded', () => {
    expect(describeFinding(finding('focus-lost', [{ reason: 'removed' }]))).toContain('사라진 뒤');
    expect(describeFinding(finding('focus-lost', [{ reason: 'blur' }]))).toContain('벗어나');
    expect(describeFinding(finding('focus-not-visible', [{ visible: false }]))).toContain('보이지 않았습니다');
    expect(describeFinding(finding('focus-not-visible', [{ inViewport: false }]))).toContain('화면 밖');
    expect(describeFinding(finding('focus-left-page', [{}]))).toBe('키보드 포커스가 페이지 밖으로 이동했습니다.');
    expect(describeFinding(finding('modal-focus-outside', [{ dialog: { role: 'dialog' } }]))).toContain('안으로 이동하지 않았습니다');
    expect(describeFinding(finding('early-stop', [{ reason: 'policy-uncertain' }]))).toContain('확신하지');
  });

  it('uses the largest or average number across occurrences for model findings', () => {
    expect(describeFinding(finding('backtracking', [{ reversals: 2 }, { reversals: 5 }]))).toBe('같은 두 요소 사이를 한 실행에서 최대 5번 이동했습니다.');
    expect(describeFinding(finding('repeated-state', [{ visits: 3 }, { visits: 4 }]))).toContain('최대 4번');
    const hesitation = describeFinding(finding('model-hesitation', [{ probability: 0.4, runnerUp: 0.35 }, { probability: 0.5, runnerUp: 0.45 }]))!;
    expect(hesitation).toContain('0.45 대 0.40');
    expect(hesitation).not.toContain('%');
    expect(describeFinding(finding('model-hesitation', [{}]))).toMatch(hangul);
  });

  it('has no sentence for a kind or detail it does not know, so the card falls back to the kind label', () => {
    expect(describeFinding(finding('focus-not-visible', [{}]))).toBeUndefined();
    expect(describeFinding(finding('slow-run', [{}]))).toBeUndefined();
  });

  it('points at the first occurrence and writes its action range', () => {
    const one = finding('excess-keystrokes', [{ count: 9 }, { count: 12 }]);
    expect(firstOccurrence(one)).toEqual({ runId: 'r0', steps: [1, 3] });
    expect(firstOccurrence({ occurrences: [] })).toBeUndefined();
    expect(stepRange([1, 3])).toBe('1–3');
    expect(stepRange([4])).toBe('4');
    expect(stepRange([])).toBeUndefined();
  });
});

describe('step dots', () => {
  const step = (n: number, action?: StepView['action'], extra: Partial<StepView> = {}): StepView => ({ step: n, ...(action ? { action } : {}), observed: [], hints: [], redacted: false, ...extra });

  it('tells moving from pressing', () => {
    expect(dotKind(step(1, { kind: 'key', key: 'Tab' }))).toBe('move');
    expect(dotKind(step(1, { kind: 'key', key: 'Shift+Tab' }))).toBe('move');
    expect(dotKind(step(1, { kind: 'intent', intent: 'next' }))).toBe('move');
    expect(dotKind(step(1, { kind: 'intent', intent: 'heading.next' }))).toBe('move');
    expect(dotKind(step(1, { kind: 'key', key: 'Enter' }))).toBe('press');
    expect(dotKind(step(1, { kind: 'intent', intent: 'activate' }))).toBe('press');
    expect(dotKind(step(1, { kind: 'typeText' }))).toBe('press');
    // A Tab that changed the page is a page change.
    expect(dotKind(step(1, { kind: 'key', key: 'Tab' }, { observed: [{ kind: 'navigation', url: 'https://example.com/b' }] }))).toBe('press');
    expect(dotKind(step(0))).toBe('press');
    expect(dotKind(step(5, undefined, { stop: { stop: 'success' } }))).toBe('press');
  });

  it('marks a Decision model\'s pick as low certainty below 0.5 and never an LLM\'s', () => {
    const chose = (probability: number | undefined): StepView => step(1, { kind: 'key', key: 'Tab' }, { model: { choiceId: 'key:Tab', candidates: [{ id: 'key:Tab', ...(probability === undefined ? {} : { probability }) }, { id: 'key:Enter', probability: 0.9 }] } });
    expect(isUnsure(chose(0.46), 'decision')).toBe(true);
    expect(isUnsure(chose(0.5), 'decision')).toBe(false);
    expect(isUnsure(chose(0.9), 'decision')).toBe(false);
    expect(isUnsure(chose(undefined), 'decision')).toBe(false);
    expect(isUnsure(chose(0.1), 'llm')).toBe(false);
    expect(isUnsure(step(1), 'decision')).toBe(false);
    expect(isUnsure(step(1, undefined, { model: { choiceId: 'missing', candidates: [{ id: 'a', probability: 0.1 }] } }), 'decision')).toBe(false);
  });

  it('opens a finished run at its first hint, otherwise the end, and a live run at its newest step', () => {
    const steps = [step(0), step(1, { kind: 'key', key: 'Tab' }, { hints: ['excess-keystrokes'] }), step(2), step(3, { kind: 'key', key: 'Enter' }, { hints: ['missing-announcement'] })];
    expect(defaultStep({ steps, live: false })).toBe(1);
    expect(defaultStep({ steps: [step(0), step(1)], live: false })).toBe(1);
    expect(defaultStep({ steps, live: true })).toBe(3);
    expect(defaultStep({ steps: [], live: true })).toBeUndefined();
  });

  it('labels a dot with its number, action and whether it is worth a look', () => {
    expect(dotLabel(step(4, { kind: 'key', key: 'Tab' }, { hints: ['backtracking'] }), true)).toBe('행동 4: Tab, 살펴볼 지점, 모델 확신 낮음');
    expect(dotLabel(step(7, { kind: 'key', key: 'Tab' }, { hints: ['backtracking'] }), false)).toBe('행동 7: Tab, 살펴볼 지점');
    expect(dotLabel(step(2, { kind: 'key', key: 'Enter' }), false)).toBe('행동 2: Enter');
    expect(dotLabel(step(0), false)).toBe('시작 화면');
  });
});

describe('raw events by step', () => {
  it('puts unnumbered events with the latest decision and early ones with step 0', () => {
    const events = [
      { type: 'keyboard.observation', data: {} }, { type: 'policy.decision', data: { step: 1 } }, { type: 'action.result', data: { step: 1 } },
      { type: 'keyboard.observation', data: {} }, { type: 'policy.decision', data: { step: 2 } }, { type: 'observer.focus', data: { step: 2 } },
    ];
    const groups = eventsByStep(events);
    expect([...groups.keys()]).toEqual([0, 1, 2]);
    expect(groups.get(0)).toHaveLength(1); expect(groups.get(1)).toHaveLength(3); expect(groups.get(2)).toHaveLength(2);
  });
});

describe('run numbers and the fastest run', () => {
  const ref = (id: string, taskId: string, startedAt: string, state: RunRecord['state'], steps?: number, repeat = 1): RunRef => ({
    experiment: { id: 'e', createdAt: startedAt } as Experiment,
    run: { id, taskId, startedAt, state, repeat, ...(steps !== undefined ? { outcome: { status: state, steps } } : {}) } as RunRecord,
  });
  const runs = [
    ref('c', 't', '2026-01-03T00:00:00Z', 'success', 4), ref('x', 'other', '2026-01-02T00:00:00Z', 'success', 1),
    ref('b', 't', '2026-01-02T00:00:00Z', 'failure', 20), ref('a', 't', '2026-01-01T00:00:00Z', 'success', 9), ref('d', 't', '2026-01-04T00:00:00Z', 'running'),
  ];
  it('numbers one task\'s runs from the oldest', () => {
    expect([...taskRunNumbers(runs, 't')]).toEqual([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
  });
  it('picks the goal-reaching run with the fewest actions and ignores unfinished and failed ones', () => {
    const mine = runs.filter(item => item.run.taskId === 't');
    expect(fastestRun(mine)).toMatchObject({ steps: 4, ref: { run: { id: 'c' } } });
    expect(fastestRun([mine[1]!, mine[3]!])).toBeUndefined();
    expect(fastestRun([])).toBeUndefined();
  });
});
