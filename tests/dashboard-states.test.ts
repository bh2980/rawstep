import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../packages/dashboard/src/shared/config.js';
import { RUN_ERROR } from '../packages/dashboard/src/shared/config.js';
import '../packages/dashboard/src/web/i18n/index.js';
import { ApiError } from '../packages/dashboard/src/web/api.js';
import { CONCEPTS_KEY, dismissConcept, readDismissed } from '../packages/dashboard/src/web/lib/concepts.js';
import { describeAfterRunFailure, describeApiError, describeRunFailure, errorKindOf } from '../packages/dashboard/src/web/lib/errors.js';
import { generateEnvName, keyStatus, providerTextKey } from '../packages/dashboard/src/web/lib/connections.js';
import { choiceName, profileConditions, profileViewport } from '../packages/dashboard/src/web/lib/profileSummary.js';
import { displayState, recentRuns, resultLabel } from '../packages/dashboard/src/web/lib/runStrip.js';
import { failureDetail, publicOutcome } from '../packages/dashboard/src/server/queue.js';
import { ProjectError } from '@rawstep/project/errors';
import { defaultProfile } from '@rawstep/project/config';
import { connection, profileWith } from './helpers/project-config.js';

const hangul = /[가-힣]/;
type Run = Pick<RunRecord, 'state' | 'outcome' | 'error' | 'taskId'>;
const run = (state: RunRecord['state'], outcome?: RunRecord['outcome'], error?: string): Run => ({ taskId: 't', state, ...(outcome ? { outcome } : {}), ...(error ? { error } : {}) });

describe('error states', () => {
  it('tells the five kinds of trouble apart from how a run ended', () => {
    // Start failure: the executor threw before any trace existed, or the runner stopped while starting.
    expect(describeRunFailure(run('failure', undefined, RUN_ERROR.start))?.kind).toBe('start');
    expect(describeRunFailure(run('failure', { status: 'failure', reason: 'error', stage: 'browser-start' }))).toMatchObject({ kind: 'start', link: { to: { view: 'settings' } } });
    expect(describeRunFailure(run('inconclusive', { status: 'inconclusive', reason: 'access-blocked' }))?.kind).toBe('start');
    // Runtime failure: it got going and stopped, and says how far.
    const runtime = describeRunFailure(run('failure', { status: 'failure', reason: 'error', stage: 'policy', step: 4, steps: 4 }));
    expect(runtime).toMatchObject({ kind: 'runtime', progress: '행동 4번까지 기록되었습니다.', link: { to: { view: 'connections' } } });
    expect(describeRunFailure(run('failure', { status: 'failure', reason: 'error', stage: 'verification', steps: 2 }))).toMatchObject({ kind: 'runtime', link: { to: { task: 't', tab: 'check' } } });
    expect(describeRunFailure(run('interrupted', undefined, RUN_ERROR.restarted))?.kind).toBe('runtime');
    // Setup error: a condition cannot be applied here.
    expect(describeRunFailure(run('inconclusive', { status: 'inconclusive', reason: 'unsupported-profile' }))?.kind).toBe('setup');
    // Data failure: the record could not be written.
    expect(describeRunFailure(run('failure', { status: 'failure', reason: 'trace-persistence-error', steps: 3 }))?.kind).toBe('data');
    expect(describeRunFailure(run('interrupted', undefined, RUN_ERROR.storage))?.kind).toBe('data');
  });

  it('says what happened, how far it got and what to do, always in Korean', () => {
    const view = describeRunFailure(run('failure', { status: 'failure', reason: 'error', stage: 'browser-start' }))!;
    for (const text of [view.what, view.progress!, view.next]) expect(text).toMatch(hangul);
    expect(view.progress).toContain('첫 행동 전');
    expect(view.raw).toContain('stage: browser-start');
  });

  it('leaves runs that simply ended alone: a limit, a stop the model chose, a goal not reached', () => {
    for (const reason of ['verified', 'verification-failed', 'maxSteps', 'timeout', 'policy-stuck', 'policy-uncertain', 'aborted']) {
      expect(describeRunFailure(run('failure', { status: 'failure', reason, steps: 9 }))).toBeUndefined();
    }
    expect(describeRunFailure(run('success', { status: 'success', reason: 'verified', steps: 5 }))).toBeUndefined();
    expect(describeRunFailure(run('cancelled', { status: 'aborted', reason: 'aborted' }))).toBeUndefined();
  });

  it('shows codes and the server\'s fixed message in the original record, never an outcome\'s raw error text', () => {
    // The queue keeps only the result and how far it got, so provider text in `outcome.error` cannot reach the screen.
    const stored = publicOutcome({ status: 'failure', reason: 'error', stage: 'policy', step: 2, steps: 2, error: 'Provider said: sk-secret-123', cancellation: { signal: 'x' } });
    expect(stored).toEqual({ status: 'failure', reason: 'error', stage: 'policy', step: 2, steps: 2 });
    expect(describeRunFailure({ ...run('failure', stored), error: RUN_ERROR.start })?.raw).not.toContain('sk-secret');
    expect(publicOutcome(undefined)).toBeUndefined();
    expect(publicOutcome({ status: 'success', steps: 3, extra: 1 })).toEqual({ status: 'success', steps: 3 });
  });

  it('adds the recorded cause of a run that threw, with keys and input values redacted', () => {
    const detail = failureDetail(new Error('Request to https://x failed for sk-secret-123 and private-value'), ['sk-secret-123', 'private-value', 'ab']);
    expect(detail!.message).not.toMatch(/sk-secret-123|private-value/); expect(detail!.message).toContain('Request to');
    expect(failureDetail(new Error('x'.repeat(2000)), [])!.message.length).toBeLessThanOrEqual(600);
    expect(failureDetail(new ProjectError('missing-credential', 'English text'), [])).toMatchObject({ code: 'missing-credential', message: expect.stringMatching(hangul) });
    const failed = { ...run('failure', undefined, RUN_ERROR.start), errorDetail: { code: 'missing-credential', message: '연결의 인증키가 설정되지 않았습니다.' } };
    expect(describeRunFailure(failed)).toMatchObject({ kind: 'start', cause: '연결의 인증키가 설정되지 않았습니다.' });
    expect(describeRunFailure(failed)!.raw).toContain('code: missing-credential');
    expect(describeRunFailure(run('failure', undefined, RUN_ERROR.start))).not.toHaveProperty('cause');
  });

  it('reports an analysis or report that could not be written without touching the run\'s own outcome', () => {
    expect(describeAfterRunFailure({ analysisStatus: 'complete', reportStatus: 'complete' })).toBeUndefined();
    expect(describeAfterRunFailure({ analysisStatus: 'failed', analysisError: '분석 실패', reportStatus: 'complete' })).toMatchObject({ kind: 'data', raw: '분석 실패' });
    expect(describeAfterRunFailure({ analysisStatus: 'complete', reportStatus: 'failed', reportError: '보고서 생성 실패' })?.what).toContain('보고서');
  });

  it('classifies request failures: no answer is a lost connection, a conflict is a setup matter, a server fault is data', () => {
    expect(errorKindOf(new ApiError('x', 0))).toBe('connection');
    expect(errorKindOf(new ApiError('x', 0), 'start')).toBe('connection');
    expect(errorKindOf(new ApiError('x', 409))).toBe('setup');
    expect(errorKindOf(new ApiError('x', 500))).toBe('data');
    expect(errorKindOf(new ApiError('x', 400), 'start')).toBe('start');
    expect(errorKindOf(new Error('x'))).toBe('setup');
    const lost = describeApiError(new ApiError('로컬 서버에 연결하지 못했습니다.', 0));
    expect(lost).toMatchObject({ kind: 'connection' });
    expect(lost.next).toMatch(hangul);
    expect(describeApiError(new ApiError('설정이 외부에서 변경되었습니다.', 409))).toMatchObject({ kind: 'setup', what: '설정이 외부에서 변경되었습니다.', raw: expect.stringContaining('status: 409') });
  });
});

