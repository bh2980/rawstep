import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection, createServer } from 'node:net';
import type { RunTrace, TraceEvent } from '@rawstep/core/trace';
import { AtDriverClient } from '@rawstep/screenreaders/at-driver';
import { ProjectStore } from '@rawstep/project/store';
import { matchCue } from '@rawstep/policies/policy';
import { BASE_INTENTS, CASES, MODEL_INTENTS } from '../experiments/native-voiceover/cases.js';
import { auditTrace, checkFoundation, prepareProject, specFor, summary } from '../experiments/native-voiceover/suite.js';
import { driverRelay, plannedAttempts } from '../experiments/native-voiceover/run.js';
import { mockAtDriverServer } from './helpers/mock-at-driver-server.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function temporary() { const dir = await mkdtemp(join(tmpdir(), 'rawstep-native-foundation-')); cleanup.push(() => rm(dir, { recursive: true, force: true })); return dir; }

function trace(): RunTrace {
  const events: TraceEvent[] = [];
  const add = (type: string, data: unknown, commandId?: string) => events.push({ id: `e${events.length}`, seq: events.length + 1, timestamp: new Date().toISOString(), type, source: 'screen-reader', data, redacted: false, ...(commandId ? { commandId } : {}) });
  add('backend.metadata', { profile: 'voiceover', negotiatedCapabilities: { atName: 'VoiceOver' } });
  add('verifier.baseline', { passed: false });
  add('backend.command', { method: 'interaction.userIntent' }, '1');
  add('backend.response', { raw: { id: 1, result: {} } }, '1');
  add('screen-reader.page-entry', { step: 0, entered: true, moves: 1 });
  add('backend.command', { method: 'interaction.userIntent' }, '2');
  add('backend.output', { sequence: 1, text: 'Finish check, button' });
  add('backend.output', { sequence: 2, text: '' });
  add('backend.output', { sequence: 3, text: 'Finish check, button' });
  add('backend.response', { raw: { id: 2, result: {} } }, '2');
  add('action.result', { action: { kind: 'intent', intent: 'next' }, ok: true });
  add('backend.command', { method: 'interaction.userIntent' }, '3');
  add('backend.response', { raw: { id: 3, result: {} } }, '3');
  add('action.result', { action: { kind: 'intent', intent: 'activate' }, ok: true });
  add('verifier.result', { passed: true });
  return { schemaVersion: '3.0', runId: 'test-only', task: { id: 'test' }, environment: { platform: 'test', platformVersion: 'test', browser: 'test', browserVersion: 'test', screenReader: 'VoiceOver', screenReaderVersion: 'test', observationProvenance: 'native' },
    startedAt: 'start', endedAt: 'end', events, outcome: { status: 'success', reason: 'verified' }, privacy: { inputValues: 'redacted', redactionApplied: false } };
}
const foreground = [{ commandId: '1', matched: true }, { commandId: '2', matched: true }, { commandId: '3', matched: true }];

