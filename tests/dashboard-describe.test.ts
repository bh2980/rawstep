import { describe, expect, it } from 'vitest';
import type { HintKind } from '../packages/reports/src/hints/index.js';
import { describeHint } from '../packages/dashboard/src/web/lib/describe.js';
import { i18n } from '../packages/dashboard/src/web/i18n/index.js';
import { core } from '../packages/dashboard/src/web/i18n/locales/ko/core.js';
import { hintKindLabel, outcomeReasonLabel } from '../packages/dashboard/src/web/i18n/labels.js';

// These tests read the Korean wording, so the language is pinned whatever the machine's own language is.
await i18n.changeLanguage('ko');

const hint = (kind: HintKind, detail: Record<string, unknown>, extra: { certainty?: 'observed' | 'suspected' } = {}) =>
  ({ kind, summary: `english ${kind}`, detail, certainty: extra.certainty ?? 'observed' as const });
const hangul = /[가-힣]/;

describe('describeHint', () => {
  const cases: [string, ReturnType<typeof hint>, (string | RegExp)[]][] = [
    ['slow-run', hint('slow-run', { steps: 12, referenceSteps: 4, durationMs: 9000, referenceDurationMs: 3000 }), ['12번', '4번', '8번', '9.0초', '3.0초']],
    ['excess-keystrokes', hint('excess-keystrokes', { count: 12, keys: { Tab: 10, 'Shift+Tab': 2 }, target: { role: 'button', name: 'Save' } }), ['button “Save”', '12번', 'Tab ×10']],
    ['backtracking', hint('backtracking', { reversals: 3 }), ['3번']],
    ['focus-lost removed', hint('focus-lost', { from: { role: 'button', name: 'Open' }, reason: 'removed', action: 'Enter' }), ['Enter', 'button “Open”', '사라져']],
    ['focus-lost left', hint('focus-lost', { from: { role: 'link' }, reason: 'blur' }), ['link', '벗어나']],
    ['focus-not-visible hidden', hint('focus-not-visible', { target: { role: 'link', name: 'More' }, visible: false, inViewport: true }), ['link “More”', '보이지 않았습니다']],
    ['focus-not-visible viewport', hint('focus-not-visible', { target: { role: 'link', name: 'More' }, visible: true, inViewport: false }), ['뷰포트 밖']],
    ['focus-not-visible occluded', hint('focus-not-visible', { centerOccluded: true }, { certainty: 'suspected' }), ['가리고']],
    ['focus-not-visible indicator', hint('focus-not-visible', { indicator: 'not-detected' }, { certainty: 'suspected' }), ['포커스 표시']],
    ['modal-focus-outside target', hint('modal-focus-outside', { target: { role: 'textbox', name: 'Email' } }), ['textbox “Email”', '모달']],
    ['modal-focus-outside dialog', hint('modal-focus-outside', { dialog: { role: 'dialog', name: 'Confirm' } }, { certainty: 'suspected' }), ['dialog “Confirm”', '이동하지 않았습니다']],
    ['missing-announcement', hint('missing-announcement', { changes: ['state'] }, { certainty: 'suspected' }), ['안내']],
    ['early-stop stuck', hint('early-stop', { reason: 'policy-stuck' }), ['막혔다고']],
    ['early-stop uncertain', hint('early-stop', { reason: 'policy-uncertain' }), ['확신하지']],
    ['early-stop guard', hint('early-stop', { reason: 'policy-stuck', stopSource: 'exploration-guard' }), ['반복 감시']],
    ['early-stop plan limit', hint('early-stop', { reason: 'policy-uncertain', stopSource: 'orchestration-limit' }), ['계획 모델 호출 한도', '측정하지 못했습니다']],
    ['early-stop user gave up', hint('early-stop', { reason: 'policy-stuck', stopSource: 'user-gave-up', giveUp: { reason: 'No add button anywhere', tried: ['A1'] } }), ['사용자가 포기', 'No add button anywhere']],
    ['wanted to give up', hint('wanted-to-give-up', { reason: 'Too long' }), ['포기하려 했지만', 'Too long']],
    ['goal word stretch', hint('goal-word-stretch', { moves: 40, from: 3, to: 42 }), ['3~42', '40번']],
    ['expectation broken', hint('expectation-broken', { assumption: { id: 'A3', text: 'The add control is a button' }, version: 4 }), ['A3', 'The add control is a button', 'v4']],
    ['replan', hint('replan', { trigger: 'no-change', version: 3 }), ['바뀌지 않아', 'v3']],
    ['task-limit', hint('task-limit', { version: 2 }), ['행동 한도']],
    ['goal-met-at-start all', hint('goal-met-at-start', { rules: [{ ruleIndex: 0, ruleType: 'url' }] }), ['완료 확인', '모두']],
    ['goal-met-at-start some', hint('goal-met-at-start', { rules: [{ ruleIndex: 0 }, { ruleIndex: 1 }] }, { certainty: 'suspected' }), ['2개']],
    ['focus-left-page', hint('focus-left-page', { action: 'Tab' }), ['Tab', '페이지를 벗어났습니다']],
    ['focus-left-page no action', hint('focus-left-page', {}), ['페이지를 벗어났습니다']],
  ];

  it.each(cases)('describes %s in Korean', (_name, input, expected) => {
    const text = describeHint(input);
    expect(text).toMatch(hangul);
    expect(text).not.toContain('english');
    for (const part of expected) expect(text).toContain(part as string);
  });

  it('covers every hint kind', () => {
    const covered = new Set(cases.map(([, input]) => input.kind));
    const all: HintKind[] = ['slow-run', 'excess-keystrokes', 'backtracking', 'focus-lost', 'focus-not-visible', 'modal-focus-outside',
      'missing-announcement', 'early-stop', 'goal-met-at-start', 'focus-left-page',
      'replan', 'task-limit', 'wanted-to-give-up', 'goal-word-stretch', 'expectation-broken'];
    expect(Object.keys(core.hints.kinds).sort()).toEqual([...all].sort());
    for (const kind of all) expect(covered.has(kind)).toBe(true);
  });

  it('omits redacted names', () => {
    const text = describeHint(hint('focus-not-visible', { target: { role: 'textbox', name: '[REDACTED]' }, visible: false }));
    expect(text).toContain('textbox');
    expect(text).not.toContain('REDACTED');
  });

  it('falls back to the English summary for unknown kinds and missing fields', () => {
    expect(describeHint({ kind: 'brand-new' as HintKind, summary: 'Something new.', detail: { x: 1 } })).toBe('Something new.');
    expect(describeHint({ kind: 'slow-run', summary: 'Slow.', detail: {} })).toBe('Slow.');
    expect(describeHint({ kind: 'missing-announcement', summary: 'Silent.', detail: {} })).toBe('Silent.');
    expect(describeHint({ kind: 'focus-not-visible', summary: 'Hidden.', detail: { target: { role: 'x' } } })).toBe('Hidden.');
    expect(describeHint({ kind: 'early-stop', summary: 'Stopped.', detail: { reason: 'maxSteps' } })).toBe('Stopped.');
    expect(describeHint({ kind: 'backtracking', summary: 'Reversed.', detail: null as unknown as Record<string, unknown> })).toBe('Reversed.');
  });
});

describe('outcome labels', () => {
  it('translates every known outcome reason and keeps unknown ones', () => {
    for (const reason of ['verified', 'verification-failed', 'policy-stuck', 'policy-uncertain', 'maxSteps', 'timeout', 'error', 'aborted',
      'trace-persistence-error', 'unsupported-profile', 'access-blocked', 'unsupported-pattern']) expect(outcomeReasonLabel(reason)).toMatch(hangul);
    expect(outcomeReasonLabel('something-else')).toBe('something-else');
    expect(outcomeReasonLabel('constructor')).toBe('constructor');
  });
});

describe('label helpers', () => {
  it('labels every hint kind in Korean and keeps unknown kinds', () => {
    for (const kind of Object.keys(core.hints.kinds)) expect(hintKindLabel(kind)).toMatch(hangul);
    expect(hintKindLabel('brand-new')).toBe('brand-new');
    expect(hintKindLabel('constructor')).toBe('constructor');
  });
});
