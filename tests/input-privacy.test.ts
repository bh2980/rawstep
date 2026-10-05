import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeInputs, resolveTask } from '@rawstep/core/contracts';
import type { Backend, BackendAction, Decision, DecisionPolicy, Task, VerificationRecord } from '@rawstep/core/contracts';
import type { BrowserSession } from '@rawstep/browser/browser';
import { runTask } from '@rawstep/browser/runner';

const verify = { all: [{ titleIncludes: 'Done' }] };
const base = { url: 'https://example.test/', goal: 'Sign in with the stored credentials', verify };

describe('resolveTask inputOptions', () => {
  const resolve = (extra: Record<string, unknown>) => resolveTask({ ...base, ...extra });
  it('accepts per-input options and keeps them on the resolved task', () => {
    const inputOptions = { email: { sensitive: false, description: 'Account email' }, password: { sensitive: true }, note: {} };
    const task = resolve({ input: { email: 'a@example.test', password: 'hunter2-secret', note: 'x' }, inputOptions });
    expect(task.inputOptions).toEqual(inputOptions);
    expect(task.inputOptions).not.toBe(inputOptions);
  });
  it('omits inputOptions when none are given', () => {
    expect('inputOptions' in resolve({ input: { email: 'a@example.test' } })).toBe(false);
  });
  it('accepts descriptions of exactly 1 and 200 characters', () => {
    expect(() => resolve({ input: { q: 'v' }, inputOptions: { q: { description: 'x' } } })).not.toThrow();
    expect(() => resolve({ input: { q: 'v' }, inputOptions: { q: { description: 'x'.repeat(200) } } })).not.toThrow();
  });
  it.each([
    ['an unknown input name', { input: { q: 'v' }, inputOptions: { other: { sensitive: false } } }, /unknown input other/],
    ['options without any task input', { inputOptions: { q: { sensitive: false } } }, /unknown input q/],
    ['an extra option key', { input: { q: 'v' }, inputOptions: { q: { sensitive: true, mask: true } } }, /unsupported field mask/],
    ['a string sensitive flag', { input: { q: 'v' }, inputOptions: { q: { sensitive: 'false' } } }, /sensitive must be boolean/],
    ['a numeric sensitive flag', { input: { q: 'v' }, inputOptions: { q: { sensitive: 0 } } }, /sensitive must be boolean/],
    ['a null sensitive flag', { input: { q: 'v' }, inputOptions: { q: { sensitive: null } } }, /sensitive must be boolean/],
    ['an empty description', { input: { q: 'v' }, inputOptions: { q: { description: '' } } }, /description must be a nonempty string/],
    ['a blank description', { input: { q: 'v' }, inputOptions: { q: { description: '   ' } } }, /description must be a nonempty string/],
    ['a 201 character description', { input: { q: 'v' }, inputOptions: { q: { description: 'x'.repeat(201) } } }, /up to 200 characters/],
    ['a non-string description', { input: { q: 'v' }, inputOptions: { q: { description: 5 } } }, /description must be a nonempty string/],
    ['a string inputOptions', { input: { q: 'v' }, inputOptions: 'sensitive' }, /inputOptions must map/],
    ['an array inputOptions', { input: { q: 'v' }, inputOptions: [] }, /inputOptions must map/],
    ['a null inputOptions', { input: { q: 'v' }, inputOptions: null }, /inputOptions must map/],
    ['a string option entry', { input: { q: 'v' }, inputOptions: { q: 'secret' } }, /inputOptions\.q must be an object/],
    ['a null option entry', { input: { q: 'v' }, inputOptions: { q: null } }, /inputOptions\.q must be an object/],
    ['an array option entry', { input: { q: 'v' }, inputOptions: { q: [] } }, /inputOptions\.q must be an object/],
  ] as const)('rejects %s', (_label, extra, message) => {
    expect(() => resolve(extra)).toThrow(message);
  });
  describe('goal check', () => {
    it('rejects a goal containing a sensitive value of 4 or more characters', () => {
      expect(() => resolveTask({ ...base, goal: 'Type hunter2-secret into the password field', input: { password: 'hunter2-secret' } })).toThrow(/goal contains the value of input password/);
    });
    it('treats inputs as sensitive by default, with an empty options object, and with sensitive: true', () => {
      for (const inputOptions of [undefined, {}, { code: {} }, { code: { sensitive: true } }]) {
        expect(() => resolveTask({ ...base, goal: 'Enter 1234 now', input: { code: '1234' }, ...(inputOptions ? { inputOptions } : {}) })).toThrow(/goal contains the value/);
      }
    });
    it('applies the check at the exact 4 character boundary and is case-sensitive', () => {
      expect(() => resolveTask({ ...base, goal: 'Enter 123 now', input: { code: '123' } })).not.toThrow();
      expect(() => resolveTask({ ...base, goal: 'Enter 1234 now', input: { code: '1234' } })).toThrow();
      expect(() => resolveTask({ ...base, goal: 'Enter ABCD now', input: { code: 'abcd' } })).not.toThrow();
    });
    it('accepts the same goal when that input is marked sensitive: false', () => {
      const task = resolveTask({ ...base, goal: 'Search for rawstep docs', input: { query: 'rawstep' }, inputOptions: { query: { sensitive: false } } });
      expect(task.goal).toContain('rawstep');
    });
    it('still rejects a goal that contains another input that stays sensitive', () => {
      expect(() => resolveTask({ ...base, goal: 'Search rawstep as secret-token-9', input: { query: 'rawstep', token: 'secret-token-9' }, inputOptions: { query: { sensitive: false } } })).toThrow(/input token/);
    });
    it.each(['a', 'ab', 'abc', '42'])('accepts a goal containing the short value %j', value => {
      expect(() => resolveTask({ ...base, goal: `Pick option ${value} from the list`, input: { choice: value } })).not.toThrow();
    });
  });
});

