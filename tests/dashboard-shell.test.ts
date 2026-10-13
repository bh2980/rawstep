import { describe, expect, it } from 'vitest';
import { parseRoute, routeSearch } from '../packages/dashboard/src/web/hooks/useRoute.js';
import { matchingPreset, presetPermissions } from '../packages/dashboard/src/web/lib/presets.js';
import { formatSteps, relativeTime } from '../packages/dashboard/src/web/lib/format.js';
import { DEFAULT_PERMISSIONS } from '@rawstep/project/config';

describe('routes', () => {
  it('keeps the page in the URL: the task list first, tasks and runs under 작업, every setting under 설정', () => {
    expect(routeSearch({})).toBe('/');
    expect(routeSearch({ view: 'tasks' })).toBe('/');
    expect(routeSearch({ view: 'runs' })).toBe('?view=runs');
    // 설정 holds everything that is configured; its part is in `section`, and only there.
    expect(routeSearch({ view: 'settings' })).toBe('?view=settings');
    expect(routeSearch({ view: 'settings', section: 'combos' })).toBe('?view=settings&section=combos');
    expect(routeSearch({ view: 'runs', section: 'combos' })).toBe('?view=runs');
    expect(routeSearch({ task: 'abc' })).toBe('?task=abc');
    expect(routeSearch({ task: 'abc', run: 'r1', step: 3 })).toBe('?task=abc&run=r1&step=3');
    expect(routeSearch({ task: 'abc', tab: 'check' })).toBe('?task=abc&tab=check');
    expect(routeSearch({ task: 'abc', tab: 'overview' })).toBe('?task=abc');
    // A tab belongs to the task page and a step to a run; neither is kept on the other.
    expect(routeSearch({ task: 'abc', run: 'r1', tab: 'settings' })).toBe('?task=abc&run=r1');
    expect(routeSearch({ task: 'abc', tab: 'settings', step: 2 })).toBe('?task=abc&tab=settings');
    expect(parseRoute('')).toEqual({ view: 'tasks', tab: 'overview' });
    expect(parseRoute('?view=connections')).toEqual({ view: 'settings', section: 'connections', tab: 'overview' });
    expect(parseRoute('?view=conditions')).toEqual({ view: 'settings', section: 'combos', tab: 'overview' });
    expect(parseRoute('?view=home')).toEqual({ view: 'tasks', tab: 'overview' });
    expect(parseRoute('?view=settings&section=machine')).toEqual({ view: 'settings', section: 'machine', tab: 'overview' });
    expect(parseRoute('?view=nonsense')).toMatchObject({ view: 'tasks' });
    expect(parseRoute('?view=settings&section=nonsense')).toEqual({ view: 'settings', tab: 'overview' });
    // Old and unknown pages fall back to the task list; old 실험 조건 and 연결 addresses open their part of 설정.
    expect(parseRoute('?view=agents')).toMatchObject({ view: 'tasks' });
    expect(parseRoute('?task=abc&run=r1&step=2')).toEqual({ view: 'tasks', task: 'abc', run: 'r1', tab: 'overview', step: 2 });
    expect(parseRoute('?task=abc&tab=settings')).toMatchObject({ task: 'abc', tab: 'settings' });
    expect(parseRoute('?task=abc&tab=nonsense')).toMatchObject({ tab: 'overview' });
    expect(parseRoute('?task=abc&step=2')).not.toHaveProperty('step');
    expect(parseRoute('?view=runs&run=r1')).not.toHaveProperty('run');
    for (const search of ['?view=runs', '?view=settings', '?view=settings&section=presets', '?task=new', '?task=a&tab=check', '?task=a&tab=runs', '?task=a&run=b&step=0']) expect(routeSearch(parseRoute(search))).toBe(search);
  });
});

describe('action set presets', () => {
  it('starts novice, expert and widget sets and recognises them whatever the order', () => {
    const novice = presetPermissions('novice');
    expect(novice.keyboard.keys).toEqual(['Tab', 'Shift+Tab', 'Enter', 'Space']);
    expect(novice.screenreader.intents).toEqual(['next', 'previous', 'activate']);
    expect(novice.screenreader.typeText).toBe(false);
    const expert = presetPermissions('expert');
    expect(expert.screenreader.intents).toEqual(['next', 'previous', 'activate', 'heading.next', 'heading.previous', 'form.next']);
    expect(expert.screenreader.typeText).toBe(true);
    expect(presetPermissions('widgets').keyboard.keys).toEqual(['Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End']);
    expect(matchingPreset(DEFAULT_PERMISSIONS)).toBe('novice');
    expect(matchingPreset({ ...novice, keyboard: { ...novice.keyboard, keys: ['Space', 'Enter', 'Shift+Tab', 'Tab'] } })).toBe('novice');
    expect(matchingPreset(expert)).toBe('expert');
    expect(matchingPreset({ ...novice, screenreader: { ...novice.screenreader, intents: ['next'] } })).toBeUndefined();
    expect(matchingPreset({ ...novice, screenreader: { ...novice.screenreader, inputKeys: ['q'] } })).toBeUndefined();
  });
});

describe('list formatting', () => {
  const now = Date.parse('2026-05-10T12:00:00+09:00');
  it('words how long ago a run was and falls back to a date after a week', () => {
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime('2026-05-10T11:50:00+09:00', now)).toBe('10분 전');
    expect(relativeTime('2026-05-10T09:00:00+09:00', now)).toBe('3시간 전');
    expect(relativeTime('2026-05-09T11:00:00+09:00', now)).toBe('어제');
    expect(relativeTime('2026-05-07T12:00:00+09:00', now)).toBe('3일 전');
    expect(relativeTime('2026-04-01T12:00:00+09:00', now)).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
  });
  it('writes action counts without noise', () => {
    expect([formatSteps(null), formatSteps(6), formatSteps(5.5), formatSteps(undefined)]).toEqual(['—', '6', '5.5', '—']);
  });
});
