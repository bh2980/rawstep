import { describe, expect, it } from 'vitest';
import { browserChoiceOf, browserField, DEFAULT_BROWSER, needsEndpoint, type BrowserChoice } from '../packages/dashboard/src/web/lib/taskBrowser.js';
import { updateTaskJson } from '../packages/dashboard/src/web/lib/taskJson.js';
import { anyUsual, effectiveMode, profileRequest, profilesPerTask, profilesUsed, runTotal, startingChoice, usualProfileIds, withoutProfiles } from '../packages/dashboard/src/web/lib/usualProfiles.js';

describe('the browser a task opens', () => {
  it('reads the choice from the task file: no field launches a browser, connect with copySignIn is its own choice', () => {
    expect(browserChoiceOf({})).toEqual(DEFAULT_BROWSER);
    expect(browserChoiceOf(undefined)).toEqual(DEFAULT_BROWSER);
    expect(browserChoiceOf({ browser: 'connect' })).toEqual(DEFAULT_BROWSER);
    expect(browserChoiceOf({ browser: { mode: 'launch' } })).toEqual({ mode: 'launch', personCheck: false });
    expect(browserChoiceOf({ browser: { mode: 'launch', personCheck: true } })).toEqual({ mode: 'launch', personCheck: true });
    expect(browserChoiceOf({ browser: { mode: 'connect' } })).toEqual({ mode: 'connect', personCheck: false });
    expect(browserChoiceOf({ browser: { mode: 'connect', copySignIn: true, personCheck: true } })).toEqual({ mode: 'copySignIn', personCheck: true });
    // A launched browser has nothing to copy a sign-in from.
    expect(browserChoiceOf({ browser: { mode: 'launch', copySignIn: true } })).toEqual({ mode: 'launch', personCheck: false });
  });

  it('writes nothing for a launched browser without a person check, and the shortest field otherwise', () => {
    expect(browserField({ mode: 'launch', personCheck: false })).toBeUndefined();
    expect(browserField({ mode: 'launch', personCheck: true })).toEqual({ mode: 'launch', personCheck: true });
    expect(browserField({ mode: 'connect', personCheck: false })).toEqual({ mode: 'connect' });
    expect(browserField({ mode: 'copySignIn', personCheck: false })).toEqual({ mode: 'connect', copySignIn: true });
    expect(browserField({ mode: 'copySignIn', personCheck: true })).toEqual({ mode: 'connect', copySignIn: true, personCheck: true });
    // Reading what was written gives the choice back.
    for (const mode of ['launch', 'connect', 'copySignIn'] as const) for (const personCheck of [false, true]) {
      const choice: BrowserChoice = { mode, personCheck };
      expect(browserChoiceOf({ browser: browserField(choice) })).toEqual(choice);
    }
  });

  it('adds, changes and removes the browser field of a task file without touching the rest', () => {
    const file = JSON.stringify({ url: 'https://example.com/', goal: 'Buy', verify: { all: [] } });
    const connected = updateTaskJson(file, { browser: browserField({ mode: 'copySignIn', personCheck: false }) });
    expect(JSON.parse(connected)).toEqual({ url: 'https://example.com/', goal: 'Buy', verify: { all: [] }, browser: { mode: 'connect', copySignIn: true } });
    const back = updateTaskJson(connected, { browser: browserField(DEFAULT_BROWSER) });
    expect(JSON.parse(back)).toEqual({ url: 'https://example.com/', goal: 'Buy', verify: { all: [] } });
    expect(back).not.toContain('browser');
  });

  it('needs the address of the Chrome only when the task connects to one', () => {
    expect(needsEndpoint({ mode: 'launch', personCheck: true })).toBe(false);
    expect(needsEndpoint({ mode: 'connect', personCheck: false })).toBe(true);
    expect(needsEndpoint({ mode: 'copySignIn', personCheck: false })).toBe(true);
  });
});

const profiles = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

