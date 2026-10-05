import { extractHints, selectReference } from '@rawstep/reports/hints';
import { readTrace, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import type { Hint, HintReport, OverviewRow, RunHintsView, RunStepsView } from '../shared/api.js';
import type { RunRecord } from '../shared/config.js';
import { HttpError, readOptional, type ProjectStore } from './store.js';
import type { ExperimentQueue } from './queue.js';
import { buildSteps } from './steps.js';

const live = (run: RunRecord) => run.state === 'queued' || run.state === 'running';
const finished = (run: RunRecord) => run.state === 'success' || run.state === 'failure' || run.state === 'inconclusive';
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Read-only projections of saved run files for the dashboard UI. */
export class RunViews {
  private readonly hintKinds = new Map<string, Hint['kind'][]>();
  constructor(private readonly store: ProjectStore, private readonly queue: ExperimentQueue) {}
  private dir(experimentId: string, runId: string) { return this.store.file('.rawstep/experiments/' + experimentId + '/' + runId); }
  /** trace.jsonl is append-only, so a partly written last line of a live run is skipped rather than failing the request. */
  private async events(experimentId: string, runId: string): Promise<TraceEvent[]> {
    const raw = await readOptional(await this.store.file('.rawstep/experiments/' + experimentId + '/' + runId + '/trace.jsonl')) ?? '';
    return raw.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as TraceEvent]; } catch { return []; } });
  }
  private async savedHints(experimentId: string, runId: string): Promise<HintReport | undefined> {
    const raw = await readOptional(await this.store.file('.rawstep/experiments/' + experimentId + '/' + runId + '/hints.json')).catch(() => undefined);
    try { return raw ? JSON.parse(raw) as HintReport : undefined; } catch { return undefined; }
  }
  private async trace(experimentId: string, runId: string): Promise<RunTrace | undefined> {
    return readTrace(await this.dir(experimentId, runId)).catch(() => undefined);
  }
  async steps(experimentId: string, runId: string): Promise<RunStepsView> {
    const run = this.queue.find(experimentId, runId), events = await this.events(experimentId, runId);
    // Finished runs carry hints.json from the queue; a running run is analysed from its journal on demand.
    const report = live(run) ? await this.trace(experimentId, runId).then(t => t && extractHints(t)) : await this.savedHints(experimentId, runId) ?? await this.trace(experimentId, runId).then(t => t && extractHints(t));
    return buildSteps({ experimentId, runId, events, ...(report ? { hints: report.hints } : {}), live: live(run) });
  }
  /** Hints against the shortest goal-reaching finished run of the same task and mode, from any experiment. */
  async hints(experimentId: string, runId: string): Promise<RunHintsView> {
    const run = this.queue.find(experimentId, runId), trace = await this.trace(experimentId, runId);
    if (!trace) throw new HttpError(404, '이 실행의 추적 기록이 아직 없습니다.');
    const candidates = this.queue.experiments.flatMap(e => e.runs.filter(r => r.id !== runId && r.taskId === run.taskId && r.snapshot.mode === run.snapshot.mode && r.outcome?.status === 'success' && finished(r)).map(r => ({ experimentId: e.id, run: r })))
      .sort((a, b) => (a.run.outcome?.steps ?? Infinity) - (b.run.outcome?.steps ?? Infinity));
    let reference: { experimentId: string; runId: string; trace: RunTrace } | undefined;
    for (const c of candidates) {
      const t = await this.trace(c.experimentId, c.run.id);
      if (t && selectReference([t])) { reference = { experimentId: c.experimentId, runId: c.run.id, trace: t }; break; }
    }
    return { ...extractHints(trace, reference ? { reference: reference.trace } : {}), ...(reference ? { referenceRun: { experimentId: reference.experimentId, runId: reference.runId } } : {}) };
  }
  /** Task × model aggregation from run records and the hints.json each finished run already has. */
  async overview(): Promise<OverviewRow[]> {
    type Entry = { experimentId: string; run: RunRecord };
    const groups = new Map<string, Entry[]>();
    for (const experiment of this.queue.experiments) for (const run of experiment.runs) {
      const key = JSON.stringify([run.taskId, run.modelId, run.snapshot.mode]);
      groups.set(key, [...groups.get(key) ?? [], { experimentId: experiment.id, run }]);
    }
    const rows: OverviewRow[] = [];
    for (const entries of groups.values()) {
      const runs = entries.map(e => e.run), done = entries.filter(e => finished(e.run));
      const first = runs[0]!, reached = done.map(e => e.run).filter(r => r.outcome?.status === 'success');
      const counts = new Map<string, number>();
      for (const entry of done) for (const kind of new Set(await this.kinds(entry))) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      rows.push({ taskId: first.taskId, taskName: first.snapshot.taskName, modelId: first.modelId, modelName: first.snapshot.model.name, mode: first.snapshot.mode, runs: runs.length, finished: done.length, goalReached: reached.length,
        medianSteps: median(done.flatMap(e => typeof e.run.outcome?.steps === 'number' ? [e.run.outcome.steps] : [])),
        referenceSteps: reached.some(r => typeof r.outcome?.steps === 'number') ? Math.min(...reached.flatMap(r => typeof r.outcome?.steps === 'number' ? [r.outcome.steps] : [])) : null,
        topHints: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([kind, count]) => ({ kind: kind as Hint['kind'], count })) });
    }
    return rows.sort((a, b) => a.taskName.localeCompare(b.taskName) || a.modelName.localeCompare(b.modelName) || a.mode.localeCompare(b.mode));
  }
  private async kinds({ experimentId, run }: { experimentId: string; run: RunRecord }) {
    const cached = this.hintKinds.get(run.id); if (cached) return cached;
    const report = await this.savedHints(experimentId, run.id);
    // A missing hints.json may still be written later; only a read file is cached.
    if (!report) return [];
    const kinds = report.hints.map(h => h.kind); this.hintKinds.set(run.id, kinds); return kinds;
  }
}
