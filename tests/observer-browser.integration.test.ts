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