describe('describeInputs', () => {
  it('returns names, sensitivity and optional descriptions only', () => {
    const task: Pick<Task, 'input' | 'inputOptions'> = {
      input: { email: 'a@example.test', password: 'hunter2-secret', query: 'rawstep' },
      inputOptions: { email: { description: 'Account email' }, query: { sensitive: false } },
    };
    const described = describeInputs(task);
    expect(described).toEqual({ email: { sensitive: true, description: 'Account email' }, password: { sensitive: true }, query: { sensitive: false } });
    expect(JSON.stringify(described)).not.toMatch(/a@example\.test|hunter2|rawstep/);
  });
  it('is empty without inputs and frozen at every level', () => {
    expect(describeInputs({})).toEqual({});
    const described = describeInputs({ input: { a: 'x' }, inputOptions: { a: { description: 'd' } } });
    expect(Object.isFrozen(described)).toBe(true);
    expect(Object.isFrozen(described.a)).toBe(true);
    expect(() => { (described as Record<string, unknown>).b = {}; }).toThrow(TypeError);
    expect(() => { (described.a as { sensitive: boolean }).sensitive = false; }).toThrow(TypeError);
  });
});

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function out() { const path = await mkdtemp(join(tmpdir(), 'rawstep-input-privacy-')); dirs.push(path); return path; }

/** A screen-reader backend whose nth observation says whatever `speechFor(n)` returns. */
function screenReaderFixture(speechFor: (n: number) => string[] = n => [`Observation ${n}`]) {
  let n = -1;
  const backend: Backend = {
    capabilities: { intents: [], keys: ['Tab'], textEntry: true, replaceText: true },
    start: vi.fn(async () => ({})),
    execute: vi.fn(async (action: BackendAction) => ({ action })),
    observe: vi.fn(async () => {
      n++;
      const now = new Date().toISOString();
      return { windowId: `w-${n}`, startedAt: now, endedAt: now, reason: 'quiet', outputs: [], speech: speechFor(n) };
    }),
    close: vi.fn(async () => {}),
    subscribe: () => () => {},
  };
  const browser = { page: { bringToFront: async () => {}, evaluate: async () => true, screenshot: async () => {} }, browser: { version: () => 'test-browser' }, takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: async () => {} } as unknown as BrowserSession;
  const verifier = vi.fn(async (): Promise<VerificationRecord> => ({ passed: false, failures: ['not done'] }));
  return { backend, browserSessionFactory: async () => browser, verifier };
}
type DecideInput = Omit<Parameters<DecisionPolicy['decide']>[0], 'signal'>;
/** Records a deep copy of every decide() input, then plays the scripted decisions. */
function recordingPolicy(decisions: Decision[]) {
  const calls: DecideInput[] = [];
  const policy: DecisionPolicy = { decide: input => { const { signal: _signal, ...rest } = input; calls.push(structuredClone(rest)); return decisions[calls.length - 1] ?? { stop: 'stuck' }; } };
  return { policy, calls };
}
const type = (input: string): Decision => ({ action: { kind: 'typeText', input } });
const tab: Decision = { action: { kind: 'key', key: 'Tab' } };
const speechOf = (observation: DecideInput['observation']) => { if (observation.kind !== 'screenreader') throw new Error('expected screen reader observation'); return observation.speech; };