describe('concept notes', () => {
  const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };

  it('remembers a dismissed concept once and in the order it was dismissed', () => {
    const store = memory();
    expect(readDismissed(store)).toEqual([]);
    expect(dismissConcept('profile', store)).toEqual(['profile']);
    expect(dismissConcept('inspect', store)).toEqual(['profile', 'inspect']);
    expect(dismissConcept('profile', store)).toEqual(['profile', 'inspect']);
    expect(readDismissed(store)).toEqual(['profile', 'inspect']);
  });

  it('ignores a value it cannot read and survives a store that throws', () => {
    const broken = memory();
    broken.setItem(CONCEPTS_KEY, '{not json');
    expect(readDismissed(broken)).toEqual([]);
    broken.setItem(CONCEPTS_KEY, JSON.stringify(['profile', 'not-a-concept', 3]));
    expect(readDismissed(broken)).toEqual(['profile']);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readDismissed(blocked)).toEqual([]);
    expect(dismissConcept('check', blocked)).toEqual(['check']);
    expect(readDismissed(undefined)).toEqual([]);
  });
});

describe('result and run strip helpers', () => {
  it('draws and words a run that ended on an error as undecided, not as a goal that was missed', () => {
    expect(displayState({ state: 'failure', outcome: { status: 'failure', reason: 'error' } })).toBe('inconclusive');
    expect(displayState({ state: 'failure', outcome: { status: 'failure', reason: 'verification-failed' } })).toBe('failure');
    expect(displayState({ state: 'success', outcome: { status: 'success' } })).toBe('success');
    expect(resultLabel({ state: 'failure', outcome: { status: 'failure', reason: 'error' } })).toBe('실행 오류로 끝남');
    expect(resultLabel({ state: 'failure', outcome: { status: 'failure', reason: 'maxSteps' } })).toBe('목표 못 닿음');
    expect(resultLabel({ state: 'success' })).toBe('목표 도달');
  });

  it('takes the newest finished runs of one task, oldest first', () => {
    const ref = (id: string, taskId: string, state: RunRecord['state']) => ({ id, run: { taskId, state } });
    // Newest first, as the dashboard keeps them.
    const runs = [ref('a', 't', 'running'), ref('b', 't', 'success'), ref('c', 'u', 'success'), ref('d', 't', 'failure'), ref('e', 't', 'cancelled'), ref('f', 't', 'inconclusive'), ref('g', 't', 'success')];
    expect(recentRuns(runs, 't').map(item => item.id)).toEqual(['g', 'f', 'd', 'b']);
    expect(recentRuns(runs, 't', 2).map(item => item.id)).toEqual(['d', 'b']);
    expect(recentRuns(runs, 'none')).toEqual([]);
  });
});

