import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '@rawstep/project/store';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import type { PlanRequest } from '../packages/dashboard/src/shared/config.js';
import { dashboardFixture } from './helpers/dashboard-fixture.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const work of cleanup.splice(0).reverse()) await work(); });
it('executes the real Runner over HTTP with two run profiles/two page environments, decision and LLM choices and text-only simulated speech', async () => {
  const fixture = await dashboardFixture(); cleanup.push(fixture.close);
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-dashboard-browser-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(fixture.config, initial.revision, { file: 'task.json', task: fixture.task });
  await writeFile(join(dir, 'plan.json'), JSON.stringify(fixture.plan));
  const app = await startDashboard({ projectDir: dir, port: 0 }); cleanup.push(() => app.close());
  const request: PlanRequest = { taskIds: ['fixture-task'], profileIds: ['fixture-a', 'fixture-b', 'fixture-a-narrow', 'fixture-b-narrow'], repeats: 1 };
  const experiment = await app.queue.create(request);
  await expect.poll(() => experiment.runs.every(r => !!r.endedAt), { timeout: 20000 }).toBe(true);
  expect(experiment.runs.map(r => r.state)).toEqual(['success', 'success', 'success', 'success']);
  expect(experiment.runs.every(r => r.reportStatus === 'complete')).toBe(true);
  expect(new Set(fixture.requests.map(r => r.instructions)).size).toBe(2);
  expect(fixture.requests.filter(r => r.path.endsWith('/systemone')).some(r => JSON.stringify(r.state).includes('speech'))).toBe(true);
  for (const run of experiment.runs) {
    const trace = await app.queue.trace(experiment.id, run.id);
    expect(trace.environment.observationProvenance).toBe('simulation');
    expect(trace.events.some(e => e.type === 'simulation.observation')).toBe(true);
    // Diagnostic screenshots are kept for people reading the run; the trace holds their paths only.
    expect(trace.events.some(e => e.type === 'browser.screenshot')).toBe(true); expect(JSON.stringify(trace)).not.toContain('pngBase64');
    expect(trace.events.some(e => e.type === 'verifier.result' && (e.data as { passed?: boolean }).passed)).toBe(true);
    expect(await readFile(join(dir, '.rawstep/experiments', experiment.id, run.id, 'report.html'), 'utf8')).toContain('success');
  }
  const llm = await app.queue.create({ ...request, profileIds: ['fixture-llm'] });
  await expect.poll(() => !!llm.runs[0]!.endedAt, { timeout: 10000 }).toBe(true);
  expect(llm.runs[0]!.state).toBe('success');
}, 45000);
