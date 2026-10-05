import { describe, expect, it, vi } from 'vitest';
import { ScreenshotDecisionPolicy, screenshotChoices, screenshotHash, SCREENSHOT_KEYS, validateModelResponse, type ScreenshotModelRequest, type ScreenshotModelResponse } from 'rawstep/screenshot';
import type { DecisionPolicy, HistoryEntry } from '@rawstep/core/contracts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nV8AAAAASUVORK5CYII=';
const observation = { kind: 'keyboard' as const, screenshot: { pngBase64: png, viewport: { w: 1, h: 1 } }, window: { id: 'one', startedAt: '2026-10-01T00:00:00.000Z', endedAt: '2026-10-01T00:00:00.000Z', reason: 'test' } };
const input = (): Parameters<DecisionPolicy['decide']>[0] => ({ goal: 'Inspect keyboard behavior', observation: structuredClone(observation), history: [], allowedActions: { intents: [], keys: SCREENSHOT_KEYS, inputKeys: ['provided'], replaceText: true }, inputs: { provided: { sensitive: true } }, signal: new AbortController().signal });
const response = (choiceId = 'key:Tab'): ScreenshotModelResponse => ({ choiceId, model: { id: 'test-fake-not-real-model', runtime: 'vitest' } });
const history = (length: number): HistoryEntry[] => Array.from({ length }, (_, i) => ({ step: i + 1, decision: { action: { kind: 'key', key: 'Tab' } }, observation: structuredClone(observation), execution: { ok: true } }));

describe('first-class screenshot model policy', () => {
  it('sends actual PNG pixels and a fresh strict allowlist, never DOM/AX/verifier or named input values', async () => {
    const choose = vi.fn(async () => response()); const policy = new ScreenshotDecisionPolicy({ model: { choose } });
    const value = input(); Object.assign(value.observation, { dom: 'HIDDEN_DOM', ax: 'HIDDEN_AX', verifier: 'HIDDEN_VERIFIER' });
    expect(await policy.decide(value)).toEqual({ action: { kind: 'key', key: 'Tab' } });
    const req = (choose.mock.calls[0] as unknown as [ScreenshotModelRequest])[0];
    expect(req.screenshot.pngBase64).toBe(png); expect(req.protocol).toBe('rawstep-screenshot-choice-v1');
    expect(Object.keys(req)).toEqual(['protocol', 'goal', 'screenshot', 'choices', 'history', 'visualState']);
    expect(JSON.stringify(req)).not.toMatch(/HIDDEN_|PRIVATE_VALUE/);
    expect(req.choices.find(c => c.id === 'type:provided')?.decision).toEqual({ action: { kind: 'typeText', input: 'provided' } });
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ kind: 'model-inference', screenshotSha256: screenshotHash(observation.screenshot), noDomOrAxContext: true, choiceId: 'key:Tab', focusAssessment: { visibility: 'uncertain', note: expect.any(String) } })]);
    expect(policy.takeDecisionEvidence()).toEqual([]);
  });
  it('distinguishes a model-selected stop from an exploration guard', async () => {
    const policy = new ScreenshotDecisionPolicy({ model: { choose: async () => response('stop:stuck') } });
    expect(await policy.decide(input())).toEqual({ stop: 'stuck', stopSource: 'model' });
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ kind: 'model-inference', choiceId: 'stop:stuck' })]);
  });
  it('does not let adapter mutation of request choices replace an allowed keyboard decision', async () => {
    const policy = new ScreenshotDecisionPolicy({ model: { choose: async request => { request.choices[0]!.decision = { action: { kind: 'intent', intent: 'click' } }; return response(); } } });
    expect(await policy.decide(input())).toEqual({ action: { kind: 'key', key: 'Tab' } });
  });
  it('omits old screenshots, rationale, execution errors and unexpected action fields from model history', async () => {
    let seen: ScreenshotModelRequest | undefined;
    const policy = new ScreenshotDecisionPolicy({ historyLimit: 1, maxStateVisits: 20, maxUnchangedTransitions: 20, model: { choose: async request => { seen = request; return response(); } } });
    const value = input(); value.history = history(3); Object.assign(value.history[2]!.decision, { rationale: 'HIDDEN_RATIONALE' });
    Object.assign((value.history[2]!.decision as { action: object }).action, { dom: 'HIDDEN_DOM' });
    Object.assign(value.history[2]!.execution!, { error: 'HIDDEN_ERROR' });
    await policy.decide(value); expect(seen!.history).toEqual([{ step: 3, decision: { action: { kind: 'key', key: 'Tab' } } }]);
  });
  it('stops identical pixels conservatively without inventing a recovery action or another inference', async () => {
    const choose = vi.fn(async () => response()); const policy = new ScreenshotDecisionPolicy({ maxUnchangedTransitions: 2, model: { choose } });
    expect(await policy.decide({ ...input(), history: history(2) })).toMatchObject({ stop: 'stuck' }); expect(choose).not.toHaveBeenCalled();
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ kind: 'exploration-limit', modelCalled: false, unchangedTransitions: 2 })]);
  });
  it('bounds nonconsecutive revisits', async () => {
    const h = history(3); h[1]!.observation = { ...observation, screenshot: { ...observation.screenshot, pngBase64: Buffer.concat([Buffer.from(png, 'base64'), Buffer.from('different')]).toString('base64') } };
    const policy = new ScreenshotDecisionPolicy({ maxStateVisits: 2, model: { choose: async () => response() } });
    expect(await policy.decide({ ...input(), history: h })).toMatchObject({ stop: 'stuck' });
  });
  it.each([0, -1, 1.5, Infinity, 10001])('rejects invalid limit %s', limit => {
    expect(() => new ScreenshotDecisionPolicy({ maxStateVisits: limit, model: { choose: async () => response() } })).toThrow(/integer/);
  });
  it('rejects nonvisual observations and invalid image bytes before inference', async () => {
    const policy = new ScreenshotDecisionPolicy({ model: { choose: async () => response() } });
    await expect(policy.decide({ ...input(), observation: { kind: 'screenreader', speech: [], outputEventIds: [], window: observation.window } })).rejects.toThrow(/screenshot/);
    await expect(policy.decide({ ...input(), observation: { ...observation, screenshot: { pngBase64: 'not-png', viewport: { w: 1, h: 1 } } } })).rejects.toThrow(/PNG/);
  });
  it('fails closed on cancellation even when the adapter ignores the signal', async () => {
    const controller = new AbortController(); const policy = new ScreenshotDecisionPolicy({ model: { choose: async () => { controller.abort(new Error('cancelled')); return response(); } } });
    await expect(policy.decide({ ...input(), signal: controller.signal })).rejects.toThrow('cancelled'); expect(policy.takeDecisionEvidence()).toEqual([]);
  });
  it('rejects mouse/intents/unknown choice and malformed probabilities', async () => {
    expect(() => screenshotChoices({ ...input().allowedActions, keys: ['MouseClick'] })).toThrow(/cannot use/);
    const choices = screenshotChoices(input().allowedActions);
    for (const value of [response('click:5,6'), { ...response(), probabilities: [1] }, { ...response(), probabilities: choices.map(() => 0) }, { ...response(), model: {} }]) expect(() => validateModelResponse(value, choices)).toThrow();
  });
});