describe('the profiles a task usually runs with', () => {
  it('keeps the usual profiles that still exist, in the task\'s order', () => {
    expect(usualProfileIds({ id: 'a', profiles: ['p3', 'gone', 'p1'] }, profiles)).toEqual(['p3', 'p1']);
    expect(usualProfileIds({ id: 'a' }, profiles)).toEqual([]);
    expect(anyUsual([{ id: 'a' }, { id: 'b', profiles: ['p2'] }], profiles)).toBe(true);
    expect(anyUsual([{ id: 'a', profiles: ['gone'] }], profiles)).toBe(false);
  });

  it('starts the run dialog from the tasks: one task with its profiles, several tasks per task, otherwise the usual default', () => {
    const a = { id: 'a', profiles: ['p2', 'p3'] }, b = { id: 'b' };
    expect(startingChoice([a], profiles, 'p1')).toEqual({ mode: 'explicit', profileIds: ['p2', 'p3'] });
    expect(startingChoice([b], profiles, 'p1')).toEqual({ mode: 'explicit', profileIds: ['p1'] });
    expect(startingChoice([a, b], profiles, 'p1')).toEqual({ mode: 'perTask', profileIds: ['p1'] });
    expect(startingChoice([b, { id: 'c' }], profiles, 'p1')).toEqual({ mode: 'explicit', profileIds: ['p1'] });
    expect(startingChoice([], profiles, undefined)).toEqual({ mode: 'explicit', profileIds: [] });
    // Several tasks that all have no usual profiles never get the per-task choice.
    expect(effectiveMode('perTask', [b, { id: 'c' }], profiles)).toBe('explicit');
    expect(effectiveMode('perTask', [a], profiles)).toBe('explicit');
    expect(effectiveMode('perTask', [a, b], profiles)).toBe('perTask');
    expect(effectiveMode('explicit', [a, b], profiles)).toBe('explicit');
  });

  it('gives each task its own profiles, the first profile to a task with none, and counts the runs that makes', () => {
    const a = { id: 'a', profiles: ['p2', 'p3'] }, b = { id: 'b' }, c = { id: 'c', profiles: ['p3'] };
    const perTask = profilesPerTask([a, b, c], profiles, 'perTask', ['p1']);
    expect(perTask).toEqual([{ taskId: 'a', profileIds: ['p2', 'p3'] }, { taskId: 'b', profileIds: ['p1'] }, { taskId: 'c', profileIds: ['p3'] }]);
    expect(runTotal(perTask, 1)).toBe(4);
    expect(runTotal(perTask, 3)).toBe(12);
    expect(profilesUsed(perTask)).toEqual(['p2', 'p3', 'p1']);
    const same = profilesPerTask([a, b, c], profiles, 'explicit', ['p1', 'p2', 'gone']);
    expect(same.map(item => item.profileIds)).toEqual([['p1', 'p2'], ['p1', 'p2'], ['p1', 'p2']]);
    expect(runTotal(same, 2)).toBe(12);
    expect(runTotal(profilesPerTask([a], profiles, 'explicit', []), 1)).toBe(0);
  });

  it('sends one list for all tasks, or every task\'s own list with all the profiles used', () => {
    const a = { id: 'a', profiles: ['p2'] }, b = { id: 'b' };
    expect(profileRequest(profilesPerTask([a, b], profiles, 'explicit', ['p1', 'p3']), 'explicit')).toEqual({ profileIds: ['p1', 'p3'] });
    expect(profileRequest(profilesPerTask([a, b], profiles, 'perTask', []), 'perTask')).toEqual({ profileIds: ['p2', 'p1'], profilesByTask: { a: ['p2'], b: ['p1'] } });
  });

  it('takes a deleted profile off the tasks that listed it, and drops the field when none are left', () => {
    const tasks = [{ id: 'a', profiles: ['p1', 'p2'] }, { id: 'b', profiles: ['p2'] }, { id: 'c' }, { id: 'd', profiles: ['p3'] }];
    const after = withoutProfiles(tasks, ['p2']);
    expect(after).toEqual([{ id: 'a', profiles: ['p1'] }, { id: 'b' }, { id: 'c' }, { id: 'd', profiles: ['p3'] }]);
    expect(after[3]).toBe(tasks[3]);
    expect(after[1]).not.toHaveProperty('profiles');
  });
});
