import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultConfig } from '@rawstep/project/config';
import { TraceRecorder } from '@rawstep/core/trace';
import { REPORT_CSP } from '@rawstep/reports/report';
import { HINT_SOURCES, type Hint, type HintKind, type HintReport } from '@rawstep/reports/hints';
import type { ComparedRun, RunComparison, RunResult } from '../packages/dashboard/src/shared/api.js';
import { parseRoute, routeSearch } from '../packages/dashboard/src/web/hooks/useRoute.js';
import { i18n } from '../packages/dashboard/src/web/i18n/index.js';
import { compareDifferences, describeChange, describeRuns, describeSet, groupRuns, sideOfRuns, varyingParts, type CompareRun } from '../packages/dashboard/src/web/lib/compare.js';
import type { RunRef } from '../packages/dashboard/src/web/lib/runs.js';
import { connection, profileWith } from './helpers/project-config.js';

// These tests read the wording of one language, so it is pinned whatever the machine's own language is.
await i18n.changeLanguage('en');

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const waitFor = async (work: () => boolean) => { for (let i = 0; i < 200; i++) { if (work()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out'); };
const subscribe = { role: 'button', name: 'Subscribe' };
const hint = (kind: HintKind, target: Hint['target'] | undefined, detail: Record<string, unknown> = {}): Hint =>
  ({ kind, source: HINT_SOURCES[kind], ...(target ? { target } : {}), certainty: 'observed', steps: [4], summary: kind, detail, evidence: [] });

type Planned = { status: 'success' | 'failure'; steps: number; hints: Hint[]; reason?: 'policy-stuck'; stopSource?: 'user-gave-up' };

/** Two tasks (the page before a fix and after it) with different goals; each run's outcome and hints.json come from `plans[taskId][repeat - 1]`. */
async function launch(plans: Record<'before' | 'after', Planned[]>) {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-compare-')); dirs.push(dir);
  const store = new ProjectStore(dir), initial = await store.initialize(), config = defaultConfig();
  config.connections.push(connection('llm')); config.profiles[0] = profileWith('default', 'llm', 'planner', 'Default');
  config.tasks.push({ id: 'before', name: 'Subscribe, before the fix', file: 'before.json' }, { id: 'after', name: 'Subscribe, after the fix', file: 'after.json' });
  const task = (goal: string) => ({ url: 'https://example.com', goal, verify: { all: [{ titleIncludes: 'Done' }] } });
  await writeFile(join(dir, 'after.json'), JSON.stringify(task('Subscribe to the newsletter')));
  await store.save(config, initial.revision, { file: 'before.json', task: task('Subscribe to the newsletter') });
  const app = await startDashboard({ projectDir: dir, port: 0, execute: async (run, actual, out) => {
    const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize();
    const planned = plans[run.taskId as 'before' | 'after'][run.repeat - 1]!;
    return trace.finalize({ status: planned.status, steps: planned.steps, ...(planned.reason ? { reason: planned.reason, step: planned.steps } : {}), ...(planned.stopSource ? { policyStopSource: planned.stopSource } : {}) });
  } }); apps.push(app);
  const experiment = await app.queue.create({ taskIds: ['before', 'after'], profileIds: ['default'], repeats: 2 });
  await waitFor(() => experiment.runs.every(run => run.reportStatus === 'complete'));
  for (const run of experiment.runs) {
    const report: Pick<HintReport, 'runId' | 'hints'> = { runId: `trace-${run.id}`, hints: plans[run.taskId as 'before' | 'after'][run.repeat - 1]!.hints };
    await writeFile(join(dir, '.rawstep/experiments', experiment.id, run.id, 'hints.json'), JSON.stringify(report));
  }
  const of = (taskId: string, repeat: number) => experiment.runs.find(run => run.taskId === taskId && run.repeat === repeat)!;
  return { app, experiment, of };
}
const compare = async (app: { url: string }, runs: { experiment: string; run: string }[]) => fetch(app.url + '/api/runs/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runs }) });

describe('comparing runs across tasks', () => {
  it('measures each picked run in its own batch and task, in the order asked, with the elements it got stuck on', async () => {
    const { app, experiment, of } = await launch({
      before: [
        { status: 'failure', steps: 34, reason: 'policy-stuck', stopSource: 'user-gave-up', hints: [hint('expectation-broken', subscribe, { assumption: { id: 'A1', text: 'It is a button' }, pressed: 3 }), hint('goal-word-stretch', undefined, { moves: 12 }),
          hint('early-stop', undefined, { stopSource: 'user-gave-up', giveUp: { reason: 'Nothing subscribes', tried: ['A1'] } })] },
        { status: 'failure', steps: 20, hints: [] },
      ],
      after: [
        { status: 'success', steps: 16, hints: [hint('goal-word-stretch', undefined, { moves: 4 })] },
        { status: 'success', steps: 18, hints: [] },
      ],
    });
    const asked = [of('after', 1), of('before', 1)].map(run => ({ experiment: experiment.id, run: run.id }));
    const response = await compare(app, asked);
    expect(response.status).toBe(200);
    const { runs } = await response.json() as RunComparison;
    expect(runs.map(run => run.runId)).toEqual([of('after', 1).id, of('before', 1).id]);
    expect(runs.map(run => [run.taskId, run.profileId, run.result?.ending, run.result?.steps, run.result?.stretch])).toEqual([
      ['after', 'default', 'reached', 16, 4], ['before', 'default', 'gave-up', 34, 12]]);
    // The stuck place is the element, with the step the user got stuck at; the run that did not get stuck has none.
    expect(runs.map(run => run.stuck)).toEqual([[], [{ target: subscribe, step: 4 }]]);
    expect(runs[1]!.result?.giveUp).toMatchObject({ tried: [{ id: 'A1', target: subscribe }] });
  });

  it('refuses runs it cannot find or read, and answers a lone run', async () => {
    const { app, experiment, of } = await launch({ before: [{ status: 'success', steps: 5, hints: [] }, { status: 'success', steps: 6, hints: [] }], after: [{ status: 'success', steps: 5, hints: [] }, { status: 'success', steps: 6, hints: [] }] });
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect((await compare(app, [{ experiment: experiment.id, run: ghost }])).status).toBe(404);
    expect((await compare(app, [])).status).toBe(400);
    expect((await compare(app, [{ experiment: 'x', run: of('before', 1).id }])).status).toBe(400);
    const one = await (await compare(app, [{ experiment: experiment.id, run: of('before', 2).id }])).json() as RunComparison;
    expect(one.runs[0]!.result).toMatchObject({ ending: 'reached', steps: 6 });
  });
});

const result = (extra: Partial<RunResult>): RunResult => ({ experimentId: 'e', runId: 'r', profileId: 'p', ending: 'reached', steps: 10, stretch: null, wrongGuesses: 0, unheard: false, stuck: [], differs: false, ...extra });
const side = (results: Partial<RunResult>[], stuck: { role: string; name?: string }[] = []) => ({ results: results.map(extra => result(extra)), stuck });

describe('the sentence at the top of a comparison', () => {
  const labels = { first: 'before', second: 'after' };

  it('says what changed in plain counts, never which side is better', () => {
    const before = side([{ ending: 'reached', steps: 34, stretch: 12 }, { ending: 'gave-up', steps: 20 }, { ending: 'gave-up', steps: 22 }], [subscribe]);
    const after = side([{ steps: 16, stretch: 4 }, { steps: 16 }, { steps: 20 }]);
    expect(describeChange(before, after, labels)).toEqual([
      'Reached the goal in 1 of 3 runs (before) and 3 of 3 (after).',
      'Median moves of the runs that reached the goal went from 34 to 16.',
      'The longest stretch without a goal word went from 12 to 4 moves.',
      'Stuck places no longer seen: button “Subscribe”. New: none.',
    ]);
    // New places are named too, a few at a time; the same places on both sides are said to be the same.
    const four = [1, 2, 3, 4].map(n => ({ role: 'link', name: `Link ${n}` }));
    expect(describeChange(side([{}]), side([{}], four), labels).at(-1)).toBe('Stuck places no longer seen: none. New: link “Link 1”, link “Link 2”, link “Link 3” and 1 more.');
    expect(describeChange(side([{}], [subscribe]), side([{}], [subscribe]), labels).at(-1)).toBe('The stuck places are the same on both sides.');
    expect(describeChange(side([{}]), side([{}]), labels).at(-1)).toBe('No stuck places on either side.');
  });

  it('keeps one run and one move in the singular, and says so when a side reached the goal in no run', () => {
    expect(describeChange(side([{ ending: 'gave-up' }]), side([{ steps: 1 }]), labels).slice(0, 2)).toEqual([
      'Reached the goal in 0 of 1 run (before) and 1 of 1 (after).',
      'Only the runs after reached the goal, in a median of 1 move.',
    ]);
    expect(describeChange(side([{ steps: 8 }]), side([{ steps: 8 }]), labels)[1]).toBe('Median moves of the runs that reached the goal stayed at 8.');
    // A side with nothing finished has nothing to set against.
    expect(describeChange(side([]), side([{}]), labels)).toEqual(['No run has finished before, so there is nothing to compare.']);
  });

  it('describes runs that have nothing to be set against once, by their counts', () => {
    expect(describeSet(side([{ steps: 4 }, { steps: 10 }, { ending: 'gave-up' }], [subscribe]))).toEqual([
      'Reached the goal in 2 of 3 runs.', 'The runs that reached the goal took 4 to 10 moves, typically 7.', 'Stuck places: button “Subscribe”.']);
    expect(describeSet(side([{ steps: 1 }]))).toEqual(['Reached the goal in 1 of 1 run.', 'The runs that reached the goal all took 1 move.', 'No stuck places.']);
  });

  it('reads in Korean in the dashboard\'s formal style, with the same numbers', async () => {
    await i18n.changeLanguage('ko');
    try {
      expect(describeChange(side([{ ending: 'gave-up' }, { steps: 34 }, { ending: 'gave-up' }], [subscribe]), side([{ steps: 16 }, { steps: 16 }, { steps: 20 }]), { first: '전', second: '후' })).toEqual([
        '목표에 닿은 실행은 3번 중 1번(전), 3번 중 3번(후)입니다.',
        '목표에 닿은 실행의 행동 수는 보통 34번에서 16번으로 바뀌었습니다.',
        '더는 보이지 않는 막힌 곳: 버튼 “Subscribe”. 새로 생긴 막힌 곳: 없음.',
      ]);
    } finally { await i18n.changeLanguage('en'); }
  });
});

describe('which runs are set against which', () => {
  const run = (taskId: string, experiment: string, repeat: number, at: string, extra: { goal?: string; profile?: string; combo?: string } = {}): RunRef => ({
    experiment: { id: experiment, createdAt: at } as RunRef['experiment'],
    run: { id: `${experiment}-${taskId}-${repeat}`, taskId, repeat, startedAt: at, profileId: extra.profile ?? 'p', snapshot: { taskName: taskId, spec: { task: { goal: extra.goal ?? 'Subscribe' }, conditions: { combo: { id: extra.combo ?? 'c' } } } } } as unknown as RunRef['run'],
  });
  const item = (ref: RunRef, compared?: Partial<ComparedRun>): CompareRun => ({ ref, taskName: ref.run.taskId, compared: compared ? { experimentId: ref.experiment.id, runId: ref.run.id, taskId: ref.run.taskId, profileId: 'p', result: null, stuck: [], ...compared } : undefined });

  it('splits by task when the runs come from several tasks, otherwise by batch, oldest first', () => {
    const a = run('before', 'e1', 1, '2026-10-01T00:00:00Z'), b = run('after', 'e2', 1, '2026-10-02T00:00:00Z'), c = run('after', 'e2', 2, '2026-10-02T00:01:00Z');
    expect(groupRuns([item(c), item(b), item(a)])).toMatchObject({ by: 'task', groups: [{ label: 'before', items: [{ ref: a }] }, { label: 'after', items: [{ ref: b }, { ref: c }] }] });
    const x = run('t', 'e1', 1, '2026-10-01T00:00:00Z'), y = run('t', 'e2', 1, '2026-10-03T00:00:00Z');
    const batches = groupRuns([item(y), item(x)]);
    expect(batches.by).toBe('batch');
    expect(batches.groups.map(group => [group.label, group.items.length])).toEqual([['earlier', 1], ['later', 1]]);
    // Several runs of one batch are not two sides.
    expect(groupRuns([item(x), item(run('t', 'e1', 2, '2026-10-01T00:01:00Z'))]).groups).toHaveLength(1);
  });

  it('describes a before-fix task against an after-fix task by the task names', () => {
    const before = run('Subscribe, before', 'e1', 1, '2026-10-01T00:00:00Z'), after = run('Subscribe, after', 'e2', 1, '2026-10-02T00:00:00Z');
    const lines = describeRuns([item(after, { result: result({ steps: 16 }) }), item(before, { result: result({ ending: 'gave-up', steps: 40 }), stuck: [{ target: subscribe, step: 4 }] })]);
    expect(lines[0]).toBe('Reached the goal in 0 of 1 run (Subscribe, before) and 1 of 1 (Subscribe, after).');
    expect(lines.at(-1)).toBe('Stuck places no longer seen: button “Subscribe”. New: none.');
    expect(sideOfRuns([{ experimentId: 'e', runId: 'r', taskId: 't', profileId: 'p', result: null, stuck: [{ target: subscribe, step: 1 }] }]).results).toEqual([]);
  });

  it('tells when the runs differ in the profile, the goal or the rest of the conditions', () => {
    const same = [run('t', 'e1', 1, '2026-10-01T00:00:00Z'), run('t', 'e1', 2, '2026-10-01T00:01:00Z')];
    expect(compareDifferences(same.map(ref => ({ run: ref.run, profile: 'Default' })))).toEqual({ profiles: [], goals: [], parts: [] });
    const other = run('u', 'e2', 1, '2026-10-02T00:00:00Z', { goal: 'Subscribe by email', combo: 'd' });
    expect(compareDifferences([{ run: same[0]!.run, profile: 'Default' }, { run: other.run, profile: 'Careful' }])).toEqual({ profiles: ['Default', 'Careful'], goals: ['Subscribe', 'Subscribe by email'], parts: ['combo'] });
    expect(varyingParts([same[0]!.run, other.run])).toEqual(['combo']);
  });
});

describe('the report as the dashboard serves it', () => {
  it('lets its own language-switch script run, by hash, and no other, in a sandbox without the dashboard\'s origin', async () => {
    const { app, experiment, of } = await launch({ before: [{ status: 'success', steps: 5, hints: [] }, { status: 'success', steps: 6, hints: [] }], after: [{ status: 'success', steps: 5, hints: [] }, { status: 'success', steps: 6, hints: [] }] });
    const response = await fetch(`${app.url}/api/experiments/${experiment.id}/runs/${of('before', 1).id}/report`);
    const policy = response.headers.get('content-security-policy')!;
    expect(policy.startsWith(REPORT_CSP)).toBe(true);
    expect(policy).toContain('sandbox allow-scripts');
    expect(policy).not.toContain('allow-same-origin');
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    const html = await response.text();
    expect(html).toContain('<h1><span class="task">Subscribe, before the fix</span>');
    expect(html).toContain('Subscribe to the newsletter');
  });
});

describe('the address of a comparison', () => {
  it('keeps the picked runs in the URL and drops them anywhere but the run list', () => {
    expect(routeSearch({ view: 'runs', compare: ['a', 'b'] })).toBe('?view=runs&compare=a%2Cb');
    expect(parseRoute('?view=runs&compare=a%2Cb')).toEqual({ view: 'runs', tab: 'overview', compare: ['a', 'b'] });
    expect(parseRoute('?view=runs&compare=a,b,,c').compare).toEqual(['a', 'b', 'c']);
    expect(parseRoute('?view=runs')).toEqual({ view: 'runs', tab: 'overview' });
    expect(routeSearch({ view: 'tasks', compare: ['a'] })).toBe('/');
    expect(routeSearch({ task: 'abc', compare: ['a'] })).toBe('?task=abc');
    expect(parseRoute('?view=tasks&compare=a').compare).toBeUndefined();
    expect(parseRoute('?task=t&compare=a').compare).toBeUndefined();
  });
});
