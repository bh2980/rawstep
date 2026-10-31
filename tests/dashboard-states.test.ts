import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../packages/dashboard/src/shared/config.js';
import { RUN_ERROR } from '../packages/dashboard/src/shared/config.js';
import { i18n } from '../packages/dashboard/src/web/i18n/index.js';
import { ApiError } from '../packages/dashboard/src/web/api.js';
import { describeAfterRunFailure, describeApiError, describeRunFailure, errorKindOf } from '../packages/dashboard/src/web/lib/errors.js';
import { generateEnvName, keyStatus } from '../packages/dashboard/src/web/lib/connections.js';
import { choiceName, comboBlocker, comboSummary, environmentViewport, profileReady, sameValue, unsupportedActions } from '../packages/dashboard/src/web/lib/conditions.js';
import { runConditions } from '../packages/dashboard/src/web/lib/runs.js';
import { displayState, recentRuns, resultLabel } from '../packages/dashboard/src/web/lib/runStrip.js';
import { failureDetail, publicOutcome } from '../packages/dashboard/src/server/queue.js';
import { ProjectError } from '@rawstep/project/errors';
import { DEFAULT_PERMISSIONS, defaultConfig, defaultProfile } from '@rawstep/project/config';
import { profileWith, connection } from './helpers/project-config.js';

