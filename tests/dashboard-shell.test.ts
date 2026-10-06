import { describe, expect, it } from 'vitest';
import { parseRoute, routeSearch } from '../packages/dashboard/src/web/hooks/useRoute.js';
import { applyKeyboardPreset, applyScreenreaderPreset, keyboardPreset, quickAvailable, screenreaderPreset } from '../packages/dashboard/src/web/lib/presets.js';
import { formatSteps, relativeTime } from '../packages/dashboard/src/web/lib/format.js';
import { defaultProfile } from '@rawstep/project/config';

describe('routes', () => {
  it('keeps the page in the URL and puts tasks, new tasks and runs under the 작업 menu', () => {
    expect(routeSearch({})).toBe('/');
    expect(routeSearch({ view: 'tasks' })).toBe('?view=tasks');
    expect(routeSearch({ view: 'runs' })).toBe('?view=runs');
    expect(routeSearch({ view: 'settings', section: 'profiles' })).toBe('?view=settings&section=profiles');
    expect(routeSearch({ view: 'settings' })).toBe('?view=settings&section=models');
    expect(routeSearch({ task: 'abc' })).toBe('?task=abc');
    expect(routeSearch({ task: 'abc', run: 'r1', step: 3 })).toBe('?task=abc&run=r1&step=3');
    expect(routeSearch({ task: 'abc', tab: 'check' })).toBe('?task=abc&tab=check');
    expect(routeSearch({ task: 'abc', tab: 'overview' })).toBe('?task=abc');
    // A tab belongs to the task page and a step to a run; neither is kept on the other.
    expect(routeSearch({ task: 'abc', run: 'r1', tab: 'settings' })).toBe('?task=abc&run=r1');
    expect(routeSearch({ task: 'abc', tab: 'settings', step: 2 })).toBe('?task=abc&tab=settings');
    expect(parseRoute('')).toMatchObject({ view: 'home', section: 'models', tab: 'overview' });
    expect(parseRoute('?view=settings&section=machine')).toMatchObject({ view: 'settings', section: 'machine' });
    expect(parseRoute('?view=nonsense&section=nonsense')).toMatchObject({ view: 'home', section: 'models' });
    expect(parseRoute('?task=abc&run=r1&step=2')).toEqual({ view: 'tasks', section: 'models', task: 'abc', run: 'r1', tab: 'overview', step: 2 });
    expect(parseRoute('?task=abc&tab=settings')).toMatchObject({ task: 'abc', tab: 'settings' });
    expect(parseRoute('?task=abc&tab=nonsense')).toMatchObject({ tab: 'overview' });
    expect(parseRoute('?task=abc&step=2')).not.toHaveProperty('step');
    expect(parseRoute('?view=runs&run=r1')).not.toHaveProperty('run');
    for (const search of ['?view=tasks', '?view=settings&section=machine', '?task=new', '?task=a&tab=check', '?task=a&run=b&step=0']) expect(routeSearch(parseRoute(search))).toBe(search);
  });
});

describe('allowed-action presets', () => {
  const keyboard = defaultProfile().permissions.keyboard, screenreader = defaultProfile().permissions.screenreader;
  const simulation = { keys: [], intents: ['next', 'previous', 'readCurrent', 'readFocused', 'activate'] };
  const native = { keys: [], intents: ['next', 'previous', 'activate', 'interact', 'stopInteracting', 'heading.next', 'heading.previous', 'form.next'] };

  it('recognises the keyboard presets whatever the order and treats anything else as custom', () => {
    expect(keyboardPreset(keyboard)).toBe('basic');
    expect(keyboardPreset({ keys: ['Space', 'Enter', 'Shift+Tab', 'Tab'], intents: [] })).toBe('basic');
    const widgets = applyKeyboardPreset(keyboard, 'widgets');
    expect(widgets.keys).toEqual(['Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End']);
    expect(keyboardPreset(widgets)).toBe('widgets');
    expect(keyboardPreset({ ...keyboard, keys: [...keyboard.keys, 'PageDown'] })).toBe('custom');
    expect(keyboardPreset({ ...keyboard, keys: [] })).toBe('custom');
    expect(keyboardPreset({ ...keyboard, intents: ['next'] })).toBe('custom');
    expect(applyKeyboardPreset({ ...keyboard, typeText: true }, 'basic')).toEqual({ ...keyboard, typeText: true });
  });

  it('offers quick navigation only to screen readers that have it and keeps typing settings when a preset is picked', () => {
    expect(quickAvailable(simulation)).toBe(false);
    expect(quickAvailable(native)).toBe(true);
    expect(screenreaderPreset(screenreader, simulation)).toBe('basic');
    const quick = applyScreenreaderPreset({ ...screenreader, typeText: true }, 'quick', native);
    expect(quick.intents).toEqual(['next', 'previous', 'activate', 'heading.next', 'heading.previous', 'form.next']);
    expect(quick.typeText).toBe(true);
    expect(screenreaderPreset(quick, native)).toBe('quick');
    // The same intents under the simulation are not a preset: the backend would refuse them.
    expect(screenreaderPreset(quick, simulation)).toBe('custom');
    expect(applyScreenreaderPreset(screenreader, 'quick', simulation).intents).toEqual(['next', 'previous', 'activate']);
    expect(screenreaderPreset({ ...screenreader, intents: ['readCurrent'] }, simulation)).toBe('custom');
    expect(screenreaderPreset({ keys: ['Tab'], intents: ['next', 'previous', 'activate'] }, native)).toBe('custom');
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
