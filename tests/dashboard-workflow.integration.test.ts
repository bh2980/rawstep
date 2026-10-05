import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '@rawstep/project/store';
import { startDashboard } from '../packages/dashboard/src/server/index.js';
import type { PlanRequest } from '../packages/dashboard/src/shared/config.js';
import { dashboardFixture } from './helpers/dashboard-fixture.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const work of cleanup.splice(0).reverse()) await work(); });
it('executes the real Runner over HTTP with two models/two prompts, LLM choices and simulated speech', async () => {
  const fixture = await dashboardFixture(); cleanup.push(fixture.close);
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-dashboard-browser-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const store = new ProjectStore(dir); const initial = await store.initialize(); await store.save(fixture.config, initial.revision, { file: 'task.json', task: fixture.task });
  const app = await startDashboard({ projectDir: dir, port: 0 }); cleanup.push(() => app.close());
  const request: PlanRequest = { taskIds: ['fixture-task'], modelIds: ['fixture-a', 'fixture-b'], promptIds: ['baseline', 'careful'], mode: 'keyboard', profileIds: ['default'], repeats: 1 };
  const experiment = await app.queue.create(request);
  await expect.poll(() => experiment.runs.every(r => !!r.endedAt), { timeout: 20000 }).toBe(true);
  expect(experiment.runs.map(r => r.state)).toEqual(['success', 'success', 'success', 'success']);
  expect(experiment.runs.every(r => r.reportStatus === 'complete')).toBe(true);
  expect(new Set(fixture.requests.map(r => r.instructions)).size).toBe(2);
  for (const run of experiment.runs) {
    const trace = await app.queue.trace(experiment.id, run.id);
    expect(trace.events.some(e => e.type === 'keyboard.observation')).toBe(true);
    expect(trace.events.some(e => e.type === 'verifier.result' && (e.data as { passed?: boolean }).passed)).toBe(true);
    expect(await readFile(join(dir, '.rawstep/experiments', experiment.id, run.id, 'report.html'), 'utf8')).toContain('success');
  }
  const llm = await app.queue.create({ ...request, modelIds: ['fixture-llm'], promptIds: ['baseline'] });
  await expect.poll(() => !!llm.runs[0]!.endedAt, { timeout: 10000 }).toBe(true);
  expect(llm.runs[0]!.state).toBe('success');
  const speech = await app.queue.create({ ...request, modelIds: ['fixture-a'], promptIds: ['baseline'], mode: 'screenreader' });
  await expect.poll(() => !!speech.runs[0]!.endedAt, { timeout: 10000 }).toBe(true);
  expect(speech.runs[0]!.state).toBe('success');
  const speechTrace = await app.queue.trace(speech.id, speech.runs[0]!.id);
  expect(speechTrace.environment.observationProvenance).toBe('simulation');
  expect(fixture.requests.filter(r => r.path.endsWith('/systemone')).some(r => JSON.stringify(r.state).includes('speech'))).toBe(true);
}, 45000);