// These tests read the Korean wording, so the language is pinned whatever the machine's own language is.
await i18n.changeLanguage('ko');

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
    expect(runtime).toMatchObject({ kind: 'runtime', progress: '행동 4번까지 기록되었습니다.', link: { to: { view: 'settings', section: 'connections' } } });
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
    // The server keeps the code and the error's own text; the dashboard puts its words for the code in front, in the language shown.
    expect(failureDetail(new ProjectError('missing-credential', 'No key for a.'), [])).toEqual({ code: 'missing-credential', message: 'No key for a.' });
    const failed = { ...run('failure', undefined, RUN_ERROR.start), errorDetail: { code: 'missing-credential', message: 'No key for a.' } };
    expect(describeRunFailure(failed)).toMatchObject({ kind: 'start', cause: '연결의 인증키가 설정되지 않았습니다. 연결에서 인증키를 입력하세요. No key for a.' });
    expect(describeRunFailure({ ...failed, errorDetail: { message: 'Browser closed.' } })).toMatchObject({ cause: 'Browser closed.' });
    expect(describeRunFailure(failed)!.raw).toContain('code: missing-credential');
    expect(describeRunFailure(run('failure', undefined, RUN_ERROR.start))).not.toHaveProperty('cause');
  });

  it('reports an analysis or report that could not be written without touching the run\'s own outcome', () => {
    expect(describeAfterRunFailure({ analysisStatus: 'complete', reportStatus: 'complete' })).toBeUndefined();
    expect(describeAfterRunFailure({ analysisStatus: 'failed', analysisError: 'analysis-failed', reportStatus: 'complete' })).toMatchObject({ kind: 'data', raw: 'analysis-failed' });
    expect(describeAfterRunFailure({ analysisStatus: 'complete', reportStatus: 'failed', reportError: 'report-failed' })?.what).toContain('보고서');
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

describe('result and run strip helpers', () => {
  it('draws and words a run that ended on an error as undecided, not as a goal that was missed', () => {
    expect(displayState({ state: 'failure', outcome: { status: 'failure', reason: 'error' } })).toBe('inconclusive');
    expect(displayState({ state: 'failure', outcome: { status: 'failure', reason: 'verification-failed' } })).toBe('failure');
    expect(displayState({ state: 'success', outcome: { status: 'success' } })).toBe('success');
    expect(resultLabel({ state: 'failure', outcome: { status: 'failure', reason: 'error' } })).toBe('실행 오류로 끝남');
    // A finished run is worded by how it ended: a limit is not the user failing.
    expect(resultLabel({ state: 'inconclusive', outcome: { status: 'inconclusive', reason: 'maxSteps' } })).toBe('측정 못 함 (최대 행동 수)');
    expect(resultLabel({ state: 'failure', outcome: { status: 'failure', reason: 'policy-stuck', stopSource: 'user-gave-up' } })).toBe('포기함');
    expect(resultLabel({ state: 'failure', outcome: { status: 'failure', reason: 'verification-failed' } })).toBe('잘못 끝냄');
    expect(resultLabel({ state: 'success', outcome: { status: 'success' } })).toBe('해냄');
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
    const preset = connection('p', { provider: 'openai' });
    expect(keyStatus(preset, {})).toBe('missing');
    expect(keyStatus(preset, { 'provider:openai': true })).toBe('set');
    const local = connection('l', { baseURL: 'http://127.0.0.1:1234/v1' });
    expect(keyStatus(local, {})).toBe('unchecked');
    const keyed = connection('k', { baseURL: 'http://127.0.0.1:1234/v1', apiKeyEnv: 'RAWSTEP_CUSTOM_API_KEY' });
    expect(keyStatus(keyed, { 'connection:k': true })).toBe('set');
    expect(keyStatus(keyed, {})).toBe('unchecked');
  });

  it('names a custom key variable that no other connection uses', () => {
    const list = [connection('a', { apiKeyEnv: 'RAWSTEP_CUSTOM_API_KEY' }), connection('b', { apiKeyEnv: 'RAWSTEP_CUSTOM_API_KEY_2' })];
    expect(generateEnvName([])).toBe('RAWSTEP_CUSTOM_API_KEY');
    expect(generateEnvName(list)).toBe('RAWSTEP_CUSTOM_API_KEY_3');
    expect(generateEnvName(list, 'a')).toBe('RAWSTEP_CUSTOM_API_KEY');
  });

  it('names run profiles by their planners, and tells whether a profile can run', () => {
    const presets = { narrow: { viewport: { width: 375, height: 667 } } };
    const connections = [connection('writer', { name: 'Writer' }), connection('other', { name: 'Other' })];
    expect(environmentViewport('default', presets)).toEqual({ width: 1280, height: 800 });
    expect(environmentViewport('narrow', presets)).toEqual({ width: 375, height: 667 });
    expect(environmentViewport({ id: 'x', viewport: { width: 800, height: 600 } }, presets)).toEqual({ width: 800, height: 600 });
    expect(environmentViewport({ viewport: { width: -1, height: 'x' } }, presets)).toEqual({ width: 1280, height: 800 });
    const bare = defaultProfile('p', 'Plain');
    // A new project's profile has no planner yet: it shows no model and cannot run.
    expect(comboSummary(bare, connections)).toBe('모델 없음');
    expect(profileReady(bare, connections)).toBe(false);
    const planned = profileWith('s', 'writer', 'planner-fixture');
    expect(comboSummary(planned, connections)).toBe('planner-fixture');
    expect(comboSummary(profileWith('s', 'writer', ' '), connections)).toBe('Writer');
    expect(comboSummary(profileWith('g', 'gone', 'x'), connections)).toBe('모델 없음');
    expect(comboSummary({ ...bare, planner: { planFile: 'plans/p.json' } }, connections)).toBe('계획 파일 · plans/p.json');
    // Ready to run: a plan file, or a planner model with an ID on a connection that exists.
    expect(profileReady(planned, connections)).toBe(true);
    expect(profileReady(profileWith('e', 'writer', ' '), connections)).toBe(false);
    expect(profileReady(profileWith('g', 'gone', 'x'), connections)).toBe(false);
    expect(profileReady({ ...bare, planner: { planFile: 'plans/p.json' } }, connections)).toBe(true);
    // A missing planner only stops runs, not saving; a planner model without its ID stops saving.
    expect(comboBlocker(bare)).toBeUndefined();
    expect(comboBlocker({ ...bare, planner: { planFile: 'plans/p.json' } })).toBeUndefined();
    expect(comboBlocker(profileWith('s', 'writer', ''))).toBe('modelId');
    expect(comboBlocker({ ...bare, name: ' ' })).toBe('name');
    expect(comboBlocker(planned)).toBeUndefined();
    expect(choiceName(planned.planner as { connectionId: string; modelId: string }, connections)).toBe('Writer · planner-fixture');
    // A model on a connection that no longer exists reads as none.
    expect(choiceName({ connectionId: 'gone', modelId: 'x' }, connections)).toBeUndefined();
    expect(choiceName(undefined, connections)).toBeUndefined();
  });

  it('marks the actions an assistive technology lacks and names the profile of a run', () => {
    const capabilities = { simulation: { keys: [], intents: ['next', 'previous', 'activate'] }, voiceover: { keys: [], intents: ['next', 'previous', 'activate', 'form.next'] }, nvda: { keys: [], intents: ['next', 'previous', 'activate'] } };
    const basic = DEFAULT_PERMISSIONS;
    expect(unsupportedActions({ actions: basic }, capabilities)).toEqual({ simulation: [], voiceover: [], nvda: [] });
    const quick = { ...basic, intents: [...basic.intents, 'form.next'] };
    expect(unsupportedActions({ actions: quick }, capabilities)).toEqual({ simulation: ['form.next'], voiceover: [], nvda: ['form.next'] });
    const config = defaultConfig();
    // A run names its profile as recorded; older runs fall back to their preset or combo, then to the project's profile by id.
    const spec = (conditions: unknown) => ({ backend: 'simulation', plannerModel: { name: 'm' }, conditions });
    const ran = (conditions: unknown, profileId?: string) => runConditions({ snapshot: { spec: spec(conditions) }, ...(profileId ? { profileId } : {}) } as never, config).profile;
    expect(ran({ profile: { id: 'default', name: 'Recorded' } }, 'default')).toBe('Recorded');
    expect(ran({ preset: { name: 'Old preset' }, combo: { name: 'Old combo' } })).toBe('Old preset');
    expect(ran({}, 'default')).toBe('Default');
    expect(ran({}, 'gone')).toBe('gone');
    expect(sameValue({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});
