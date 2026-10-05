import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runScreenshotTask, ScreenshotDecisionPolicy, ScreenshotKeyboardBackend, summarizeVisualExploration, type ScreenshotModelRequest } from 'rawstep/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { DecisionClient, SystemOneScreenshotAdapter } from 'rawstep/systemone';
import { renderReportHtml } from '@rawstep/reports/report';
import { analyzeTrace } from '@rawstep/reports/analyze';
import { TraceRecorder } from '@rawstep/core/trace';
import { createTestBrowserSession } from './helpers/browser.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'rawstep-screenshot-')); cleanup.push(() => rm(path, { recursive: true, force: true })); return path; }
const fixture = pathToFileURL(resolve('fixtures/screenshot-keyboard.html')).href;

// These tests deliberately use fixture adapters, not real model or accuracy claims.
describe('screenshot-only keyboard loop in actual Chromium (fixture adapters)', () => {
  it('roundtrips PNG → model adapter → actual Tab/Tab/Enter → changed PNG with separate verification', async () => {
    const requests: ScreenshotModelRequest[] = []; const choices = ['key:Tab', 'key:Tab', 'key:Enter'];
    const policy = new ScreenshotDecisionPolicy({ model: { choose: async request => { requests.push(request); return { choiceId: choices[requests.length - 1]!, model: { id: 'fixture-adapter', runtime: 'vitest-only' } }; } } });
    const outDir = await directory();
    const trace = await runScreenshotTask({ url: fixture, goal: 'Activate Finish task', maxSteps: 6, verify: { all: [{ textVisibleExact: 'Task completed successfully' }] } }, { policy, outDir, browserSessionFactory: createTestBrowserSession });
    expect(trace.outcome?.status).toBe('success'); expect(requests).toHaveLength(3);
    expect(requests.every(r => r.screenshot.pngBase64.startsWith('iVBOR'))).toBe(true);
    expect(new Set(requests.map(r => r.screenshot.pngBase64)).size).toBe(3);
    expect(JSON.stringify(requests)).not.toMatch(/domEventSeen|textVisibleExact|document|selector|accessibleName/);
    expect(trace.events.filter(e => e.type === 'policy.evidence')).toHaveLength(3);
    expect(trace.events.filter(e => e.type === 'verifier.evidence').every(e => e.source === 'verifier')).toBe(true);
    const summary = summarizeVisualExploration(trace); expect(summary.states.length).toBe(4); expect(summary.inferenceEventIds).toHaveLength(3); expect(summary.transitions.every(t => t.changedPixels)).toBe(true);
    const html = renderReportHtml(trace, await analyzeTrace(trace)); expect(html).toContain('Visited visual states'); expect(html).toContain('Screenshot keyboard exploration'); expect(html).not.toContain('Deprecated screenshot keyboard run');
  });
  it('navigates forward/backward, activates dialog, escapes, and toggles with Space without mouse', async () => {
    const session = await createTestBrowserSession(fixture); cleanup.push(() => session.close()); const backend = new ScreenshotKeyboardBackend(); await backend.start(); backend.attachSession({ page: session.page }); cleanup.push(() => backend.close());
    await backend.execute({ kind: 'key', key: 'Tab' }); await backend.execute({ kind: 'key', key: 'Tab' }); await backend.execute({ kind: 'key', key: 'Shift+Tab' });
    expect(await session.page.evaluate(() => document.activeElement?.id)).toBe('open');
    await backend.execute({ kind: 'key', key: 'Enter' }); expect(await session.page.locator('dialog').isVisible()).toBe(true);
    await backend.execute({ kind: 'key', key: 'Escape' }); expect(await session.page.locator('dialog').isVisible()).toBe(false);
    for (let i = 0; i < 4; i++) await backend.execute({ kind: 'key', key: 'Tab' });
    await backend.execute({ kind: 'key', key: 'Space' }); expect(await session.page.locator('#toggle').getAttribute('aria-pressed')).toBe('true');
  });
  // macOS Chrome's OS-native popup did not respond to CDP key events in
  // either headed or headless verification. Keep the native-dropdown case
  // elsewhere and test renderer-owned listbox arrows on every host below.
  it.runIf(process.platform !== 'darwin')('supports actual arrow navigation of a native collapsed select', async () => {
    const session = await createTestBrowserSession(fixture); cleanup.push(() => session.close()); const backend = new ScreenshotKeyboardBackend(); await backend.start(); backend.attachSession({ page: session.page }); cleanup.push(() => backend.close());
    for (let i = 0; i < 4; i++) await backend.execute({ kind: 'key', key: 'Tab' });
    await backend.execute({ kind: 'key', key: 'ArrowDown' });
    expect(await session.page.locator('#theme').inputValue()).toBe('Dark');
  });
  it('supports actual arrow navigation of a renderer-owned select listbox', async () => {
    const dir = await directory(), file = join(dir, 'listbox.html');
    await writeFile(file, '<!doctype html><select id="theme" size="3" autofocus><option selected>Light</option><option>Dark</option><option>High contrast</option></select>');
    const session = await createTestBrowserSession(pathToFileURL(file).href); cleanup.push(() => session.close());
    const backend = new ScreenshotKeyboardBackend(); await backend.start(); backend.attachSession({ page: session.page }); cleanup.push(() => backend.close());
    await backend.execute({ kind: 'key', key: 'ArrowDown' });
    expect(await session.page.locator('#theme').inputValue()).toBe('Dark');
  });
  it('retains input gate and suppresses saved screenshots plus model evidence after named input', async () => {
    const outDir = await directory(); const choices = ['key:Tab', 'key:Tab', 'key:Tab', 'type:name', 'stop:stuck']; let index = 0;
    const trace = await runScreenshotTask({ url: fixture, goal: 'Enter name', maxSteps: 8, input: { name: 'PRIVATE_NAME_329' }, verify: { all: [{ titleIncludes: 'Never satisfied' }] } }, {
      outDir, browserSessionFactory: createTestBrowserSession, policy: new ScreenshotDecisionPolicy({ model: { choose: async () => ({ choiceId: choices[index++]!, model: { id: 'fixture-adapter', runtime: 'vitest-only' }, focusAssessment: { visibility: 'visible', note: 'PRIVATE_NAME_329' } }) } }) });
    const serialized = await readFile(join(outDir, 'trace.json'), 'utf8'); expect(serialized).not.toContain('PRIVATE_NAME_329');
    expect(trace.events.some(e => e.type === 'privacy.input-taint')).toBe(true);
    expect(trace.events.filter(e => e.type === 'keyboard.observation').at(-1)).toMatchObject({ redacted: true, data: { screenshot: '[REDACTED]' } });
    expect(trace.events.filter(e => e.type === 'policy.evidence').at(-1)).toMatchObject({ redacted: true, data: { details: '[REDACTED]' } });
  });
  it('stops a visually unchanged keyboard trap within limits and reports uncertainty', async () => {
    const dir = await directory(); const file = join(dir, 'trap.html'); await writeFile(file, '<!doctype html><button autofocus style="outline:none" onkeydown="event.preventDefault()">Trapped</button>');
    const choose = vi.fn(async () => ({ choiceId: 'key:Tab', model: { id: 'fixture-adapter', runtime: 'vitest-only' } }));
    const trace = await runScreenshotTask({ url: pathToFileURL(file).href, goal: 'Explore', maxSteps: 20, verify: { all: [{ titleIncludes: 'Never' }] } }, { outDir: join(dir, 'run'), browserSessionFactory: createTestBrowserSession, policy: new ScreenshotDecisionPolicy({ maxUnchangedTransitions: 2, model: { choose } }) });
    expect(choose).toHaveBeenCalledTimes(2); expect(trace.outcome).toMatchObject({ status: 'failure', reason: 'policy-stuck', policyStopSource: 'exploration-guard' });
    expect(summarizeVisualExploration(trace).repetitionLimitEventIds).toHaveLength(1);
    expect((await analyzeTrace(trace)).findings).toContainEqual(expect.objectContaining({ id: 'visual-repetition-limit', description: expect.stringContaining('does not establish') }));
  });
  it('cancels before any next key if inference evidence cannot be persisted', async () => {
    const append = TraceRecorder.prototype.append; vi.spyOn(TraceRecorder.prototype, 'append').mockImplementation(function(this: TraceRecorder, ...args) { if (args[0] === 'policy.evidence') throw new Error('fault-injected evidence failure'); return append.apply(this, args); });
    const trace = await runScreenshotTask({ url: fixture, goal: 'Explore', maxSteps: 2, verify: { all: [{ titleIncludes: 'Never' }] } }, { outDir: await directory(), browserSessionFactory: createTestBrowserSession, policy: new ScreenshotDecisionPolicy({ model: { choose: async () => ({ choiceId: 'key:Tab', model: { id: 'fixture-adapter', runtime: 'vitest-only' } }) } }) });
    expect(trace.outcome?.status).toBe('failure'); expect(trace.events.some(e => e.type === 'action.result')).toBe(false);
  });
  it('keeps rejected DOM editability-gate outcomes outside subsequent model requests', async () => {
    const requests: ScreenshotModelRequest[] = [];
    const trace = await runScreenshotTask({ url: fixture, goal: 'Inspect', maxSteps: 3, input: { name: 'safe-test-value' }, verify: { all: [{ titleIncludes: 'Never' }] } }, {
      outDir: await directory(), browserSessionFactory: createTestBrowserSession, policy: new ScreenshotDecisionPolicy({ model: { choose: async request => { requests.push(request); return { choiceId: requests.length === 1 ? 'type:name' : 'stop:stuck', model: { id: 'fixture-adapter', runtime: 'vitest-only' } }; } } }) });
    expect(trace.events.find(e => e.type === 'browser.input-gate')?.data).toMatchObject({ editable: false });
    expect(trace.events.find(e => e.type === 'action.result')?.data).toMatchObject({ ok: false });
    expect(requests[1]!.history).toEqual([{ step: 1, decision: { action: { kind: 'typeText', input: 'name' } } }]);
    expect(JSON.stringify(requests)).not.toMatch(/"editable":|"execution":|"verifier":|safe-test-value/);
  });
  it('does not persist malformed successful HTTP response bodies in run errors', async () => {
    const outDir = await directory();
    const trace = await runScreenshotTask({ url: fixture, goal: 'Inspect', maxSteps: 1, verify: { all: [{ titleIncludes: 'Never' }] } }, {
      outDir, browserSessionFactory: createTestBrowserSession, policy: new ScreenshotDecisionPolicy({ model: new SystemOneScreenshotAdapter(new DecisionClient({ provider: 'custom', baseURL: 'http://127.0.0.1:8766/v1', modelId: 'fixture', capabilities: { inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 }, fetch: async () => new Response('PRIVATE_RESPONSE_MARKER_992') })) }) });
    expect(trace.outcome?.status).toBe('failure'); expect(await readFile(join(outDir, 'trace.json'), 'utf8')).not.toContain('PRIVATE_RESPONSE');
    expect(trace.outcome?.error).toMatch(/^Decision call failed/);
  });
  it('rejects a screen-reader mode mismatch before launching Chromium', async () => {
    await expect(runScreenshotTask({ mode: 'screenreader', url: fixture, goal: 'No', verify: { all: [{ titleIncludes: 'No' }] } }, { outDir: await directory(), policy: new ScriptedPolicy([]) })).rejects.toThrow(/keyboard/);
  });
});
