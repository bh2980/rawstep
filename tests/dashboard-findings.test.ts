import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import { elementsFromAriaSnapshot } from '../packages/dashboard/src/server/structure.js';
import { ProjectStore } from '@rawstep/project/store';
import { defaultConfig, defaultModes } from '@rawstep/project/config';
import { TraceRecorder } from '@rawstep/core/trace';
import { HINT_SOURCES, type Hint, type HintKind, type HintReport } from '@rawstep/reports/hints';
import type { TaskFindings, TaskSummary } from '../packages/dashboard/src/shared/api.js';

const dirs: string[] = [], apps: Awaited<ReturnType<typeof startDashboard>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const task = { url: 'https://example.com', goal: 'Complete fixture', verify: { all: [{ titleIncludes: 'Done' }] } };
const waitFor = async (work: () => boolean) => { for (let i = 0; i < 200; i++) { if (work()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timed out'); };
const hint = (kind: HintKind, target: Hint['target'] | undefined, detail: Record<string, unknown> = {}): Hint =>
  ({ kind, source: HINT_SOURCES[kind], ...(target ? { target } : {}), certainty: 'observed', steps: [2], summary: kind, detail, evidence: [] });
const checkout = { role: 'button', name: 'Checkout' };

/** Four sequential runs of one task with the given outcomes; each run's hints.json is then replaced by a fake report. */
async function launch(outcomes: { status: 'success' | 'failure'; steps: number; hints: Hint[] }[]) {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-findings-')); dirs.push(dir);
  const store = new ProjectStore(dir), initial = await store.initialize(), config = defaultConfig();
  config.models.push({ id: 'a', kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1234', name: 'a', modelId: 'a', inputs: ['text', 'image'], capabilitySource: 'manual', maxChoices: 255, maxImages: 2, roles: ['decision'], timeoutMs: 10000 });
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json', modes: defaultModes() });
  await store.save(config, initial.revision, { file: 'task.json', task });
  const app = await startDashboard({ projectDir: dir, port: 0, execute: async (run, actual, out) => {
    const trace = new TraceRecorder({ ...actual, id: 'fixture' }, out); await trace.initialize();
    const outcome = outcomes[run.repeat - 1]!; return trace.finalize({ status: outcome.status, steps: outcome.steps });
  } }); apps.push(app);
  const experiment = await app.queue.create({ taskIds: ['task'], modelIds: ['a'], promptIds: ['baseline'], mode: 'keyboard', repeats: outcomes.length });
  await waitFor(() => experiment.runs.every(run => run.reportStatus === 'complete'));
  const runs = [...experiment.runs].sort((a, b) => a.repeat - b.repeat);
  for (const [i, run] of runs.entries()) {
    const report: Pick<HintReport, 'runId' | 'hints'> = { runId: run.id, hints: outcomes[i]!.hints };
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
    expect(findings.facts).toEqual({ runs: 4, reached: 3, medianSteps: 9, fastest: { experimentId: experiment.id, runId: runs[1]!.id, steps: 2 } });
    // Run-level hints (slow-run) are not findings; findings are ordered by how many runs show them.
    expect(findings.findings.map(f => [f.kind, f.source, f.runs, f.totalRuns])).toEqual([['model-hesitation', 'model', 4, 4], ['excess-keystrokes', 'page', 3, 4], ['focus-lost', 'page', 1, 4]]);
    const keystrokes = findings.findings[1]!;
    expect(keystrokes.target).toEqual(checkout); expect(keystrokes.counts).toEqual({ min: 9, max: 20, mean: 41 / 3 });
    expect(keystrokes.occurrences.map(o => o.runId)).toEqual([runs[0]!.id, runs[2]!.id, runs[3]!.id]);
  });

  it('answers with empty facts for a task that has no runs', async () => {
    const { app } = await launch(outcomes.slice(0, 1));
    const none = await (await fetch(app.url + '/api/tasks/ghost/findings')).json() as TaskFindings;
    expect(none).toEqual({ taskId: 'ghost', facts: { runs: 0, reached: 0, medianSteps: null, fastest: null }, findings: [] });
  });

  it('keeps findings until the set of finished runs changes', async () => {
    const { app, experiment, runs } = await launch(outcomes.slice(0, 2));
    const first = await (await fetch(app.url + '/api/tasks/task/findings')).json() as TaskFindings;
    expect(first.findings.some(f => f.kind === 'excess-keystrokes')).toBe(true);
    await writeFile(join(app.store.root, '.rawstep/experiments', experiment.id, runs[0]!.id, 'hints.json'), JSON.stringify({ runId: runs[0]!.id, hints: [] }));
    expect(await (await fetch(app.url + '/api/tasks/task/findings')).json()).toEqual(first);
  });

  it('summarises the last runs and the most frequent page finding per task', async () => {
    const { app, experiment, runs } = await launch(outcomes);
    const rows = await (await fetch(app.url + '/api/tasks-summary')).json() as TaskSummary[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.taskId).toBe('task');
    expect(row.facts.medianSteps).toBe(9);
    expect(row.recent).toEqual(runs.map((run, i) => ({ experimentId: experiment.id, runId: run.id, steps: outcomes[i]!.steps, reached: outcomes[i]!.status === 'success' })));
    // model-hesitation is more frequent but is about the model; the table shows page findings.
    expect(row.topFinding).toEqual({ kind: 'excess-keystrokes', target: checkout, runs: 3, totalRuns: 4 });
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
