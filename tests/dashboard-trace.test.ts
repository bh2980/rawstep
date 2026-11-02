import { describe, expect, it } from 'vitest';
import type { HintFinding, StepView } from '../packages/dashboard/src/shared/api.js';
import { i18n } from '../packages/dashboard/src/web/i18n/index.js';
import { evidenceRefs, splitEvidence } from '../packages/dashboard/src/web/lib/findings.js';
import { formatClock } from '../packages/dashboard/src/web/lib/format.js';
import { runGlyphKind, runStripLabel } from '../packages/dashboard/src/web/lib/runStrip.js';
import { goalWordHeardAt, liveCurrentLine, planSegments, railKeyTarget, railSpans, sameSpeech, stackRows, stepGlyph, stepRows, type StepItem } from '../packages/dashboard/src/web/lib/stepDots.js';
import { nextThemePreference, parseThemePreference, readThemePreference, resolveTheme, THEME_KEY, writeThemePreference } from '../packages/dashboard/src/web/lib/theme.js';

// These tests read the Korean wording, so the language is pinned whatever the machine's own language is.
await i18n.changeLanguage('ko');

const step = (n: number, action?: StepView['action'], extra: Partial<StepView> = {}): StepView => ({ step: n, ...(action ? { action } : {}), observed: [], hints: [], redacted: false, ...extra });
const tab = { kind: 'key', key: 'Tab' } as const;

describe('rail keys', () => {
  it('moves across all steps with the arrows and to the ends with Home and End', () => {
    expect(railKeyTarget('ArrowRight', 3, 43)).toBe(4);
    expect(railKeyTarget('ArrowLeft', 3, 43)).toBe(2);
    expect(railKeyTarget('Home', 20, 43)).toBe(0);
    expect(railKeyTarget('End', 20, 43)).toBe(42);
    expect(railKeyTarget('ArrowRight', 42, 43)).toBe(42);
    expect(railKeyTarget('ArrowLeft', 0, 43)).toBe(0);
    expect(railKeyTarget('Enter', 3, 43)).toBeUndefined();
    expect(railKeyTarget('ArrowRight', 0, 0)).toBeUndefined();
  });
});

describe('step glyphs', () => {
  it('draws · for a move and ● for a press or page change', () => {
    expect(stepGlyph(step(1, tab))).toBe('move');
    expect(stepGlyph(step(1, { kind: 'key', key: 'Enter' }))).toBe('press');
    expect(stepGlyph(step(1, tab, { observed: [{ kind: 'navigation', url: 'https://example.com' }] }))).toBe('press');
    expect(stepGlyph(step(0))).toBe('press');
  });

  it('draws ◎ for a step with a hint, the hint winning over the move or press', () => {
    expect(stepGlyph(step(1, tab, { hints: ['backtracking'] }))).toBe('inspect');
    expect(stepGlyph(step(1, { kind: 'key', key: 'Enter' }, { hints: ['missing-announcement'] }))).toBe('inspect');
  });
});

describe('live status line', () => {
  it('names the action and where focus went', () => {
    expect(liveCurrentLine(step(7, tab, { observed: [{ kind: 'focus', role: 'button', name: '배송지 변경' }] }))).toBe('Tab → 버튼 “배송지 변경”');
    expect(liveCurrentLine(step(7, tab, { observed: [{ kind: 'focus', role: null }] }))).toBe('Tab → 요소');
    expect(liveCurrentLine(step(7, tab, { observed: [{ kind: 'live-region', text: 'x' }] }))).toBe('Tab');
    expect(liveCurrentLine(step(0))).toBe('시작 화면');
  });

  it('writes the running time as a clock', () => {
    expect(formatClock(42)).toBe('00:42');
    expect(formatClock(42.9)).toBe('00:42');
    expect(formatClock(125)).toBe('02:05');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(-3)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });
});

