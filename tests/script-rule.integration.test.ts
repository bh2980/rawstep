import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeBrowserSession, createBrowserSession, type BrowserSession } from '@rawstep/browser/browser';
import { evaluateVerifyRule, runScriptCheck, verifyTask } from '@rawstep/browser/verify';
import type { Task } from '@rawstep/core/contracts';

const page = `data:text/html,${encodeURIComponent(`<!doctype html><title>Cart</title>
<p role="status" id="status">Added 2 items</p>
<script>
  // Page code that would fool a check running in the main world.
  Array.prototype.includes = () => true;
  window.secret = 'page-only';
  document.title = 'Cart';
</script>`)}`;

let session: BrowserSession;
beforeAll(async () => { session = await createBrowserSession(page, { headless: true, executablePath: process.env.RAWSTEP_TEST_BROWSER_PATH }); });
afterAll(async () => { if (session) await closeBrowserSession(session); });

describe('script verification rule in real Chromium', () => {
  it('reads the shared DOM from an isolated world that page code cannot patch or see', async () => {
    expect(await runScriptCheck(session.page, `() => document.getElementById('status').textContent.includes('Added 2')`, {})).toEqual({ result: true });
    // The page replaced Array.prototype.includes in its own world; the isolated world keeps the real one.
    expect(await runScriptCheck(session.page, `() => ['a'].includes('b')`, {})).toEqual({ result: false });
    expect(await runScriptCheck(session.page, `() => typeof window.secret === 'undefined'`, {})).toEqual({ result: true });
  });

  it('removes network APIs from the script world', async () => {
    expect(await runScriptCheck(session.page, `() => typeof fetch === 'undefined' && typeof XMLHttpRequest === 'undefined' && navigator.sendBeacon('/x') === false`, {})).toEqual({ result: true });
  });

  it('accepts async checks and passes the context', async () => {
    expect(await runScriptCheck(session.page, `async ({ timeline }) => timeline.some(e => e.kind === 'live-region' && e.text === 'Saved')`, { timeline: [{ kind: 'live-region', text: 'Saved' }] })).toEqual({ result: true });
  });

  it('reports undecidable checks by kind and never by message', async () => {
    expect(await runScriptCheck(session.page, `() => { throw new Error('Added 2 items for card 4111') }`, {})).toEqual({ result: null, error: 'threw' });
    expect(await runScriptCheck(session.page, `() => 'yes'`, {})).toEqual({ result: null, error: 'not-boolean' });
    expect(await runScriptCheck(session.page, `() => {`, {})).toEqual({ result: null, error: 'threw' });
    expect(await runScriptCheck(session.page, `42`, {})).toEqual({ result: null, error: 'not-function' });
  });

  it('stops endless synchronous loops and promises that never settle', async () => {
    const started = Date.now();
    expect(await runScriptCheck(session.page, `() => { for (;;) {} }`, {}, 300)).toEqual({ result: null, error: 'timeout' });
    expect(await runScriptCheck(session.page, `() => new Promise(() => {})`, {}, 300)).toEqual({ result: null, error: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
    // The page still works after a terminated check.
    expect(await runScriptCheck(session.page, `() => document.title === 'Cart'`, {})).toEqual({ result: true });
  });

  it('records a script witness and fails closed under not when the check cannot decide', async () => {
    const task = { url: page, goal: 'Add items', maxSteps: 5, timeoutMs: 60000,
      verify: { all: [{ script: { source: `() => document.title === 'Cart'`, description: 'Cart page is open' } }] } } as Task;
    const record = await verifyTask(task, session, { timeline: [] });
    expect(record.passed).toBe(true);
    expect(record.rules?.[0]).toMatchObject({ ruleType: 'script', passed: true, witnesses: [{ kind: 'script', description: 'Cart page is open', result: true }] });

    expect(await evaluateVerifyRule({ not: { script: { source: `() => { throw new Error('x') }`, description: 'broken' } } }, session)).toMatch(/cannot be established/);
    expect(await evaluateVerifyRule({ not: { script: { source: `() => false`, description: 'never' } } }, session)).toBeUndefined();
  });
});