describe('settings helpers', () => {
  it('reads a connection\'s key as missing, set or nothing to check without asking anyone', () => {
    const preset = connection('p', { kind: 'llm', provider: 'openai' });
    expect(keyStatus(preset, {})).toBe('missing');
    expect(keyStatus(preset, { 'provider:openai': true })).toBe('set');
    const local = connection('l', { kind: 'llm', baseURL: 'http://127.0.0.1:1234/v1' });
    expect(keyStatus(local, {})).toBe('unchecked');
    const keyed = connection('k', { kind: 'llm', baseURL: 'http://127.0.0.1:1234/v1', apiKeyEnv: 'RAWSTEP_CUSTOM_API_KEY' });
    expect(keyStatus(keyed, { 'connection:k': true })).toBe('set');
    expect(keyStatus(keyed, {})).toBe('unchecked');
  });

  it('names a custom key variable that no other connection uses', () => {
    const list = [connection('a', { apiKeyEnv: 'RAWSTEP_CUSTOM_API_KEY' }), connection('b', { apiKeyEnv: 'RAWSTEP_CUSTOM_API_KEY_2' })];
    expect(generateEnvName([])).toBe('RAWSTEP_CUSTOM_API_KEY');
    expect(generateEnvName(list)).toBe('RAWSTEP_CUSTOM_API_KEY_3');
    expect(generateEnvName(list, 'a')).toBe('RAWSTEP_CUSTOM_API_KEY');
    expect(providerTextKey('decision', 'typesafe')).toBe('decisionTypesafe'); expect(providerTextKey('llm', 'custom')).toBe('llmCustom');
  });

  it('states a run profile as five experiment conditions, the model first', () => {
    const profile = defaultProfile('p', 'Plain');
    const presets = { narrow: { viewport: { width: 375, height: 667 } } };
    const connections = [connection('jev', { name: 'Jev server' }), connection('writer', { name: 'Writer', kind: 'llm' })];
    expect(profileViewport(profile, presets)).toEqual({ width: 1280, height: 800 });
    expect(profileViewport({ environment: 'narrow' }, presets)).toEqual({ width: 375, height: 667 });
    expect(profileViewport({ environment: { id: 'x', viewport: { width: 800, height: 600 } } }, presets)).toEqual({ width: 800, height: 600 });
    expect(profileViewport({ environment: { viewport: { width: -1, height: 'x' } } }, presets)).toEqual({ width: 1280, height: 800 });
    const screenreader = { keys: [], intents: ['next', 'previous', 'activate'] };
    const bare = profileConditions(profile, screenreader, presets, connections);
    expect(bare.map(condition => condition.id)).toEqual(['model', 'actions', 'stuck', 'viewport', 'analysis']);
    expect(bare[0]!.value).toContain('이대로는 실행할 수 없습니다');
    expect(bare[1]!.value).toContain('기본 키보드');
    expect(bare[3]!.value).toBe('1280 × 800');
    expect(bare[4]!.value).toBe('규칙 기반 분석만');
    const full = { ...profileWith('p', 'jev', 'jev-latest', 'Full'), analysisModel: { connectionId: 'writer', modelId: 'gpt-fixture' } };
    const conditions = profileConditions(full, screenreader, presets, connections);
    expect(conditions[0]!.value).toBe('Jev server · jev-latest');
    expect(conditions[4]!.value).toContain('Writer · gpt-fixture');
    expect(choiceName(full.model, connections)).toBe('Jev server · jev-latest');
    // A model on a connection that no longer exists reads as none.
    expect(choiceName({ connectionId: 'gone', modelId: 'x' }, connections)).toBeUndefined();
    expect(choiceName(undefined, connections)).toBeUndefined();
  });
});
