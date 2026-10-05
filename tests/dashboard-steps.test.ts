import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@rawstep/core/trace';
import { buildSteps } from '../packages/dashboard/src/server/steps.js';

type Pair = readonly [type: string, data: Record<string, unknown>, redacted?: boolean];
const events = (pairs: readonly Pair[]): TraceEvent[] => pairs.map(([type, data, redacted], i) => ({
  id: 'e' + (i + 1), seq: i + 1, timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, type, source: 'runner', data, redacted: redacted ?? false,
}));
const build = (pairs: readonly Pair[], options: Partial<Parameters<typeof buildSteps>[0]> = {}) => buildSteps({ experimentId: 'x', runId: 'r', events: events(pairs), live: false, ...options });
const sha = createHash('sha256').update('pixels').digest('hex');
const ref = (hex: string) => ({ sha256: hex, blob: `blobs/${hex}.png`, bytes: 10, viewport: { w: 2, h: 2 } });
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('inline')]);

describe('dashboard step view', () => {
  it('folds a run into steps with actions, results, screenshots, model candidates, changes and verification', () => {
    const firstSha = 'c'.repeat(64);
    const view = build([
      ['keyboard.observation', { screenshot: ref(firstSha) }],
      ['observer.focus', { kind: 'focus', step: 0, role: 'button', name: 'Start', tag: 'button' }],
      ['verifier.baseline', { passed: false, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: false }] }],
      ['policy.evidence', { step: 1, evidence: { kind: 'model-inference', choiceId: 'key:Tab', choices: [{ id: 'key:Tab', label: 'Press Tab' }, { id: 'key:Enter', label: 'Press Enter' }, { id: 'stop:stuck' }], probabilities: [0.6, 0.3, 0.1], model: { id: 'm1' }, inferenceMs: 420 } }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' }, rationale: 'private reasoning' } }],
      ['action.result', { step: 1, ok: true, action: { kind: 'key', key: 'Tab' } }],
      ['keyboard.observation', { screenshot: ref(sha) }],
      ['observer.state', { kind: 'state', step: 1, role: 'button', name: 'Menu', attr: 'aria-expanded', value: 'true' }],
      ['observer.navigation', { kind: 'navigation', step: 1, url: 'https://example.com/next', value: null }],
      ['policy.decision', { step: 2, decision: { action: { kind: 'intent', intent: 'activate' } } }],
      ['action.result', { step: 2, ok: false }],
      ['policy.decision', { step: 3, decision: { stop: 'success', stopSource: 'model' } }],
      ['verifier.result', { step: 3, passed: true, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: true, evidenceEventIds: ['x'] }] }],
    ], { hints: [{ kind: 'backtracking', steps: [1, 2] }, { kind: 'goal-met-at-start', steps: [0] }, { kind: 'slow-run', steps: [] }, { kind: 'focus-lost', steps: [9] }], live: true });
    expect(view).toMatchObject({ experimentId: 'x', runId: 'r', live: true, baseline: { passed: false, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: false }] } });
    expect(view.steps.map(s => s.step)).toEqual([0, 1, 2, 3]);
    const [s0, s1, s2, s3] = view.steps as [typeof view.steps[0], typeof view.steps[0], typeof view.steps[0], typeof view.steps[0]];
    expect(s0.screenshot).toEqual({ eventId: 'e1', sha256: firstSha });
    expect(s0.observed).toEqual([{ kind: 'focus', role: 'button', name: 'Start' }]);
    expect(s0.hints).toEqual(['goal-met-at-start']);
    expect(s1.action).toEqual({ kind: 'key', key: 'Tab' }); expect(s1.ok).toBe(true);
    expect(s1.screenshot).toEqual({ eventId: 'e7', sha256: sha });
    expect(s1.model).toEqual({ choiceId: 'key:Tab', modelId: 'm1', inferenceMs: 420, candidates: [{ id: 'key:Tab', label: 'Press Tab', probability: 0.6 }, { id: 'key:Enter', label: 'Press Enter', probability: 0.3 }, { id: 'stop:stuck', probability: 0.1 }] });
    expect(s1.observed).toEqual([{ kind: 'state', role: 'button', name: 'Menu', attr: 'aria-expanded', value: 'true' }, { kind: 'navigation', url: 'https://example.com/next', value: null }]);
    expect(s1.hints).toEqual(['backtracking']); expect(s1.at).toBe('2026-01-01T00:00:04.000Z');
    expect(s2.action).toEqual({ kind: 'intent', intent: 'activate' }); expect(s2.ok).toBe(false); expect(s2.hints).toEqual(['backtracking']); expect(s2.screenshot).toBeUndefined();
    expect(s3.stop).toEqual({ stop: 'success', source: 'model' }); expect(s3.action).toBeUndefined(); expect(s3.ok).toBeUndefined();
    expect(s3.verification).toEqual({ passed: true, rules: [{ ruleIndex: 0, ruleType: 'titleIncludes', passed: true }] });
    expect(JSON.stringify(view)).not.toContain('private reasoning');
    expect(view.steps.every(s => !s.redacted)).toBe(true);
  });
  it('keeps the first screenshot after a decision and ignores observations without pixels', () => {
    const view = build([
      ['keyboard.observation', { screenshot: ref(sha) }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['keyboard.observation', { screenshot: { pngBase64: png.toString('base64') } }], // inline pixels are not stored evidence
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['keyboard.observation', { screenshot: ref('b'.repeat(64)) }],
    ]);
    expect(view.steps.map(s => s.screenshot?.sha256)).toEqual([sha, undefined, 'b'.repeat(64)]);
  });
  it('labels speech by provenance and never reports redacted speech', () => {
    const view = build([
      ['simulation.observation', { kind: 'screenreader', speech: ['Page loaded'] }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['screen-reader.observation', { kind: 'screenreader', provenance: 'native', speech: ['Button, Start'] }],
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }],
      ['screen-reader.observation', { kind: 'screenreader', speech: ['Link'] }],
    ]);
    expect(view.steps.map(s => s.speech)).toEqual([{ lines: ['Page loaded'], provenance: 'simulation' }, { lines: ['Button, Start'], provenance: 'native' }, { lines: ['Link'], provenance: 'unspecified' }]);
  });
  it('marks redacted steps and never surfaces redacted values', () => {
    const view = build([
      ['keyboard.observation', { screenshot: ref(sha) }],
      ['policy.decision', { step: 1, decision: { action: { kind: 'typeText', input: 'email' } } }],
      ['privacy.input-taint', { step: 1, reason: 'redacted after input' }, true],
      ['action.result', { step: 1, ok: true, action: { kind: 'typeText', input: 'email' } }],
      ['keyboard.observation', { kind: 'keyboard', screenshot: '[REDACTED]' }, true],
      ['observer.state', { kind: 'state', step: 1, role: 'textbox', name: '[REDACTED]', text: '[REDACTED]', value: '[REDACTED]', url: '[REDACTED]' }, true],
      ['simulation.observation', { kind: 'screenreader', speech: ['[REDACTED]'] }, true],
      ['policy.evidence', { step: 2, details: '[REDACTED]', reason: 'Model evidence omitted after text entry.' }, true],
      ['policy.decision', { step: 2, decision: { action: { kind: 'key', key: 'Tab' } } }, true],
      ['verifier.result', { step: 2, passed: false, failures: ['[REDACTED]'], rules: [{ ruleIndex: 0, ruleType: 'visibleText', passed: false }] }, true],
    ]);
    expect(view.steps.map(s => s.redacted)).toEqual([false, true, true]);
    expect(view.steps[1]).toMatchObject({ action: { kind: 'typeText', input: 'email' }, ok: true, observed: [{ kind: 'state', role: 'textbox' }] });
    expect(view.steps[1]!.screenshot).toBeUndefined(); expect(view.steps[1]!.speech).toBeUndefined(); expect(view.steps[1]!.model).toBeUndefined();
    expect(view.steps[2]!.verification).toEqual({ passed: false, rules: [{ ruleIndex: 0, ruleType: 'visibleText', passed: false }] });
    expect(JSON.stringify(view)).not.toContain('REDACTED');
  });
  it('has no steps before anything is recorded and tolerates unknown or malformed events', () => {
    expect(build([]).steps).toEqual([]);
    const view = build([['run.started', {}], ['observer.metadata', { available: true }], ['policy.decision', { step: 1, decision: 'nonsense' }], ['verifier.baseline', { error: 'Error' }]]);
    expect(view.steps.map(s => s.step)).toEqual([0, 1]); expect(view.baseline).toBeUndefined(); expect(view.steps[1]!.action).toBeUndefined();
  });
});
