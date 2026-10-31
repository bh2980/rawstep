import { describe, expect, it } from 'vitest';
import { parseRoute, routeSearch } from '../packages/dashboard/src/web/hooks/useRoute.js';
import { personaOf, withPreset } from '../packages/dashboard/src/web/lib/persona.js';
import { formatSteps, relativeTime } from '../packages/dashboard/src/web/lib/format.js';
import { defaultProfile } from '@rawstep/project/config';

describe('routes', () => {
  it('keeps the page in the URL: the task list first, tasks and runs under 작업, every setting under 설정', () => {
    expect(routeSearch({})).toBe('/');
    expect(routeSearch({ view: 'tasks' })).toBe('/');
    expect(routeSearch({ view: 'runs' })).toBe('?view=runs');
    // 설정 holds everything that is configured; its part is in `section`, and only there.
    expect(routeSearch({ view: 'settings' })).toBe('?view=settings');
    expect(routeSearch({ view: 'settings', section: 'profiles' })).toBe('?view=settings&section=profiles');
    expect(routeSearch({ view: 'runs', section: 'profiles' })).toBe('?view=runs');
    expect(routeSearch({ task: 'abc' })).toBe('?task=abc');
    expect(routeSearch({ task: 'abc', run: 'r1', step: 3 })).toBe('?task=abc&run=r1&step=3');
    expect(routeSearch({ task: 'abc', tab: 'check' })).toBe('?task=abc&tab=check');
    expect(routeSearch({ task: 'abc', tab: 'overview' })).toBe('?task=abc');
    // A tab belongs to the task page and a step to a run; neither is kept on the other.
    expect(routeSearch({ task: 'abc', run: 'r1', tab: 'settings' })).toBe('?task=abc&run=r1');
    expect(routeSearch({ task: 'abc', tab: 'settings', step: 2 })).toBe('?task=abc&tab=settings');
    expect(parseRoute('')).toEqual({ view: 'tasks', tab: 'overview' });
    expect(parseRoute('?view=connections')).toEqual({ view: 'settings', section: 'connections', tab: 'overview' });
    expect(parseRoute('?view=conditions')).toEqual({ view: 'settings', section: 'profiles', tab: 'overview' });
    expect(parseRoute('?view=home')).toEqual({ view: 'tasks', tab: 'overview' });
    expect(parseRoute('?view=settings&section=machine')).toEqual({ view: 'settings', section: 'machine', tab: 'overview' });
    expect(parseRoute('?view=nonsense')).toMatchObject({ view: 'tasks' });
    expect(parseRoute('?view=settings&section=nonsense')).toEqual({ view: 'settings', tab: 'overview' });
    // Old and unknown pages fall back to the task list; old 실험 조건 and 연결 addresses open their part of 설정 (실행 프로필 and 연결).
    expect(parseRoute('?view=agents')).toMatchObject({ view: 'tasks' });
    expect(parseRoute('?task=abc&run=r1&step=2')).toEqual({ view: 'tasks', task: 'abc', run: 'r1', tab: 'overview', step: 2 });
    expect(parseRoute('?task=abc&tab=settings')).toMatchObject({ task: 'abc', tab: 'settings' });
    expect(parseRoute('?task=abc&tab=nonsense')).toMatchObject({ tab: 'overview' });
    expect(parseRoute('?task=abc&step=2')).not.toHaveProperty('step');
    expect(parseRoute('?view=runs&run=r1')).not.toHaveProperty('run');
    for (const search of ['?view=runs', '?view=settings', '?view=settings&section=profiles', '?task=new', '?task=a&tab=check', '?task=a&tab=runs', '?task=a&run=b&step=0']) expect(routeSearch(parseRoute(search))).toBe(search);
  });
});

describe('screen reader ways of finding things', () => {
  it('starts each way from item-by-item reading plus one way of jumping, and recognises it whatever the order', () => {
    const profile = defaultProfile();
    expect(personaOf(profile)).toBe('linear');
    const headings = withPreset(profile, 'headings');
    expect(headings.actions.intents).toEqual(['next', 'previous', 'activate', 'heading.next', 'heading.previous', 'headings.list']);
    expect(headings.actions.typeText).toBe(true);
    expect(withPreset(profile, 'formControls').actions.intents).toContain('formControls.rotor');
    expect(withPreset(profile, 'links').actions.intents).toContain('links.list');
    expect(personaOf({ actions: { ...headings.actions, intents: [...headings.actions.intents].reverse() } })).toBe('headings');
    // Two ways at once is not one of the starting points.
    expect(personaOf({ actions: { ...headings.actions, intents: [...headings.actions.intents, 'link.next'] } })).toBe('custom');
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