describe('native experiment preparation (no native screen reader runs)', () => {
  it('tells a planner model only what a person wants: every goal is free of keys, ways of moving and page structure', () => {
    const planned = CASES.filter(c => c.userGoal);
    expect(planned.map(c => c.group).sort()).toEqual([...Array(1).fill('limit'), ...Array(3).fill('smoke'), ...Array(10).fill('workflow')]);
    for (const c of planned) expect(c.userGoal).not.toMatch(/\b(rotor|heading\.|intent|key|tab|arrow|selector|voiceover|VO\b|live region|aria)\b/i);
    expect(CASES.filter(c => c.group === 'fault' || c.group === 'contract').every(c => !c.userGoal)).toBe(true);
    expect(MODEL_INTENTS).not.toContain('links.list');
  });
  it('prepares a model run as a person would have it: a Grok connection, the default rules and no plan file for what the model plans', async () => {
    const dir = await temporary(); await prepareProject(dir, '', undefined, 'grok-4.7');
    const { config, taskProblems } = await new ProjectStore(dir).read();
    expect(taskProblems).toEqual({});
    expect(config.connections).toMatchObject([{ id: 'grok', provider: 'grok' }]);
    expect(config.profiles.find(p => p.id === 'S01-button')).toMatchObject({ screenReader: 'voiceover', planner: { connectionId: 'grok', modelId: 'grok-4.7' }, actions: { typeText: true, replaceText: true }, runRules: { survey: 'headings' } });
    expect(config.profiles.find(p => p.id === 'F01-timeout')?.planner).toEqual({ planFile: 'plans/F01-timeout.json' });
    const c = CASES.find(c => c.id === 'S01-button')!, spec = await specFor(c, dir, config);
    expect(spec.plannerModel).toMatchObject({ provider: 'grok', modelId: 'grok-4.7' }); expect(spec.plannerPlan).toBeUndefined(); expect(spec.task.goal).toBe(c.userGoal);
    await expect(readFile(join(dir, 'plans/S01-button.json'), 'utf8')).rejects.toThrow();
    expect(plannedAttempts(CASES, 1, 'grok-4.7').find(a => a.caseId === 'S01-button')?.model).toBe('grok-4.7');
    expect(plannedAttempts(CASES, 1, 'grok-4.7').find(a => a.caseId === 'F01-timeout')?.model).toBeUndefined();
  });
  it('audits a model run on the engine, not on a written plan, and requires that the model planned it', () => {
    const c = CASES.find(c => c.id === 'W06-form-rotor')!, t = trace();
    const plan = (model: unknown) => ({ id: `p${t.events.length}`, seq: t.events.length + 1, timestamp: 'now', type: 'policy.evidence', source: 'policy', data: { evidence: { kind: 'orchestration-plan', model } } }) as TraceEvent;
    t.events.push(plan({ id: 'grok-4.7', runtime: 'agent' }));
    const checks = auditTrace(c, t, { foreground, model: 'grok-4.7' }).checks!;
    expect(checks).toContainEqual({ name: 'planned-by-the-model', passed: true });
    expect(checks.map(check => check.name).filter(name => /^(action:|heard:|rotor-|no-failed-actions|expected-confirmation)/.test(name))).toEqual([]);
    const fixed = trace(); fixed.events.push(plan({ id: 'plans/W06.json', runtime: 'fixed-plan' }));
    expect(auditTrace(c, fixed, { foreground, model: 'grok-4.7' }).checks).toContainEqual({ name: 'planned-by-the-model', passed: false });
    expect(auditTrace(c, trace(), { foreground, model: 'grok-4.7' }).checks).toContainEqual({ name: 'planned-by-the-model', passed: false });
  });
  it('validates every positive plan and refuses simulation-only actions through the product preflight', async () => {
    expect(await checkFoundation()).toMatchObject({ cases: 20, contracts: { typeText: 'unsupported action', replaceText: 'unsupported action' } });
    const dir = await temporary(); await prepareProject(dir);
    const { config, taskProblems } = await new ProjectStore(dir).read();
    expect(taskProblems).toEqual({}); expect(config.connections).toEqual([]);
    expect(config.machine).toMatchObject({ headless: false, parallelRuns: 1 });
    expect(config.profiles.every(p => p.screenReader === 'voiceover' && p.planner && 'planFile' in p.planner)).toBe(true);
    await expect(specFor(CASES.find(c => c.id === 'C01-simulation-only')!, dir, config)).rejects.toMatchObject({ code: 'unsupported-action' });
    expect(await readFile(join(dir, 'plans/S01-button.json'), 'utf8')).toContain('Finish check');
  });
  it('leaves getting into the page to the engine: no plan walks there and no profile is given the key', () => {
    expect(BASE_INTENTS).not.toContain('interact');
    for (const c of CASES) {
      expect(c.actions).not.toContain('intent:interact');
      for (const task of c.tasks) expect(task.moves ?? []).not.toContain('interact');
    }
  });
  it('carries a task on across a page load, on what VoiceOver said when the page opened', () => {
    const onward = (id: string) => CASES.find(c => c.id === id)!;
    expect(onward('S03-navigation').pages).toBe(2); expect(onward('W10-next-page').pages).toBe(2);
    for (const id of ['S03-navigation', 'W10-next-page']) expect(matchCue({ cue: String(onward(id).tasks[1]!.cue) }, 'Native engine check web content')).toBe('heard');
  });
  it('ends the prefilled field and dialog tasks on what real VoiceOver said, not on a shorter name', () => {
    const cue = (id: string, at: number) => ({ cue: String(CASES.find(c => c.id === id)!.tasks[at]!.cue) });
    const filled = 'OLD Insertion at end of text. Query edit text';
    expect(matchCue({ cue: 'Query' }, filled)).not.toBe('heard');
    expect(matchCue(cue('W02-replace', 0), filled)).toBe('heard');
    expect(matchCue(cue('W04-dialog', 1), 'dialog with 2 items Close dialog button')).toBe('heard');
    expect(matchCue(cue('W04-dialog', 2), 'Open dialog button main')).toBe('heard');
    expect(CASES.find(c => c.id === 'W04-dialog')!.tasks.slice(1).every(t => t.activates === true)).toBe(true);
  });
  it('does not overwrite a person’s existing project', async () => {
    const dir = await temporary(); await writeFile(join(dir, 'rawstep.config.json'), 'personal project');
    await expect(prepareProject(dir)).rejects.toThrow('unrelated');
    expect(await readFile(join(dir, 'rawstep.config.json'), 'utf8')).toBe('personal project');
  });
  it('plans all repeats and recoveries before execution and retains unrun/unknown attempts', () => {
    const attempts = plannedAttempts(CASES, 3);
    expect(attempts).toHaveLength(68);
    expect(new Set(attempts.map(a => a.id)).size).toBe(68);
    expect(attempts.filter(a => a.recoveryOf)).toHaveLength(12);
    attempts[0]!.verdict = 'passed'; attempts[1]!.verdict = 'failed'; attempts[2]!.verdict = 'unverified';
    expect(summary(attempts)).toMatchObject({ planned: 68, passed: 1, failed: 1, unverified: 1, 'not-run': 65, nativeRunsWithAcknowledgedKeys: 0 });
  });
});

