import { describe, expect, it } from 'vitest';
import type { VerifyRule } from '@rawstep/core/contracts';
import '../packages/dashboard/src/web/i18n/index.js';
import { describeRule } from '../packages/dashboard/src/web/lib/describeRule.js';
import { ADVANCED_KINDS, BASIC_KINDS, blankDraft, draftFromRule, draftMissing, ruleFromDraft, type RuleDraft } from '../packages/dashboard/src/web/lib/ruleEditor.js';
import { parseTaskJson, sameTaskJson, taskRules, updateTaskJson, withRules } from '../packages/dashboard/src/web/lib/taskJson.js';

const hangul = /[가-힣]/;
const draft = <T extends RuleDraft>(value: T): T => value;

describe('completion-check editor mapping', () => {
  const cases: [string, RuleDraft, VerifyRule][] = [
    ['text visible', draft({ kind: 'textVisible', text: ' Order placed ' }), { textVisible: 'Order placed' }],
    ['address', draft({ kind: 'urlIncludes', text: '/checkout' }), { urlIncludes: '/checkout' }],
    ['page title', draft({ kind: 'titleIncludes', text: 'Done' }), { titleIncludes: 'Done' }],
    ['live region', draft({ kind: 'liveRegion', text: 'Saved', afterActivation: false }), { event: { kind: 'live-region', text: 'Saved' } }],
    ['live region after activation', draft({ kind: 'liveRegion', text: 'Saved', afterActivation: true }), { event: { kind: 'live-region', text: 'Saved' }, after: 'lastActivation' }],
    ['appeared with role and name', draft({ kind: 'appeared', role: 'dialog', name: 'Confirm', afterActivation: false }), { event: { kind: 'appeared', role: 'dialog', name: 'Confirm' } }],
    ['disappeared by name only', draft({ kind: 'disappeared', role: '', name: 'Loading', afterActivation: false }), { event: { kind: 'disappeared', name: 'Loading' } }],
    ['focused', draft({ kind: 'focused', role: 'button', name: 'Pay' }), { focused: { role: 'button', name: 'Pay' } }],
    ['state', draft({ kind: 'state', role: 'button', name: 'Menu', attr: 'aria-expanded', value: 'true', afterActivation: false }), { event: { kind: 'state', attr: 'aria-expanded', value: 'true', role: 'button', name: 'Menu' } }],
    ['state on any element', draft({ kind: 'state', role: '', name: '', attr: 'aria-checked', value: 'true', afterActivation: false }), { event: { kind: 'state', attr: 'aria-checked', value: 'true' } }],
    ['submit', draft({ kind: 'submit', afterActivation: false }), { event: { kind: 'submit' } }],
    ['request', draft({ kind: 'request', url: '/api/order', method: 'post' }), { requestSeen: { urlIncludes: '/api/order', method: 'POST' } }],
    ['response with status', draft({ kind: 'response', url: '/api/order', method: '', status: '201' }), { responseSeen: { urlIncludes: '/api/order', status: 201 } }],
    ['dom event', draft({ kind: 'domEvent', selector: '#buy', event: 'click' }), { domEventSeen: { selector: '#buy', event: 'click' } }],
    ['script', draft({ kind: 'script', source: ' (context) => true ', description: 'Always' }), { script: { source: '(context) => true', description: 'Always' } }],
    ['any', draft({ kind: 'any', items: [{ kind: 'textVisible', text: 'A' }, { kind: 'urlIncludes', text: '/b' }] }), { any: [{ textVisible: 'A' }, { urlIncludes: '/b' }] }],
    ['not', draft({ kind: 'not', item: { kind: 'textVisible', text: 'Error' } }), { not: { textVisible: 'Error' } }],
  ];

  it.each(cases)('turns the %s draft into a rule and back', (_name, input, rule) => {
    expect(ruleFromDraft(input)).toEqual(rule);
    const trimmed = ruleFromDraft(input)!;
    // Reading the rule back gives a draft that produces the same rule.
    expect(ruleFromDraft(draftFromRule(trimmed)!)).toEqual(trimmed);
  });

  it('offers every kind it can build, and a blank draft of each is incomplete except the ones with nothing to fill in', () => {
    for (const kind of [...BASIC_KINDS, ...ADVANCED_KINDS]) {
      const blank = blankDraft(kind);
      expect(blank.kind).toBe(kind);
      expect(draftMissing(blank) === undefined).toBe(kind === 'submit' || kind === 'state');
    }
  });

  it('says what an incomplete draft still needs and builds no rule from it', () => {
    expect(draftMissing(blankDraft('textVisible'))).toBe('text');
    expect(draftMissing(draft({ kind: 'appeared', role: '', name: ' ', afterActivation: false }))).toBe('element');
    expect(draftMissing(draft({ kind: 'response', url: '/x', method: '', status: '42' }))).toBe('status');
    expect(draftMissing(draft({ kind: 'response', url: '/x', method: '', status: '' }))).toBeUndefined();
    expect(draftMissing(draft({ kind: 'script', source: '() => true', description: '' }))).toBe('code');
    expect(draftMissing(draft({ kind: 'any', items: [{ kind: 'textVisible', text: 'A' }, blankDraft('textVisible')] }))).toBe('items');
    expect(ruleFromDraft(blankDraft('focused'))).toBeUndefined();
  });

  it('keeps what it cannot show without loss as a rule to remove, not to edit', () => {
    const exact: VerifyRule = { focused: { role: 'button', name: { equals: 'Pay' } } };
    expect(draftFromRule(exact)).toBeUndefined();
    expect(draftFromRule({ event: { kind: 'appeared', name: { regex: '^Done' } } })).toBeUndefined();
    expect(draftFromRule({ event: { kind: 'focus', role: 'button' } })).toBeUndefined();
    expect(draftFromRule({ event: { kind: 'live-region', text: 'Saved', role: 'status' } })).toBeUndefined();
    expect(draftFromRule({ textVisibleExact: 'Hello' })).toBeUndefined();
    expect(draftFromRule({ any: [{ textVisible: 'A' }, exact] })).toBeUndefined();
    expect(draftFromRule({ focused: 'nonsense' } as unknown as VerifyRule)).toBeUndefined();
    // A name matcher that means "includes" is fine.
    expect(draftFromRule({ event: { kind: 'appeared', name: { includes: 'Done' } } })).toEqual({ kind: 'appeared', role: '', name: 'Done', afterActivation: false });
  });
});