describe('configurable early give-up', () => {
  const identical = (n: number) => ({ ...input(), history: history(n) });
  it('never stops on repetition with repetitionGuard false, yet still reports visual state', async () => {
    const choose = vi.fn(async () => response()); const policy = new ScreenshotDecisionPolicy({ repetitionGuard: false, maxStateVisits: 1, maxUnchangedTransitions: 1, model: { choose } });
    expect(await policy.decide(identical(8))).toEqual({ action: { kind: 'key', key: 'Tab' } });
    const req = (choose.mock.calls[0] as unknown as [ScreenshotModelRequest])[0];
    expect(req.visualState).toEqual({ sha256: screenshotHash(observation.screenshot), visits: 9, unchangedTransitions: 8 });
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ kind: 'model-inference', visualState: req.visualState, earlyStop: { repetitionGuard: false, modelGiveUp: true } })]);
  });
  it('keeps the guard on by default and records effective settings', async () => {
    const policy = new ScreenshotDecisionPolicy({ maxUnchangedTransitions: 2, model: { choose: async () => response() } });
    expect(await policy.decide(identical(2))).toMatchObject({ stop: 'stuck', stopSource: 'exploration-guard' });
    await policy.decide(input());
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({ earlyStop: { repetitionGuard: true, modelGiveUp: true } })]);
  });
  it('removes stop:stuck and stop:uncertain but keeps stop:success when modelGiveUp is false', async () => {
    const ids = (options?: { modelGiveUp?: boolean }) => screenshotChoices(input().allowedActions, options).map(c => c.id).filter(id => id.startsWith('stop:'));
    expect(ids()).toEqual(['stop:success', 'stop:uncertain', 'stop:stuck']); expect(ids({ modelGiveUp: true })).toEqual(ids());
    expect(ids({ modelGiveUp: false })).toEqual(['stop:success']);
    const choose = vi.fn(async () => response('stop:success')); const policy = new ScreenshotDecisionPolicy({ modelGiveUp: false, model: { choose } });
    expect(await policy.decide(input())).toEqual({ stop: 'success', stopSource: 'model' });
    expect((choose.mock.calls[0] as unknown as [ScreenshotModelRequest])[0].choices.map(c => c.id)).not.toContain('stop:stuck');
    const giveUp = new ScreenshotDecisionPolicy({ modelGiveUp: false, model: { choose: async () => response('stop:stuck') } });
    await expect(giveUp.decide(input())).rejects.toThrow();
  });
});