describe('native experiment evidence audit', () => {
  it('reads actual backend.output events without dropping duplicate utterances or claiming speech completion', () => {
    const result = auditTrace(CASES[0]!, trace(), { foreground });
    expect(result.verdict).toBe('passed');
    expect(result.evidence).toMatchObject({ outputsAfterKey: 2, keysAcknowledged: 3, completionKnown: false, attribution: 'temporal-only' });
  });
  it('refuses a successful engine outcome without independently verified state or native evidence', () => {
    const t = trace(); t.environment.observationProvenance = 'simulation';
    t.events = t.events.filter(e => e.type !== 'verifier.result');
    const result = auditTrace(CASES[0]!, t, { foreground });
    expect(result.verdict).toBe('failed');
    expect(result.checks).toContainEqual({ name: 'native-session', passed: false });
    expect(result.checks).toContainEqual({ name: 'independent-goal-verified', passed: false });
  });
  it('refuses a rotor case whose action returned ok without the rotor ever finding its list', () => {
    const c = CASES.find(c => c.id === 'W06-form-rotor')!;
    const failed = auditTrace(c, trace(), { foreground }).checks!;
    expect(failed).toContainEqual({ name: 'rotor-picked-an-item', passed: false });
  });
  it('keeps a run whose user may not have known as reached, and checks that note against what the case expects', () => {
    const c = CASES.find(c => c.id === 'S01-button')!, t = trace(); t.outcome = { status: 'success', reason: 'verified', goalConfirmed: false };
    expect(auditTrace(c, t, { foreground }).checks).toContainEqual({ name: 'expected-ending', passed: true });
    expect(auditTrace(c, t, { foreground }).checks).toContainEqual({ name: 'expected-confirmation', passed: false });
    expect(auditTrace(CASES.find(c => c.id === 'W09-silent')!, t, { foreground }).checks).toContainEqual({ name: 'expected-confirmation', passed: true });
  });
  it('requires going into every document a multi-page case opens', () => {
    expect(auditTrace(CASES.find(c => c.id === 'W10-next-page')!, trace(), { foreground }).checks).toContainEqual({ name: 'entered-every-page', passed: false });
  });
  it('does not count an error response as a key acknowledgement', () => {
    const t = trace(); for (const e of t.events.filter(e => e.type === 'backend.response')) e.data = { raw: { id: Number(e.commandId), error: 'unknown error' } };
    expect(auditTrace(CASES[0]!, t, { foreground }).evidence!.keysAcknowledged).toBe(0);
  });
  it('requires a guard observation for every key, not only the first action', () => {
    expect(auditTrace(CASES[0]!, trace(), { foreground: foreground.slice(0, 1) }).verdict).toBe('failed');
  });
  it('does not call a delayed announcement captured merely because the DOM check passed', () => {
    const c = CASES.find(c => c.id === 'W08-late')!;
    const result = auditTrace(c, trace(), { foreground });
    expect(result.checks).toContainEqual({ name: 'completion-event-captured', passed: false });
  });
  it('requires evidence of fault injection, separately from an expected failure', () => {
    const c = CASES.find(c => c.id === 'F02-cancel')!, t = trace(); t.outcome = { status: 'aborted', reason: 'aborted' };
    expect(auditTrace(c, t, { foreground }).verdict).toBe('failed');
    expect(auditTrace(c, t, { foreground, injection: { kind: 'cancel', triggered: true } }).verdict).toBe('passed');
  });
});