describe('describeRule', () => {
  const sentences: [VerifyRule, (string | RegExp)[]][] = [
    [{ textVisible: 'Thanks' }, ['"Thanks"', '보임']],
    [{ textVisibleExact: 'Thanks' }, ['정확히']],
    [{ urlIncludes: '/done' }, ['주소', '/done']],
    [{ titleIncludes: 'Done' }, ['제목', 'Done']],
    [{ event: { kind: 'live-region', text: 'Saved' } }, ['안내 문구', 'Saved', '읽힘']],
    [{ event: { kind: 'appeared', role: 'dialog', name: 'Confirm' } }, ['대화상자', 'Confirm', '나타남']],
    [{ event: { kind: 'disappeared', name: 'Loading' } }, ['Loading', '사라짐']],
    [{ event: { kind: 'state', attr: 'aria-expanded', value: 'true', role: 'button', name: 'Menu' } }, ['버튼', 'Menu', 'aria-expanded', 'true']],
    [{ event: { kind: 'state', attr: 'aria-checked', value: 'true' } }, ['어떤 요소든', 'aria-checked']],
    [{ event: { kind: 'submit' } }, ['폼이 제출됨']],
    [{ event: { kind: 'submit' }, after: 'lastActivation' }, ['폼이 제출됨', '마지막 활성화 이후']],
    [{ event: { kind: 'navigation', url: { includes: '/x' } } }, ['페이지 이동']],
    [{ focused: { role: 'button', name: 'Pay' } }, ['포커스', '버튼', 'Pay']],
    [{ requestSeen: { urlIncludes: '/api', method: 'POST' } }, ['/api', 'POST']],
    [{ responseSeen: { urlIncludes: '/api', status: 201 } }, ['/api', '201']],
    [{ domEventSeen: { selector: '#buy', event: 'click' } }, ['#buy', 'click']],
    [{ script: { source: '() => true', description: '카드 입력칸이 있다' } }, ['검증 코드', '카드 입력칸이 있다']],
    [{ any: [{ textVisible: 'A' }, { urlIncludes: '/b' }] }, ['하나라도', 'A', '/b']],
    [{ not: { textVisible: 'Error' } }, ['아님', 'Error']],
  ];
  it.each(sentences)('puts %j in Korean', (rule, parts) => {
    const text = describeRule(rule);
    expect(text).toMatch(hangul);
    for (const part of parts) expect(text).toContain(part as string);
  });
  it('shows an unknown shape as JSON instead of hiding it', () => {
    expect(describeRule({ somethingNew: 1 })).toBe('{"somethingNew":1}');
  });
});

describe('Task JSON helpers', () => {
  const text = JSON.stringify({ url: 'https://example.com', goal: 'Go', verify: { all: [{ textVisible: 'A' }] } }, null, 2);
  it('reads and replaces the completion checks without touching other fields', () => {
    expect(taskRules(parseTaskJson(text)!)).toEqual([{ textVisible: 'A' }]);
    const next = withRules(text, [{ textVisible: 'A' }, { urlIncludes: '/b' }]);
    expect(parseTaskJson(next)).toMatchObject({ url: 'https://example.com', goal: 'Go', verify: { all: [{ textVisible: 'A' }, { urlIncludes: '/b' }] } });
    expect(updateTaskJson(text, { goal: 'Stop' })).toContain('"goal": "Stop"');
  });
  it('treats text that is not a JSON object as unreadable and leaves it alone', () => {
    expect(parseTaskJson('[1]')).toBeUndefined();
    expect(parseTaskJson('{')).toBeUndefined();
    expect(updateTaskJson('{', { goal: 'x' })).toBe('{');
    expect(taskRules({})).toEqual([]);
  });
  it('compares by content, not formatting', () => {
    expect(sameTaskJson(text, JSON.stringify(JSON.parse(text)))).toBe(true);
    expect(sameTaskJson(text, updateTaskJson(text, { goal: 'Stop' }))).toBe(false);
  });
});
