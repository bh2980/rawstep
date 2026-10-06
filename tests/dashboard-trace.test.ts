import { describe, expect, it } from 'vitest';
import type { HintFinding, StepView } from '../packages/dashboard/src/shared/api.js';
import '../packages/dashboard/src/web/i18n/index.js';
import { evidenceRefs, splitEvidence } from '../packages/dashboard/src/web/lib/findings.js';
import { formatClock } from '../packages/dashboard/src/web/lib/format.js';
import { runGlyphKind, runStripLabel } from '../packages/dashboard/src/web/lib/runStrip.js';
import { liveCurrentLine, railKeyTarget, railWindow, stepGlyph } from '../packages/dashboard/src/web/lib/stepDots.js';
import { nextThemePreference, parseThemePreference, readThemePreference, resolveTheme, THEME_KEY, writeThemePreference } from '../packages/dashboard/src/web/lib/theme.js';

const step = (n: number, action?: StepView['action'], extra: Partial<StepView> = {}): StepView => ({ step: n, ...(action ? { action } : {}), observed: [], hints: [], redacted: false, ...extra });
const tab = { kind: 'key', key: 'Tab' } as const;

describe('detail rail window', () => {
  it('shows everything when the run is short', () => {
    expect(railWindow(8, 3)).toEqual({ start: 0, end: 8 });
    expect(railWindow(15, 14)).toEqual({ start: 0, end: 15 });
    expect(railWindow(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it('centres a window of 15 on the current step and keeps it inside the run', () => {
    expect(railWindow(100, 50)).toEqual({ start: 43, end: 58 });
    expect(railWindow(100, 0)).toEqual({ start: 0, end: 15 });
    expect(railWindow(100, 3)).toEqual({ start: 0, end: 15 });
    expect(railWindow(100, 99)).toEqual({ start: 85, end: 100 });
    expect(railWindow(100, 97)).toEqual({ start: 85, end: 100 });
    expect(railWindow(100, 500)).toEqual({ start: 85, end: 100 });
    expect(railWindow(100, -4)).toEqual({ start: 0, end: 15 });
    expect(railWindow(43, 17, 9)).toEqual({ start: 13, end: 22 });
  });

  it('always contains the current step and never exceeds the size', () => {
    for (let current = 0; current < 60; current++) {
      const { start, end } = railWindow(60, current);
      expect(current >= start && current < end).toBe(true);
      expect(end - start).toBe(15);
    }
  });
});

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
  const chose = (probability: number, runnerUp = 0.1): Partial<StepView> => ({ model: { choiceId: 'key:Tab', candidates: [{ id: 'key:Tab', probability }, { id: 'key:Enter', probability: runnerUp }] } });

  it('draws · for a move and ● for a press or page change', () => {
    expect(stepGlyph(step(1, tab), 'llm')).toBe('move');
    expect(stepGlyph(step(1, { kind: 'key', key: 'Enter' }), 'llm')).toBe('press');
    expect(stepGlyph(step(1, tab, { observed: [{ kind: 'navigation', url: 'https://example.com' }] }), 'llm')).toBe('press');
    expect(stepGlyph(step(0), 'llm')).toBe('press');
  });

  it('draws ◌ for a Decision model pick whose runner-up scored close to it and ◎ for a step with a hint, the hint winning', () => {
    expect(stepGlyph(step(1, tab, chose(0.3, 0.28)), 'decision')).toBe('unsure');
    expect(stepGlyph(step(1, tab, chose(0.3, 0.28)), 'llm')).toBe('move');
    expect(stepGlyph(step(1, tab, chose(0.3)), 'decision')).toBe('move');
    expect(stepGlyph(step(1, tab, { hints: ['backtracking'] }), 'llm')).toBe('inspect');
    expect(stepGlyph(step(1, tab, { ...chose(0.3, 0.28), hints: ['backtracking'] }), 'decision')).toBe('inspect');
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