describe('fault injection boundaries', () => {
  it('forwards native transport bytes unchanged and drops only its own connection', async () => {
    const echo = createServer(socket => socket.pipe(socket));
    await new Promise<void>(yes => echo.listen(0, '127.0.0.1', yes));
    cleanup.push(() => new Promise<void>(yes => echo.close(() => yes())));
    const address = echo.address(); if (!address || typeof address === 'string') throw new Error('No port');
    const relay = await driverRelay(`ws://127.0.0.1:${address.port}/session`); cleanup.push(() => relay.close());
    const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(relay.endpoint).port) }); cleanup.push(async () => { socket.destroy(); });
    const payload = Buffer.from('literal output\n한글\n\n');
    const echoed = new Promise<Buffer>(yes => socket.once('data', yes)); socket.write(payload);
    expect(await echoed).toEqual(payload);
    const closed = new Promise<void>(yes => socket.once('close', () => yes())); relay.disconnect(); await closed;
    const direct = createConnection({ host: '127.0.0.1', port: address.port }); cleanup.push(async () => { direct.destroy(); });
    const reply = new Promise<Buffer>(yes => direct.once('data', yes)); direct.write('still running');
    expect((await reply).toString()).toBe('still running');
  });
  it('can abort synchronously at the recorded command before any physical key reaches the server', async () => {
    const server = await mockAtDriverServer(); cleanup.push(() => server.close());
    const client = new AtDriverClient({ url: server.url }); cleanup.push(() => client.close());
    await client.connect(); await client.request('session.new', { capabilities: { alwaysMatch: { atName: 'VoiceOver' } } });
    const controller = new AbortController();
    client.subscribe(event => { if (event.type === 'command' && event.method === 'interaction.userIntent') controller.abort('foreground-lost'); });
    await expect(client.request('interaction.userIntent', { name: 'pressKeys', keys: ['\uE009', '\uE00A', '\uE014'] }, { signal: controller.signal })).rejects.toBe('foreground-lost');
    expect(server.commands.map(c => c.method)).toEqual(['session.new']);
  });
});
