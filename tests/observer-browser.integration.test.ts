import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { extractHints } from '@rawstep/reports/hints';
import type { Decision, Task } from '@rawstep/core/contracts';
import type { RunTrace } from '@rawstep/core/trace';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'rawstep-observer-')); cleanup.push(() => rm(path, { recursive: true, force: true })); return path; }
const key = (value: string): Decision => ({ action: { kind: 'key', key: value } });
const decisions: Decision[] = ['Tab', 'Enter', 'Tab', 'Enter', 'Tab', 'Enter', 'Tab', 'Enter', 'Tab', 'Space', 'Tab', 'Enter'].map(key).concat({ stop: 'success' });

async function runLab(observe?: boolean) {
  const task: Task = { url: pathToFileURL(resolve('fixtures/friction-lab.html')).href, goal: 'Reach checkout', maxSteps: 20,
    verify: { all: [{ titleIncludes: 'Checkout' }] } };
  const warn = vi.fn();
  const scripted = new ScriptedPolicy(decisions);
  const inputs: unknown[] = [];
  const trace = await runScreenshotTask(task, { outDir: await directory(), headless: true, allowedActions: { keys: ['Tab', 'Enter', 'Space'] }, browserExecutablePath: process.env.RAWSTEP_TEST_BROWSER_PATH, warn,
    ...(observe === undefined ? {} : { observe }), policy: { decide: (input) => { inputs.push(input); return scripted.decide(); } } });
  expect(warn).not.toHaveBeenCalled();
  return { trace, inputs };
}
const observerEvents = (trace: RunTrace, kind: string) => trace.events.filter(event => event.type === `observer.${kind}`).map(event => event.data as Record<string, unknown>);

describe('page observer in real Chromium', () => {
  it('records friction patterns from the friction lab without exposing them to the policy', async () => {
    const { trace, inputs } = await runLab();
    expect(trace.outcome?.status).toBe('success');
    expect(trace.events.find(event => event.type === 'observer.metadata')?.data).toMatchObject({ available: true, world: 'isolated', policyVisible: false });

    expect(observerEvents(trace, 'focus-lost')).toEqual(expect.arrayContaining([expect.objectContaining({ step: 2, reason: 'removed', name: 'Dismiss banner' })]));
    expect(observerEvents(trace, 'appeared')).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 4, role: 'dialog' }),
      expect.objectContaining({ step: 6, role: 'alert', name: 'Cart updated' }),
    ]));
    expect(observerEvents(trace, 'state')).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 4, attr: 'aria-expanded', value: 'true' }),
      expect.objectContaining({ step: 10, attr: 'checked', value: 'true', name: 'Gift wrap' }),
    ]));
    expect(observerEvents(trace, 'live-region')).toEqual(expect.arrayContaining([expect.objectContaining({ step: 6, text: 'Added to cart' })]));
    expect(observerEvents(trace, 'disappeared')).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'alert' })]));
    expect(observerEvents(trace, 'navigation')).toEqual(expect.arrayContaining([expect.objectContaining({ step: 12, sameDocument: true })]));
    const lateFocus = observerEvents(trace, 'focus').filter(event => (event.step as number) > 4);
    expect(lateFocus.length).toBeGreaterThan(0);
    for (const event of lateFocus) expect(event).toMatchObject({ modalOpen: true, inDialog: false });
    expect(trace.events.filter(event => event.type.startsWith('observer.')).every(event => event.source === 'browser-diagnostic')).toBe(true);

    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const json = JSON.stringify(input, (_key, value) => typeof value === 'string' && value.length > 200 ? '[base64]' : value);
      expect(json).not.toContain('Dismiss banner');
      expect(json).not.toContain('observer');
    }

    const report = extractHints(trace);
    const steps = (kind: string) => report.hints.filter(hint => hint.kind === kind).flatMap(hint => hint.steps);
    expect(steps('focus-lost')).toContain(2);
    expect(report.hints.filter(hint => hint.kind === 'modal-focus-outside' && hint.certainty === 'observed').flatMap(hint => hint.steps)).toContain(5);
    expect(steps('missing-announcement')).toEqual(expect.arrayContaining([8, 12]));
    expect(steps('missing-announcement')).not.toContain(6);
  }, 120_000);

  it('records no observer events when observe is false', async () => {
    const { trace } = await runLab(false);
    expect(trace.outcome?.status).toBe('success');
    expect(trace.events.filter(event => event.type.startsWith('observer.'))).toEqual([]);
  }, 120_000);
});

