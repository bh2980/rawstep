import { aggregateHints, extractHints, selectReference, type HintFinding } from '@rawstep/reports/hints';
import { readTrace, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import type { AnalysisReport } from '@rawstep/reports';
import type { HintReport, RunExplanation, RunHintsView, RunStepsView, TaskFindings, TaskSummary } from '../shared/api.js';
import type { RunRecord } from '../shared/config.js';
import { readOptional, type ProjectStore } from '@rawstep/project/store';
import { HttpError } from './http.js';
import type { ExperimentQueue } from './queue.js';
import { buildPlan, buildSteps, eventSteps } from './steps.js';

const live = (run: RunRecord) => run.state === 'queued' || run.state === 'running';
const finished = (run: RunRecord) => run.state === 'success' || run.state === 'failure' || run.state === 'inconclusive';
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Read-only projections of saved run files for the dashboard UI. */
export class RunViews {
  /** Findings per task, valid while the task's set of finished runs is the one they were computed from. */
  private readonly findingsCache = new Map<string, { key: string; findings: HintFinding[] }>();
  /** Whether a finished run reached its goal unheard; a finished run's journal does not change. */
  private readonly unheardCache = new Map<string, boolean>();
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
  /** The initial trace.json plus the journal events read so far; readTrace would reject a half-written last line. */
  private async liveTrace(experimentId: string, runId: string, events: TraceEvent[]): Promise<RunTrace | undefined> {
    const raw = await readOptional(await this.store.file('.rawstep/experiments/' + experimentId + '/' + runId + '/trace.json')).catch(() => undefined);
    try { return raw ? { ...(JSON.parse(raw) as RunTrace), events } : undefined; } catch { return undefined; }
  }
  async steps(experimentId: string, runId: string): Promise<RunStepsView> {
    const run = this.queue.find(experimentId, runId), events = await this.events(experimentId, runId);
    // Finished runs carry hints.json from the queue; a running run is analysed from its journal on demand.
    const report = live(run) ? await this.liveTrace(experimentId, runId, events).then(t => t && extractHints(t)) : await this.savedHints(experimentId, runId) ?? await this.trace(experimentId, runId).then(t => t && extractHints(t));
    const explanation = live(run) || !run.analysisModel ? undefined : await this.explanation(experimentId, runId, events);
    const plan = buildPlan(events);
    return { ...buildSteps({ experimentId, runId, events, ...(report ? { hints: report.hints } : {}), live: live(run) }), modelKind: run.snapshot.spec.model.kind, hints: report?.hints ?? [],
      ...(explanation ? { explanation } : {}), ...(plan ? { plan } : {}) };
  }
  /** The LLM's analysis.json of a run, with each finding's cited events turned into steps. The rule-based analysis is not shown here: hints cover it. */
  private async explanation(experimentId: string, runId: string, events: TraceEvent[]): Promise<RunExplanation | undefined> {
    const raw = await readOptional(await this.store.file('.rawstep/experiments/' + experimentId + '/' + runId + '/analysis.json')).catch(() => undefined);
    let report: Partial<AnalysisReport>;
    try { report = raw ? JSON.parse(raw) as Partial<AnalysisReport> : {}; } catch { return undefined; }
    if (!report.analyzer?.id.startsWith('rawstep/llm')) return undefined;
    if (report.status !== 'completed') return { status: 'failed', summary: '', findings: [] };
    const at = eventSteps(events);
    return { status: 'completed', summary: String(report.summary ?? ''), findings: (report.findings ?? []).map(finding => ({
      title: finding.title, description: finding.description, severity: finding.severity,
      steps: [...new Set(finding.evidenceEventIds.flatMap(id => at.get(id) ?? []))].sort((a, b) => a - b),
    })) };
  }
  /** Hints against the shortest goal-reaching finished run of the same task and mode, from any experiment. */
  async hints(experimentId: string, runId: string): Promise<RunHintsView> {
    const run = this.queue.find(experimentId, runId), trace = await this.trace(experimentId, runId);
    if (!trace) throw new HttpError(404, '이 실행의 추적 기록이 아직 없습니다.');
    const candidates = this.queue.experiments.flatMap(e => e.runs.filter(r => r.id !== runId && r.taskId === run.taskId && r.mode === run.mode && r.structure === run.structure && r.outcome?.status === 'success' && finished(r)).map(r => ({ experimentId: e.id, run: r })))
      .sort((a, b) => (a.run.outcome?.steps ?? Infinity) - (b.run.outcome?.steps ?? Infinity));
    let reference: { experimentId: string; runId: string; trace: RunTrace } | undefined;
    for (const c of candidates) {
      const t = await this.trace(c.experimentId, c.run.id);
      if (t && selectReference([t])) { reference = { experimentId: c.experimentId, runId: c.run.id, trace: t }; break; }
    }
    return { ...extractHints(trace, reference ? { reference: reference.trace } : {}), ...(reference ? { referenceRun: { experimentId: reference.experimentId, runId: reference.runId } } : {}) };
  }
  /** Every run of one task, oldest first, with the time it started (or, when it has not, its experiment was created). */
  private taskEntries(taskId: string) {
    return this.queue.experiments
      .flatMap(experiment => experiment.runs.filter(run => run.taskId === taskId).map(run => ({ experimentId: experiment.id, run, at: run.startedAt ?? experiment.createdAt })))
      .sort((a, b) => a.at.localeCompare(b.at) || a.run.repeat - b.run.repeat);
  }
  private async taskData(taskId: string) {
    // A run that never got going (the browser or model could not start) is not evidence about the page.
    const entries = this.taskEntries(taskId), done = entries.filter(entry => finished(entry.run) && entry.run.outcome?.reason !== 'error');
    const steps = (run: RunRecord) => typeof run.outcome?.steps === 'number' ? run.outcome.steps : undefined;
    const reached = done.filter(entry => entry.run.outcome?.status === 'success');
    const fastest = reached.reduce<typeof reached[number] | undefined>((best, entry) => steps(entry.run) !== undefined && (!best || steps(entry.run)! < steps(best.run)!) ? entry : best, undefined);
    const key = done.map(entry => entry.run.id).join(',');
    let cached = this.findingsCache.get(taskId);
    if (cached?.key !== key) {
      // hints.json names the trace's run id; findings must point at the dashboard run so links and run numbers resolve.
      const reports = (await Promise.all(done.map(async entry => {
        const report = await this.savedHints(entry.experimentId, entry.run.id);
        return report ? { ...report, runId: entry.run.id } : undefined;
      }))).filter((report): report is HintReport => !!report);
      cached = { key, findings: aggregateHints(reports) };
      // A missing hints.json may still be written; only a complete set is kept.
      if (reports.length === done.length) this.findingsCache.set(taskId, cached); else this.findingsCache.delete(taskId);
    }
    const unheard = new Set<string>();
    for (const entry of reached) if (await this.unheard(entry.experimentId, entry.run.id)) unheard.add(entry.run.id);
    const groups = new Map<string, typeof done>();
    for (const entry of done) { const group = `${entry.run.profileId}\u0000${entry.run.mode}`; groups.set(group, [...groups.get(group) ?? [], entry]); }
    const byProfile = [...groups.values()].map(group => {
      const counts = group.flatMap(entry => steps(entry.run) ?? []), ids = new Set(group.map(entry => entry.run.id));
      // The element the most of this group's runs got stuck on: findings count runs, so restrict them to this group's runs.
      const top = cached.findings.filter(finding => finding.source === 'page' && finding.target)
        .map(finding => ({ finding, runs: new Set(finding.occurrences.filter(occurrence => ids.has(occurrence.runId)).map(occurrence => occurrence.runId)).size }))
        .filter(item => item.runs > 0).sort((a, b) => b.runs - a.runs)[0];
      return {
        profileId: group[0]!.run.profileId, mode: group[0]!.run.mode, runs: group.length,
        reached: group.filter(entry => entry.run.outcome?.status === 'success').length,
        medianSteps: median(counts), minSteps: counts.length ? Math.min(...counts) : null, maxSteps: counts.length ? Math.max(...counts) : null,
        unheard: group.filter(entry => unheard.has(entry.run.id)).length,
        topTarget: top?.finding.target ?? null,
      };
    });
    const facts: TaskFindings['facts'] = {
      runs: done.length, reached: reached.length, medianSteps: median(done.flatMap(entry => steps(entry.run) ?? [])),
      fastest: fastest ? { experimentId: fastest.experimentId, runId: fastest.run.id, steps: steps(fastest.run)! } : null,
      byProfile,
    };
    return { entries, done, facts, findings: cached.findings, steps };
  }
  /** True when the run's last `goal.reached` says the user did not hear it (and no `goal.lost` came after it). */
  private async unheard(experimentId: string, runId: string): Promise<boolean> {
    const known = this.unheardCache.get(runId);
    if (known !== undefined) return known;
    let heard: unknown;
    for (const event of await this.events(experimentId, runId)) {
      if (event.type === 'goal.reached') heard = (event.data as { heard?: unknown } | null)?.heard;
      else if (event.type === 'goal.lost') heard = undefined;
    }
    const result = heard === false;
    this.unheardCache.set(runId, result);
    return result;
  }
  /** Hint findings and facts over one task's finished runs. */
  async findings(taskId: string): Promise<TaskFindings> {
    const { facts, findings } = await this.taskData(taskId);
    return { taskId, facts, findings };
  }
  /** One row per task that has runs, for the task table. */
  async taskSummaries(): Promise<TaskSummary[]> {
    const taskIds = [...new Set(this.queue.experiments.flatMap(experiment => experiment.runs.map(run => run.taskId)))];
    const rows: TaskSummary[] = [];
    for (const taskId of taskIds) {
      const { entries, facts, findings } = await this.taskData(taskId);
      const top = findings.find(finding => finding.source === 'page');
      rows.push({
        taskId, facts, findingCount: findings.filter(finding => finding.source === 'page').length,
        topFinding: top ? { kind: top.kind, ...(top.target ? { target: top.target } : {}), runs: top.runs, totalRuns: top.totalRuns } : null,
        lastRunAt: entries.at(-1)?.at ?? null,
      });
    }
    return rows;
  }
}
