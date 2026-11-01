import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultConfig } from '@rawstep/project/config';
import { TraceRecorder } from '@rawstep/core/trace';
import { HINT_SOURCES, type Hint, type HintKind } from '@rawstep/reports/hints';
import { compareSummaries, type BatchSummary, type SummaryCell } from '@rawstep/reports/compare';
import { parseRoute, routeSearch } from '../packages/dashboard/src/web/hooks/useRoute.js';
import { i18n } from '../packages/dashboard/src/web/i18n/index.js';
import { csvField, csvText, describeCellChange, exportName, noChangeText, runEndingCode, runFolder, runsCsv, summaryCsv } from '../packages/dashboard/src/web/lib/batchSummary.js';
import { connection, profileWith } from './helpers/project-config.js';

// These tests read the wording of one language, so it is pinned whatever the machine's own language is.
await i18n.changeLanguage('en');

const cell = (extra: Partial<SummaryCell> = {}): SummaryCell => ({
  taskId: 't', taskName: 'Subscribe', profileId: 'p', profileName: 'Default', runs: 3,
  endings: { reached: 3, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [10, 11, 12], stuck: [], pageFindings: [], ...extra,
});
const summary = (cells: SummaryCell[], id = 'b'): BatchSummary => ({ schemaVersion: '1.0', batch: { id, createdAt: '2026-11-01T12:00:00.000Z' }, cells });
const compared = (base: SummaryCell, head: SummaryCell) => describeCellChange(compareSummaries(summary([base]), summary([head])).cells[0]!);

describe('a batch summary in the address', () => {
  it('opens a batch under the run history, with another batch to compare it with', () => {
    expect(parseRoute('?view=runs&batch=abc')).toMatchObject({ view: 'runs', batch: 'abc' });
    expect(parseRoute('?view=runs&batch=abc&against=def')).toMatchObject({ view: 'runs', batch: 'abc', against: 'def' });
    // A baseline needs a batch, and a batch is not its own baseline.
    expect(parseRoute('?view=runs&against=def').against).toBeUndefined();
    expect(parseRoute('?view=runs&batch=abc&against=abc').against).toBeUndefined();
    // A batch summary and runs side by side are different pages: the batch wins. Other pages ignore the parameter.
    expect(parseRoute('?view=runs&batch=abc&compare=r1,r2').compare).toBeUndefined();
    expect(parseRoute('?view=settings&batch=abc').batch).toBeUndefined();
    expect(parseRoute('?task=x&batch=abc').batch).toBeUndefined();
  });

  it('writes the address back so reload and the back button restore the page', () => {
    expect(routeSearch({ view: 'runs', batch: 'abc' })).toBe('?view=runs&batch=abc');
    expect(routeSearch({ view: 'runs', batch: 'abc', against: 'def' })).toBe('?view=runs&batch=abc&against=def');
    expect(routeSearch({ view: 'runs', batch: 'abc', against: 'abc' })).toBe('?view=runs&batch=abc');
    expect(routeSearch({ view: 'runs', batch: 'abc', compare: ['r1', 'r2'] })).toBe('?view=runs&batch=abc');
    expect(parseRoute(routeSearch({ view: 'runs', batch: 'abc', against: 'def' }))).toMatchObject({ batch: 'abc', against: 'def' });
  });
});

describe('what changed from a baseline batch, in words', () => {
  it('states the counts of a drop in reach and a new stuck place, and says nothing about better or worse', () => {
    const change = compared(cell(), cell({ endings: { reached: 1, 'gave-up': 2, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [30], stuck: [{ role: 'button', name: 'Subscribe', runs: 2 }] }));
    expect(change).toEqual({ status: 'changed', sentences: [
      'Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline.',
      'New stuck place: button “Subscribe”, in 2 of 3 runs.',
    ] });
    // A rise reads the same way: the numbers, not a verdict.
    expect(compared(cell({ endings: { reached: 1, 'gave-up': 2, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [30] }), cell()).sentences[0]).toBe('Reached the goal in 3 of 3 runs, against 1 of 3 in the baseline.');
  });

  it('gives the moves outside the spread of the baseline, and a stuck place that is gone', () => {
    const base = cell({ stuck: [{ role: 'link', name: 'Skip', runs: 3 }] });
    const head = cell({ runs: 2, endings: { reached: 2, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [30, 31] });
    expect(compared(base, head).sentences).toEqual([
      'Reaching the goal took a median of 30.5 moves, outside the baseline\'s 7–15 (its runs: 10–12).',
      'No longer a stuck place: link “Skip” (in the baseline: 3 of 3 runs).',
    ]);
  });

  it('calls a difference the spread between repeats explains noise, and says so when there are too few repeats', () => {
    expect(compared(cell(), cell({ reachedMoves: [11, 12, 13] }))).toEqual({ status: 'noise', sentences: [] });
    const few = compared(cell(), cell({ runs: 1, endings: { reached: 0, 'gave-up': 1, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [] }));
    expect(few).toEqual({ status: 'few', sentences: [] });
    expect(noChangeText('noise')).toBe('Within noise');
    expect(noChangeText('few')).toBe('Too few repeats to tell');
  });

  it('counts only the runs that did not end on an error, as the comparison does', () => {
    const head = cell({ runs: 4, endings: { reached: 1, 'gave-up': 2, mistaken: 0, unmeasured: 0, error: 1 }, reachedMoves: [12] });
    expect(compared(cell(), head).sentences[0]).toBe('Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline.');
  });

  it('names a task and profile the baseline lacks, and words it in Korean when Korean is shown', async () => {
    const result = describeCellChange(compareSummaries(summary([]), summary([cell()])).cells[0]!);
    expect(result).toEqual({ status: 'changed', sentences: ['Not in the baseline.'] });
    await i18n.changeLanguage('ko');
    try {
      const ko = compared(cell(), cell({ endings: { reached: 1, 'gave-up': 2, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [30] }));
      expect(ko.sentences).toEqual(['목표에 닿은 실행이 3번 중 1번입니다. 기준은 3번 중 3번입니다.']);
      expect(noChangeText('noise')).toBe('노이즈 범위 안');
      expect(noChangeText('few')).toBe('반복이 적어 판단 못 함');
    } finally { await i18n.changeLanguage('en'); }
  });
});

describe('files', () => {
  it('quotes what CSV needs quoted and keeps a spreadsheet from running text as a formula', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField(-3)).toBe('-3');
    expect(csvField(undefined)).toBe('');
    expect(csvField(null)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
    expect(csvText([['a', 1], ['b', undefined]])).toBe('a,1\r\nb,\r\n');
  });

  it('writes one CSV row per task and profile of a summary', () => {
    const lines = summaryCsv({ ...summary([
      cell({ taskName: 'Subscribe, quickly', endings: { reached: 2, 'gave-up': 1, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: [10, 14], stuck: [{ role: 'button', name: 'Go', runs: 2 }], pageFindings: [{ kind: 'focus-lost', role: 'dialog', runs: 1 }] }),
      cell({ profileId: 'q', profileName: 'Fast', runs: 1, endings: { reached: 0, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 1 }, reachedMoves: [] }),
    ]), batch: { id: 'b', createdAt: '2026-11-01T12:00:00.000Z', note: 'made Add a button' } }).split('\r\n');
    expect(lines[0]).toBe('batch,date,task,profile,runs,reached,gave_up,said_done_not_reached,not_measured,errors,median_moves,min_moves,max_moves,stuck_places,page_findings');
    expect(lines[1]).toBe('made Add a button,2026-11-01T12:00:00.000Z,"Subscribe, quickly",Default,3,2,1,0,0,0,12,10,14,"button ""Go"" (2/3)",1');
    expect(lines[2]).toBe('made Add a button,2026-11-01T12:00:00.000Z,Subscribe,Fast,1,0,0,0,0,1,,,,,0');
    expect(lines).toHaveLength(4);
  });

  it('writes the picked runs as CSV, leaving out what is not known', () => {
    const text = runsCsv([
      { task: 'Subscribe', profile: 'Default', run: 2, date: '2026-11-01T12:00:00.000Z', ending: 'reached', moves: 12, pageFindings: 1, folder: runFolder('e1', 'r1') },
      { task: 'Subscribe', profile: 'Default', run: undefined, date: '2026-11-01T12:05:00.000Z', ending: 'error', moves: undefined, pageFindings: undefined, folder: runFolder('e1', 'r2') },
    ]);
    expect(text).toBe([
      'task,profile,run,date,ending,moves,page_findings,folder',
      'Subscribe,Default,2,2026-11-01T12:00:00.000Z,reached,12,1,.rawstep/experiments/e1/r1',
      'Subscribe,Default,,2026-11-01T12:05:00.000Z,error,,,.rawstep/experiments/e1/r2', '',
    ].join('\r\n'));
  });

  it('codes how a run ended: its ending, an error, or its state', () => {
    expect(runEndingCode({ state: 'success', outcome: { status: 'success' } })).toBe('reached');
    expect(runEndingCode({ state: 'failure', outcome: { status: 'failure', reason: 'error' } })).toBe('error');
    expect(runEndingCode({ state: 'failure' })).toBe('error');
    expect(runEndingCode({ state: 'cancelled' })).toBe('cancelled');
    expect(runEndingCode({ state: 'running' })).toBe('running');
  });

  it('names a file by prefix and local date', () => {
    expect(exportName('rawstep-summary', '2026-11-01T12:00:00.000Z', 'json')).toBe('rawstep-summary-2026-11-01.json');
    expect(exportName('rawstep-runs', '2026-11-01T12:00:00.000Z', 'csv')).toBe('rawstep-runs-2026-11-01.csv');
    expect(exportName('rawstep-runs', undefined, 'csv')).toMatch(/^rawstep-runs-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportName('rawstep-runs', 'not a date', 'csv')).toMatch(/^rawstep-runs-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const waitFor = async (work: () => boolean) => { for (let i = 0; i < 200; i++) { if (work()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out'); };
const subscribe = { role: 'button', name: 'Subscribe' };
const hint = (kind: HintKind, target: Hint['target'] | undefined, detail: Record<string, unknown> = {}): Hint =>
  ({ kind, source: HINT_SOURCES[kind], ...(target ? { target } : {}), certainty: 'observed', steps: [4], summary: kind, detail, evidence: [] });

describe('GET /api/experiments/:id/summary', () => {
  it('sums a finished batch up per task and profile, and writes summary.json when a batch has none', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-summary-')); dirs.push(dir);
    const store = new ProjectStore(dir), initial = await store.initialize(), config = defaultConfig();
    config.connections.push(connection('llm')); config.profiles[0] = profileWith('default', 'llm', 'planner', 'Default');
    config.tasks.push({ id: 'before', name: 'Subscribe, before the fix', file: 'before.json' }, { id: 'after', name: 'Subscribe, after the fix', file: 'after.json' });
    const task = { url: 'https://example.com', goal: 'Subscribe to the newsletter', verify: { all: [{ titleIncludes: 'Done' }] } };
    await writeFile(join(dir, 'after.json'), JSON.stringify(task));
    await store.save(config, initial.revision, { file: 'before.json', task });
    const app = await startDashboard({ projectDir: dir, port: 0, execute: async (run, actual, out) => {
      const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize();
      return run.taskId === 'after'
        ? trace.finalize({ status: 'success', steps: 10 + run.repeat * 6 })
        : trace.finalize({ status: 'failure', steps: 34, reason: 'policy-stuck', step: 34, policyStopSource: 'user-gave-up' });
    } }); apps.push(app);
    const experiment = await app.queue.create({ taskIds: ['before', 'after'], profileIds: ['default'], repeats: 2, note: 'the fix' });
    await waitFor(() => experiment.runs.every(run => run.reportStatus === 'complete'));
    // The moves of a run come from its hints.json.
    for (const run of experiment.runs) {
      const stuck = run.taskId === 'before' ? [hint('expectation-broken', subscribe, { assumption: { id: 'A1', text: 'It is a button' }, pressed: 3 })] : [];
      await writeFile(join(dir, '.rawstep/experiments', experiment.id, run.id, 'hints.json'), JSON.stringify({ runId: `trace-${run.id}`, steps: run.taskId === 'before' ? 34 : 10 + run.repeat * 6, hints: stuck }));
    }
    // The queue wrote the summary when the last run ended; remove it to see one written on request from the runs' own files.
    const file = join(dir, '.rawstep/experiments', experiment.id, 'summary.json');
    await rm(file, { force: true });
    const response = await fetch(`${app.url}/api/experiments/${experiment.id}/summary`);
    expect(response.status).toBe(200);
    const body = await response.json() as BatchSummary;
    expect(body).toMatchObject({ schemaVersion: '1.0', batch: { id: experiment.id, note: 'the fix' } });
    const cellOf = (taskId: string) => body.cells.find(item => item.taskId === taskId)!;
    expect(cellOf('after')).toMatchObject({ profileId: 'default', profileName: 'Default', runs: 2, reachedMoves: [16, 22], stuck: [] });
    expect(cellOf('before')).toMatchObject({ runs: 2, endings: { reached: 0, 'gave-up': 2, error: 0 }, stuck: [{ role: 'button', name: 'Subscribe', runs: 2 }] });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(body);
    // The file is read next time, and unknown batches are refused.
    expect(await (await fetch(`${app.url}/api/experiments/${experiment.id}/summary`)).json()).toEqual(body);
    expect((await fetch(`${app.url}/api/experiments/00000000-0000-0000-0000-000000000000/summary`)).status).toBe(404);
  });
});