describe('timeline goal rules in real Chromium', () => {
  const verify: Task['verify'] = { all: [
    { event: { kind: 'live-region', role: 'status', text: 'Added to cart' } },
    { any: [{ event: { kind: 'appeared', role: 'alert', name: { regex: 'cart', flags: 'i' } } }, { titleIncludes: 'Nope' }] },
    { not: { event: { kind: 'focus-lost' } } },
    { titleIncludes: 'Friction' },
  ] };
  const results = (trace: RunTrace) => trace.events.filter(event => event.type === 'verifier.result').map(event => event.data as { step: number; passed: boolean; rules: { ruleIndex: number; ruleType: string; passed: boolean }[] });

  it('verifies a live-region announcement from the observer timeline and flags a goal that held before any action', async () => {
    const task: Task = { url: pathToFileURL(resolve('fixtures/friction-lab.html')).href, goal: 'Add the item to the cart', maxSteps: 8, verify };
    const warn = vi.fn();
    const scripted = new ScriptedPolicy(['Tab', 'Tab', 'Tab', 'Enter'].map(key).concat({ stop: 'success' }));
    const trace = await runScreenshotTask(task, { outDir: await directory(), headless: true, allowedActions: { keys: ['Tab', 'Enter'] }, browserExecutablePath: process.env.RAWSTEP_TEST_BROWSER_PATH, warn, policy: { decide: () => scripted.decide() } });
    expect(warn).not.toHaveBeenCalled();
    expect(trace.outcome).toMatchObject({ status: 'success', reason: 'verified', steps: 4 });

    // The cart announcement happens on step 4; earlier checks fail on the event rule only.
    const verdicts = results(trace);
    expect(verdicts.map(result => result.step)).toEqual([1, 2, 3, 4]);
    for (const early of verdicts.slice(0, 3)) {
      expect(early.passed).toBe(false);
      expect(early.rules.map(rule => [rule.ruleType, rule.passed])).toEqual(expect.arrayContaining([['event', false], ['titleIncludes', true]]));
    }
    expect(verdicts[3]).toMatchObject({ passed: true });
    expect(verdicts[3]!.rules.map(rule => [rule.ruleType, rule.passed])).toEqual([['event', true], ['any', true], ['not', true], ['titleIncludes', true]]);
    expect(trace.events.filter(event => event.type === 'verifier.evidence' && (event.data as { witness: { kind: string } }).witness.kind === 'observer-event').length).toBeGreaterThan(0);

    // Before step 1 the title and the not-rule already held, the event rule did not.
    const baselines = trace.events.filter(event => event.type === 'verifier.baseline');
    expect(baselines).toHaveLength(1);
    expect(trace.events.indexOf(baselines[0]!)).toBeLessThan(trace.events.findIndex(event => event.type === 'policy.decision'));
    expect(baselines[0]!.data).toMatchObject({ passed: false });
    const baseline = (baselines[0]!.data as { rules: { ruleType: string; passed: boolean }[] }).rules;
    expect(baseline.find(rule => rule.ruleType === 'titleIncludes')?.passed).toBe(true);
    expect(baseline.find(rule => rule.ruleType === 'not')?.passed).toBe(true);
    expect(baseline.find(rule => rule.ruleType === 'event')?.passed).toBe(false);

    const hints = extractHints(trace).hints.filter(hint => hint.kind === 'goal-met-at-start');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ certainty: 'suspected', steps: [0] });
    expect(JSON.stringify(hints[0]!.detail)).toContain('titleIncludes');
    expect(JSON.stringify(hints[0]!.detail)).not.toContain('"not"');
  }, 120_000);
});