describe('runner input privacy', () => {
  const secret = 'hunter2-secret';
  const task: Task = { url: 'https://example.test/', goal: 'Sign in with the stored credentials', maxSteps: 4, timeoutMs: 5000, verify, input: { email: secret, nick: 'rawstep-user' }, inputOptions: { email: { description: 'Account email' }, nick: { sensitive: false } } };

  it('gives the policy descriptors only, and no decide() input ever contains a value', async () => {
    const f = screenReaderFixture(n => [`Edit text, entered ${n}`]);
    const { policy, calls } = recordingPolicy([type('email'), type('nick'), tab, { stop: 'stuck' }]);
    await runTask(task, { ...f, outDir: await out(), policy });
    expect(calls.length).toBe(4);
    for (const call of calls) {
      expect(call.inputs).toEqual({ email: { sensitive: true, description: 'Account email' }, nick: { sensitive: false } });
      expect(call.allowedActions.inputKeys).toEqual(['email', 'nick']);
      expect(JSON.stringify(call)).not.toContain(secret);
      expect(JSON.stringify(call)).not.toContain('rawstep-user');
    }
  });

  it('passes sensitive:true by default and sensitive:false when configured to the backend', async () => {
    const f = screenReaderFixture();
    await runTask(task, { ...f, outDir: await out(), policy: recordingPolicy([type('email'), type('nick'), { stop: 'stuck' }]).policy });
    expect(f.backend.execute).toHaveBeenNthCalledWith(1, { kind: 'typeText', text: secret, sensitive: true }, expect.anything());
    expect(f.backend.execute).toHaveBeenNthCalledWith(2, { kind: 'typeText', text: 'rawstep-user', sensitive: false }, expect.anything());
  });

  it('passes sensitive:true for replaceText and for inputs without any inputOptions', async () => {
    const f = screenReaderFixture();
    await runTask({ ...task, inputOptions: undefined }, { ...f, outDir: await out(), policy: recordingPolicy([{ action: { kind: 'replaceText', input: 'nick' } }, { stop: 'stuck' }]).policy });
    expect(f.backend.execute).toHaveBeenCalledWith({ kind: 'replaceText', text: 'rawstep-user', sensitive: true }, expect.anything());
  });

  it('withholds the speech right after a sensitive typing step and passes it through for sensitive:false', async () => {
    const f = screenReaderFixture(n => n === 0 ? ['Edit text, blank'] : [`Edit text, ${n === 1 ? secret : 'rawstep-user'} entered`]);
    const { policy, calls } = recordingPolicy([type('email'), type('nick'), { stop: 'stuck' }]);
    await runTask(task, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[0]!.observation)).toEqual(['Edit text, blank']);
    expect(speechOf(calls[1]!.observation)).toEqual(['[typed input withheld]']);
    expect(speechOf(calls[2]!.observation)).toEqual(['Edit text, rawstep-user entered']);
    // The same view applies inside history.
    expect(calls[2]!.history.map(entry => speechOf(entry.observation))).toEqual([['Edit text, blank'], ['[typed input withheld]']]);
  });

  it('replaces a later full sensitive value with [REDACTED] in the policy input and in history', async () => {
    const speech = [['Ready'], ['typing echo h u n t e r'], [`Greeting: ${secret} saved`, 'Next'], [`Welcome back ${secret} and ${secret}`], ['Done']];
    const f = screenReaderFixture(n => speech[n]!);
    const { policy, calls } = recordingPolicy([type('email'), tab, tab, tab, { stop: 'stuck' }]);
    await runTask({ ...task, maxSteps: 5 }, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[1]!.observation)).toEqual(['[typed input withheld]']);
    expect(speechOf(calls[2]!.observation)).toEqual(['Greeting: [REDACTED] saved', 'Next']);
    expect(speechOf(calls[3]!.observation)).toEqual(['Welcome back [REDACTED] and [REDACTED]']);
    expect(calls[4]!.history.map(entry => speechOf(entry.observation))).toEqual([['Ready'], ['[typed input withheld]'], ['Greeting: [REDACTED] saved', 'Next'], ['Welcome back [REDACTED] and [REDACTED]']]);
    for (const call of calls) expect(JSON.stringify(call)).not.toContain(secret);
  });

  it('also masks the URL-encoded form of a sensitive value', async () => {
    const value = 'p@ss word 99';
    const f = screenReaderFixture(n => n < 2 ? ['Ready'] : [`Link: /login?pw=${encodeURIComponent(value)}`]);
    const { policy, calls } = recordingPolicy([type('email'), tab, { stop: 'stuck' }]);
    await runTask({ ...task, input: { email: value }, inputOptions: undefined }, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[2]!.observation)).toEqual(['Link: /login?pw=[REDACTED]']);
  });

  it('does not mask the value in later speech when the input is sensitive:false', async () => {
    const f = screenReaderFixture(n => n < 2 ? ['Ready'] : [`Saved ${secret}`]);
    const { policy, calls } = recordingPolicy([type('email'), tab, { stop: 'stuck' }]);
    await runTask({ ...task, inputOptions: { email: { sensitive: false } } }, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[1]!.observation)).toEqual(['Ready']);
    expect(speechOf(calls[2]!.observation)).toEqual([`Saved ${secret}`]);
    expect(f.backend.execute).toHaveBeenCalledWith({ kind: 'typeText', text: secret, sensitive: false }, expect.anything());
  });

  it.each(['7', '42', 'abc'])('does not substring-mask a short value (%j) in later speech, but still withholds the typing step', async value => {
    // Documented limitation: matching a 1-3 character value would destroy unrelated speech.
    const speech = [['Ready'], [`Field now ${value}`], [`Item ${value} of 10 about ${value}`], ['Done']];
    const f = screenReaderFixture(n => speech[n]!);
    const { policy, calls } = recordingPolicy([type('email'), tab, { stop: 'stuck' }]);
    await runTask({ ...task, input: { email: value }, inputOptions: undefined }, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[1]!.observation)).toEqual(['[typed input withheld]']);
    expect(speechOf(calls[2]!.observation)).toEqual([`Item ${value} of 10 about ${value}`]);
    expect(f.backend.execute).toHaveBeenCalledWith({ kind: 'typeText', text: value, sensitive: true }, expect.anything());
  });

  it('masks a value of exactly 4 characters', async () => {
    const f = screenReaderFixture(n => n < 2 ? ['Ready'] : ['PIN is 1234 ok']);
    const { policy, calls } = recordingPolicy([type('email'), tab, { stop: 'stuck' }]);
    await runTask({ ...task, input: { email: '1234' }, inputOptions: undefined }, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[2]!.observation)).toEqual(['PIN is [REDACTED] ok']);
  });

  it('does not withhold speech when the typing step fails to execute', async () => {
    const f = screenReaderFixture(n => [`Observation ${n}`]);
    vi.mocked(f.backend.execute).mockRejectedValue(new Error('backend refused'));
    const { policy, calls } = recordingPolicy([type('email'), { stop: 'stuck' }]);
    await runTask(task, { ...f, outDir: await out(), policy });
    expect(speechOf(calls[1]!.observation)).toEqual(['Observation 1']);
  });
});
