import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { elementsFromAriaSnapshot } from '../packages/dashboard/src/server/structure.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultConfig } from '@rawstep/project/config';
import { TraceRecorder } from '@rawstep/core/trace';
import { profileWith, plannedWith, connection } from './helpers/project-config.js';
import { HINT_SOURCES, type Hint, type HintKind, type HintReport } from '@rawstep/reports/hints';
import type { TaskFindings, TaskSummary } from '../packages/dashboard/src/shared/api.js';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const task = { url: 'https://example.com', goal: 'Complete fixture', verify: { all: [{ titleIncludes: 'Done' }] } };
const waitFor = async (work: () => boolean) => { for (let i = 0; i < 200; i++) { if (work()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out'); };
const hint = (kind: HintKind, target: Hint['target'] | undefined, detail: Record<string, unknown> = {}): Hint =>
  ({ kind, source: HINT_SOURCES[kind], ...(target ? { target } : {}), certainty: 'observed', steps: [2], summary: kind, detail, evidence: [] });
const checkout = { role: 'button', name: 'Checkout' };

/**
 * Sequential runs of one task with the given outcomes (keyboard mode unless told); each run's hints.json is then replaced by a fake
 * report. `heard` records a `goal.reached` event saying whether the user heard the goal.
 */
async function launch(outcomes: { status: 'success' | 'failure'; steps: number; hints: Hint[]; heard?: boolean; reason?: 'policy-stuck'; stopSource?: 'user-gave-up' }[], mode: 'keyboard' | 'screenreader' = 'keyboard') {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-findings-')); dirs.push(dir);
  const store = new ProjectStore(dir), initial = await store.initialize(), config = defaultConfig();
  config.connections.push(connection('a'), connection('llm', { kind: 'llm' })); config.profiles[0] = plannedWith(profileWith('default', 'a', 'm-a', 'Default', mode), 'llm');
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json' });
  await store.save(config, initial.revision, { file: 'task.json', task });
  const app = await startDashboard({ projectDir: dir, port: 0, execute: async (run, actual, out) => {
    const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize();
    const outcome = outcomes[run.repeat - 1]!;
    if (outcome.heard !== undefined) trace.append('goal.reached', { step: outcome.steps, heard: outcome.heard, grace: 0 });
    return trace.finalize({ status: outcome.status, steps: outcome.steps, ...(outcome.reason ? { reason: outcome.reason, step: outcome.steps } : {}), ...(outcome.stopSource ? { policyStopSource: outcome.stopSource } : {}) });
  } }); apps.push(app);
  const experiment = await app.queue.create({ taskIds: ['task'], profileIds: ['default'], repeats: outcomes.length });
  await waitFor(() => experiment.runs.every(run => run.reportStatus === 'complete'));
  const runs = [...experiment.runs].sort((a, b) => a.repeat - b.repeat);
  for (const [i, run] of runs.entries()) {
    // Like a real hints.json: it names the trace's own run id, not the dashboard run id.
    const report: Pick<HintReport, 'runId' | 'hints'> = { runId: `trace-${run.id}`, hints: outcomes[i]!.hints };
    await writeFile(join(dir, '.rawstep/experiments', experiment.id, run.id, 'hints.json'), JSON.stringify(report));
  }
  return { app, experiment, runs };
}

const outcomes = [
  { status: 'success' as const, steps: 11, hints: [hint('excess-keystrokes', checkout, { count: 12 }), hint('focus-lost', checkout), hint('model-hesitation', undefined, {}), hint('slow-run', undefined, {})] },
  { status: 'success' as const, steps: 2, hints: [hint('model-hesitation', undefined, {})] },
  { status: 'failure' as const, steps: 20, hints: [hint('excess-keystrokes', checkout, { count: 20 }), hint('model-hesitation', undefined, {})] },
  { status: 'success' as const, steps: 7, hints: [hint('excess-keystrokes', checkout, { count: 9 }), hint('model-hesitation', undefined, {})] },
];

describe('task findings and summary', () => {
  it('groups hints across a task\'s finished runs and reports its facts', async () => {
    const { app, experiment, runs } = await launch(outcomes);
    const findings = await (await fetch(app.url + '/api/tasks/task/findings')).json() as TaskFindings;
    expect(findings.facts).toEqual({ runs: 4, reached: 3, medianSteps: 9, fastest: { experimentId: experiment.id, runId: runs[1]!.id, steps: 2 },
      byProfile: [{ profileId: 'default', mode: 'keyboard', runs: 4, reached: 3, endings: { reached: 3, 'gave-up': 0, mistaken: 0, unmeasured: 1 }, unmeasuredBy: { other: 1 },
        medianSteps: 7, minSteps: 2, maxSteps: 11, unheard: 0, topTarget: checkout, conditions: { combo: 'Default', at: 'Default' }, differing: 0, longestStretch: null }] });
    // Reaching the goal is what the cost is counted over; a run that ended another way is counted by how it ended.
    expect(findings.results.map(r => [r.ending, r.steps])).toEqual([['reached', 11], ['reached', 2], ['unmeasured', 20], ['reached', 7]]);
    // Run-level hints (slow-run) are not findings; findings are ordered by how many runs show them.
    expect(findings.findings.map(f => [f.kind, f.source, f.runs, f.totalRuns])).toEqual([['model-hesitation', 'model', 4, 4], ['excess-keystrokes', 'page', 3, 4], ['focus-lost', 'page', 1, 4]]);
    const keystrokes = findings.findings[1]!;
    expect(keystrokes.target).toEqual(checkout); expect(keystrokes.counts).toEqual({ min: 9, max: 20, mean: 41 / 3 });
    expect(keystrokes.occurrences.map(o => o.runId)).toEqual([runs[0]!.id, runs[2]!.id, runs[3]!.id]);
  });

  it('answers with empty facts for a task that has no runs', async () => {
    const { app } = await launch(outcomes.slice(0, 1));
    const none = await (await fetch(app.url + '/api/tasks/ghost/findings')).json() as TaskFindings;
    expect(none).toEqual({ taskId: 'ghost', facts: { runs: 0, reached: 0, medianSteps: null, fastest: null, byProfile: [] }, findings: [], results: [], stuck: [] });
  });

  it('counts screen reader runs that reached the goal without the user hearing it', async () => {
    const { app } = await launch([
      { status: 'success', steps: 9, hints: [], heard: false },
      { status: 'success', steps: 5, hints: [], heard: true },
      { status: 'failure', steps: 12, hints: [] },
    ], 'screenreader');
    const findings = await (await fetch(app.url + '/api/tasks/task/findings')).json() as TaskFindings;
    expect(findings.facts.byProfile).toEqual([{ profileId: 'default', mode: 'screenreader', runs: 3, reached: 2, endings: { reached: 2, 'gave-up': 0, mistaken: 0, unmeasured: 1 }, unmeasuredBy: { other: 1 },
      medianSteps: 7, minSteps: 5, maxSteps: 9, unheard: 1, topTarget: null, conditions: { combo: 'Default', at: 'Default' }, differing: 0, longestStretch: null }]);
  });

  it('tells how each run ended and where the user\'s expectations broke, with the give-ups that rest on them', async () => {
    const text = { role: 'StaticText', name: 'Add to cart' };
    const broke = (id: string, gaveUpOn?: boolean) => ({ ...hint('expectation-broken', text, { assumption: { id, text: 'The add control is a button' }, ...(gaveUpOn ? { gaveUpOn } : {}) }), steps: [17] });
    const { app, runs } = await launch([
      { status: 'failure', steps: 34, reason: 'policy-stuck', stopSource: 'user-gave-up', hints: [broke('A3', true),
        { ...hint('early-stop', undefined, { stopSource: 'user-gave-up', giveUp: { reason: 'Nothing adds it', tried: ['A3'] } }), steps: [34] }, hint('goal-word-stretch', undefined, { moves: 9 })] },
      { status: 'success', steps: 290, hints: [broke('A1'), hint('goal-word-stretch', undefined, { moves: 58 })] },
    ], 'screenreader');
    const findings = await (await fetch(app.url + '/api/tasks/task/findings')).json() as TaskFindings;
    expect(findings.results.map(r => [r.ending, r.steps, r.stretch, r.stuck])).toEqual([['gave-up', 34, 9, [{ place: 0, step: 17 }]], ['reached', 290, 58, [{ place: 0, step: 17 }]]]);
    expect(findings.results[0]!.giveUp).toEqual({ reason: 'Nothing adds it', step: 34, tried: [{ id: 'A3', text: 'The add control is a button', step: 17, target: text }] });
    expect(findings.stuck).toEqual([{ target: text, runs: 2, totalRuns: 2, byProfile: [{ profileId: 'default', mode: 'screenreader', runs: 2 }], gaveUpOn: 1, assumptions: ['The add control is a button'] }]);
    expect(findings.facts.byProfile[0]).toMatchObject({ endings: { reached: 1, 'gave-up': 1 }, medianSteps: 290, longestStretch: { moves: 58, runId: runs[1]!.id } });
  });

  it('keeps findings until the set of finished runs changes', async () => {
    const { app, experiment, runs } = await launch(outcomes.slice(0, 2));
    const first = await (await fetch(app.url + '/api/tasks/task/findings')).json() as TaskFindings;
    expect(first.findings.some(f => f.kind === 'excess-keystrokes')).toBe(true);
    await writeFile(join(app.store.root, '.rawstep/experiments', experiment.id, runs[0]!.id, 'hints.json'), JSON.stringify({ runId: runs[0]!.id, hints: [] }));
    expect(await (await fetch(app.url + '/api/tasks/task/findings')).json()).toEqual(first);
  });

  it('summarises how many page elements recur and the most frequent page finding per task', async () => {
    const { app } = await launch(outcomes);
    const rows = await (await fetch(app.url + '/api/tasks-summary')).json() as TaskSummary[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.taskId).toBe('task');
    expect(row.facts.medianSteps).toBe(9);
    expect(row).not.toHaveProperty('recent');
    // model-hesitation is more frequent but is about the model; the table shows page findings.
    expect(row.topFinding).toEqual({ kind: 'excess-keystrokes', target: checkout, runs: 3, totalRuns: 4 });
    expect(row.findingCount).toBeGreaterThanOrEqual(1);
    expect(Date.parse(row.lastRunAt!)).not.toBeNaN();
  });
});

describe('page elements', () => {
  it('lists the operable elements, announcements and landmarks of an accessibility snapshot once each', () => {
    const snapshot = [
      '- banner:', '  - link "Home":', '    - /url: /', '- main:', '  - heading "Cart" [level=1]',
      '  - button "Checkout"', '  - button "Checkout"', '  - textbox "Email address"', '  - dialog "Confirm order":', '    - button "Yes, \\"place\\" it"',
      '  - status', '  - text: plain text', '  - paragraph: hello', '  - region', '  - button',
    ].join('\n');
    expect(elementsFromAriaSnapshot(snapshot)).toEqual([
      { role: 'banner' }, { role: 'link', name: 'Home' }, { role: 'main' }, { role: 'heading', name: 'Cart' }, { role: 'button', name: 'Checkout' },
      { role: 'textbox', name: 'Email address' }, { role: 'dialog', name: 'Confirm order' }, { role: 'button', name: 'Yes, "place" it' }, { role: 'status' },
    ]);
  });
});
