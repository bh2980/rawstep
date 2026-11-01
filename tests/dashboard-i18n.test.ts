import { afterAll, describe, expect, it } from 'vitest';
import { SERVER_MESSAGE_CODES } from '../packages/dashboard/src/shared/messages.js';
import { browserLanguage, i18n, resources, serverText } from '../packages/dashboard/src/web/i18n/index.js';
import { countOf } from '../packages/dashboard/src/web/lib/format.js';
import { resultLabel } from '../packages/dashboard/src/web/lib/runStrip.js';

type Tree = { readonly [key: string]: string | Tree };

/** Every leaf of a locale as `path → value`. */
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value); else for (const [p, v] of leaves(value, path)) out.set(p, v);
  }
  return out;
}
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(match => match[1]).sort();

const ko = leaves(resources.ko.translation as unknown as Tree), en = leaves(resources.en.translation as unknown as Tree);

describe('dashboard languages', () => {
  afterAll(async () => { await i18n.changeLanguage('ko'); });

  it('has the same keys in English and Korean; English adds only singular forms of a key it also has', () => {
    const singular = (key: string) => key.endsWith('_one') && en.has(key.slice(0, -'_one'.length));
    expect([...ko.keys()].filter(key => !en.has(key))).toEqual([]);
    expect([...en.keys()].filter(key => !ko.has(key) && !singular(key))).toEqual([]);
  });

  it('keeps every placeholder of a Korean string in its English one', () => {
    const mismatched = [...ko].filter(([key, text]) => {
      const english = placeholders(en.get(key) ?? '');
      return JSON.stringify(english) !== JSON.stringify(placeholders(text));
    }).map(([key]) => key);
    expect(mismatched).toEqual([]);
    // A singular form uses no value its plural does not have (it may leave the count out: "Run it").
    for (const [key, text] of en) if (key.endsWith('_one')) expect(placeholders(en.get(key.slice(0, -4))!), key).toEqual(expect.arrayContaining(placeholders(text)));
  });

  it('has no Korean in the English strings, and no English string left empty that Korean fills', () => {
    expect([...en].filter(([, text]) => /[가-힣]/.test(text)).map(([key]) => key)).toEqual([]);
    expect([...en].filter(([key, text]) => !text.trim() && ko.get(key)?.trim()).map(([key]) => key)).toEqual([]);
  });

  it('reads right for one and for many in English, and Korean does not change with the count', async () => {
    const moves = (n: number | string) => i18n.t('taskPage.results.moves', { n, ...countOf(n) });
    await i18n.changeLanguage('en');
    expect(moves(1)).toBe('1 move');
    expect(moves(2)).toBe('2 moves');
    expect(moves('2.5')).toBe('2.5 moves');
    expect(moves('1')).toBe('1 move');
    expect(i18n.t('taskPage.results.moves', { n: '—', ...countOf('—') })).toBe('— moves');
    expect(i18n.t('taskPage.batch.label', { when: 'Oct 31', note: 'x', runs: 1, count: 1 })).toBe('Oct 31 · x · 1 run');
    expect(i18n.t('taskPage.batch.labelNoNote', { when: 'Oct 31', runs: 4, count: 4 })).toBe('Oct 31 · 4 runs');
    const still = (before: number, after: number) => i18n.t('taskPage.batch.still', { before: i18n.t('taskPage.batch.runCount', { count: before }), after: i18n.t('taskPage.batch.runCount', { count: after }) });
    expect(still(1, 3)).toBe('1 run → 3 runs');
    expect(still(2, 1)).toBe('2 runs → 1 run');
    expect(i18n.t('runStrip.item', { number: 3, state: 'Gave up', steps: 1, count: 1 })).toBe('Run #3: Gave up, 1 move');
    expect(i18n.t('runHeader.factSteps', { steps: 12, count: 12 })).toBe('12 moves');
    expect(i18n.t('hints.text.backtracking', { n: 1, count: 1 })).toBe('The direction of travel reversed 1 time.');
    expect(i18n.t('hints.text.backtracking', { n: 2, count: 2 })).toBe('The direction of travel reversed 2 times.');
    expect(i18n.t('planDoc.factTasks', { done: 1, total: 1, count: 1 })).toBe('1 of 1 plan step done');
    await i18n.changeLanguage('ko');
    expect(moves(1)).toBe(moves(2).replace('2', '1'));
    expect(moves(1)).toBe('1번');
    expect(moves('2.5')).toBe('2.5번');
    expect(i18n.t('taskPage.batch.label', { when: 'Oct 31', note: 'x', runs: 1, count: 1 })).toBe('Oct 31 · x · 실행 1번');
    expect(i18n.t('taskPage.batch.still', { before: i18n.t('taskPage.batch.runCount', { count: 1 }), after: i18n.t('taskPage.batch.runCount', { count: 3 }) })).toBe('1번 → 3번');
    expect(i18n.t('runStrip.item', { number: 3, state: '포기', steps: 1, count: 1 })).toBe(i18n.t('runStrip.item', { number: 3, state: '포기', steps: 1 }));
  });

  it('has words for every message code the server sends', () => {
    for (const code of SERVER_MESSAGE_CODES) {
      expect(ko.get(`serverMessages.${code}`), code).toBeTruthy();
      expect(en.get(`serverMessages.${code}`), code).toBeTruthy();
    }
  });

  it('follows the browser: any Korean preference is Korean, anything else English', () => {
    expect(browserLanguage(['ko-KR', 'en-US'])).toBe('ko');
    expect(browserLanguage(['en-US', 'ko'])).toBe('ko');
    expect(browserLanguage(['KO'])).toBe('ko');
    expect(browserLanguage(['en-GB'])).toBe('en');
    expect(browserLanguage(['ja-JP', 'fr'])).toBe('en');
    expect(browserLanguage([])).toBe('en');
    expect(browserLanguage(undefined)).toBe('en');
  });

  it('words results and server messages in the language shown, with the CLI\'s terms in English', async () => {
    await i18n.changeLanguage('en');
    expect(resultLabel({ state: 'success', outcome: { status: 'success' } })).toBe('Reached the goal');
    expect(resultLabel({ state: 'failure', outcome: { status: 'failure', reason: 'policy-stuck', stopSource: 'user-gave-up' } })).toBe('Gave up');
    // The CLI points people at these two places by name.
    expect(i18n.t('nav.settings')).toBe('Settings');
    expect(i18n.t('settingsNav.sections.connections')).toBe('AI connections');
    expect(i18n.t('settingsNav.sections.profiles')).toBe('Run profiles');
    expect(serverText({ code: 'too-many-combinations', params: { max: 1000 } })).toBe('At most 1000 runs can be made at once.');
    expect(serverText({ code: 'not-a-code' })).toBe(en.get('serverMessages.request-failed'));
    expect(i18n.t('taskList.count', { count: 1 })).not.toBe(i18n.t('taskList.count', { count: 2 }));
    await i18n.changeLanguage('ko');
    expect(resultLabel({ state: 'success', outcome: { status: 'success' } })).toBe('해냄');
    expect(serverText({ code: 'too-many-combinations', params: { max: 1000 } })).toBe('한 번에 실행할 수 있는 조합은 최대 1000개입니다.');
  });
});