describe('run strip', () => {
  it('draws reached filled, not reached striped, and everything else hollow', () => {
    expect(runGlyphKind('success')).toBe('reached');
    expect(runGlyphKind('failure')).toBe('missed');
    expect(runGlyphKind('inconclusive')).toBe('inconclusive');
    expect(runGlyphKind('cancelled')).toBe('inconclusive');
    expect(runGlyphKind('interrupted')).toBe('inconclusive');
    expect(runGlyphKind('running')).toBe('live');
    expect(runGlyphKind('queued')).toBe('live');
  });

  it('gives each glyph an accessible name with the number, outcome and action count', () => {
    expect(runStripLabel(12, 'success', 11)).toBe('실행 #12: 목표 도달, 행동 11번');
    expect(runStripLabel(3, 'failure', 20)).toBe('실행 #3: 목표 못 닿음, 행동 20번');
    expect(runStripLabel(4, 'inconclusive', undefined)).toBe('실행 #4: 판단 불가');
    expect(runStripLabel(5, 'running', undefined)).toBe('실행 #5: 실행 중');
  });
});

describe('evidence links of a finding', () => {
  const finding = (...occurrences: [string, number[]][]): Pick<HintFinding, 'occurrences'> => ({ occurrences: occurrences.map(([runId, steps]) => ({ runId, steps, certainty: 'observed' as const, detail: {} })) });
  const numbers = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);

  it('points at the earliest action of each run, oldest run first, each place once', () => {
    expect(evidenceRefs(finding(['c', [9, 7]], ['a', [4]], ['a', [4, 6]], ['b', []]), numbers)).toEqual([
      { runId: 'a', number: 1, step: 4 }, { runId: 'b', number: 2, step: undefined }, { runId: 'c', number: 3, step: 7 },
    ]);
    expect(evidenceRefs(finding(['x', [2]], ['a', [2]]), numbers).map(ref => ref.runId)).toEqual(['a', 'x']);
    expect(evidenceRefs(finding(), numbers)).toEqual([]);
  });

  it('shows up to three and counts the rest', () => {
    expect(splitEvidence([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], hidden: [4, 5] });
    expect(splitEvidence([1, 2])).toEqual({ shown: [1, 2], hidden: [] });
  });
});

describe('theme preference', () => {
  it('follows the system unless a theme was chosen', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('purple')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('cycles system, light, dark', () => {
    expect(nextThemePreference('system')).toBe('light');
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('system');
  });

  it('reads and writes storage without ever throwing', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
    writeThemePreference('dark', storage);
    expect(store.get(THEME_KEY)).toBe('dark');
    expect(readThemePreference(storage)).toBe('dark');
    writeThemePreference('system', storage);
    expect(store.has(THEME_KEY)).toBe(false);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(readThemePreference(blocked)).toBe('system');
    expect(() => writeThemePreference('light', blocked)).not.toThrow();
  });
});

const heard = (n: number, ...lines: string[]): StepView => step(n, { kind: 'intent', intent: 'next' }, lines.length ? { speech: { lines, provenance: 'simulation' } } : {});

describe('trace rail facts', () => {
  it('finds the same speech only when both steps recorded it', () => {
    expect(sameSpeech(heard(2, 'image'), heard(1, 'image'))).toBe(true);
    expect(sameSpeech(heard(2, 'image'), heard(1, 'link'))).toBe(false);
    expect(sameSpeech(heard(2), heard(1))).toBe(false);
    expect(sameSpeech(heard(1, 'image'), undefined)).toBe(false);
  });

  it('marks the step after the goal-word stretch as where a goal word was heard', () => {
    const hints = [{ kind: 'goal-word-stretch' as const, detail: { from: 2, to: 4, moves: 3 } }];
    const steps = [heard(1, 'a'), heard(2, 'b'), heard(3, 'c'), heard(4, 'd'), heard(5, 'book')];
    expect(goalWordHeardAt(steps, hints)).toBe(5);
    expect(goalWordHeardAt(steps.slice(0, 4), hints)).toBeUndefined();
    expect(goalWordHeardAt([...steps.slice(0, 4), heard(5)], hints)).toBeUndefined();
    expect(goalWordHeardAt(steps, [])).toBeUndefined();
  });

  it('brackets the goal-word stretch and runs of three or more identical speech', () => {
    const steps = [heard(0, 'start'), heard(1, 'a'), heard(2, 'image'), heard(3, 'image'), heard(4, 'image'), heard(5, 'b'), heard(6, 'b')];
    expect(railSpans(steps, [{ kind: 'goal-word-stretch', detail: { from: 1, to: 3, moves: 3 } }])).toEqual([
      { kind: 'goal-stretch', from: 1, to: 3, count: 3 },
      { kind: 'same-speech', from: 2, to: 4, count: 3, speech: 'image' },
    ]);
  });

  it('gives each plan version the steps up to the next version', () => {
    expect(planSegments([{ version: 1, step: 0 }, { version: 2, step: 28 }, { version: 3, step: 31 }, { version: 4, step: 33 }], 33)).toEqual([
      { version: 1, from: 1, to: 27 }, { version: 2, from: 28, to: 30 }, { version: 3, from: 31, to: 32 }, { version: 4, from: 33, to: 33 },
    ]);
    expect(planSegments([{ version: 1, step: 1 }, { version: 2, step: 1 }], 5)).toEqual([{ version: 2, from: 1, to: 5 }]);
  });

  it('stacks overlapping labels on new lines and reuses a line once it is free', () => {
    expect(stackRows([{ start: 0, end: 10 }, { start: 5, end: 12 }, { start: 11, end: 20 }, { start: 13, end: 14 }])).toEqual([0, 1, 0, 1]);
    expect(stackRows([{ start: 0, end: 10 }, { start: 10, end: 12 }], 4)).toEqual([0, 1]);
  });
});

describe('action list grouping', () => {
  const item = (n: number, action: string, speech: string, extra: Partial<StepItem> = {}): StepItem => ({ step: n, action, speech, same: false, marks: [], notable: false, ...extra });
  // 1–6 uneventful moves, 7 marked, 8–10 the same move hearing the same thing, 11 a press.
  const items = [
    item(0, 'start', 'home'),
    ...[1, 2, 3, 4, 5, 6].map(n => item(n, 'next', `line ${n}`)),
    item(7, 'next', 'book', { marks: ['goal word'], notable: true }),
    item(8, 'next', 'image', { notable: true }), item(9, 'next', 'image', { same: true, notable: true }), item(10, 'next', 'image', { same: true, notable: true }),
    item(11, 'press', ''),
  ];
  const shape = (rows: ReturnType<typeof stepRows>) => rows.map(row => row.kind === 'step' ? `${row.step}${row.collapse ? '^' : ''}` : `${row.mode}:${row.steps[0]}-${row.steps.at(-1)}`);

  it('folds uneventful moves and repeated moves when grouping is on', () => {
    expect(shape(stepRows(items, { grouped: true, expanded: new Set() }))).toEqual(['0', 'quiet:1-6', '7', 'same:8-10', '11']);
  });

  it('shows every step when grouping is off', () => {
    expect(shape(stepRows(items, { grouped: false, expanded: new Set() }))).toHaveLength(items.length);
  });

  it('opens the group that holds the selected step, and a group the person opened offers to fold', () => {
    expect(shape(stepRows(items, { grouped: true, selected: 9, expanded: new Set() }))).toEqual(['0', 'quiet:1-6', '7', '8', '9', '10', '11']);
    expect(shape(stepRows(items, { grouped: true, expanded: new Set(['quiet:1']) }))).toEqual(['0', '1^', '2', '3', '4', '5', '6', '7', 'same:8-10', '11']);
  });

  it('leaves short runs of uneventful moves and different marks alone', () => {
    const short = [1, 2, 3].map(n => item(n, 'next', `line ${n}`));
    expect(shape(stepRows(short, { grouped: true, expanded: new Set() }))).toEqual(['1', '2', '3']);
    const marked = [item(1, 'press', '', { marks: ['failed', 'v3'] }), item(2, 'press', '', { marks: ['failed'] })];
    expect(shape(stepRows(marked, { grouped: true, expanded: new Set() }))).toEqual(['1', '2']);
  });
});
