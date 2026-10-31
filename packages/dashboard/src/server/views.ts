import { aggregateHints, extractHints, HINTS_SCHEMA_VERSION, selectReference, type Hint, type HintFinding, type HintTarget } from '@rawstep/reports/hints';
import { readTrace, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import type { AnalysisReport } from '@rawstep/reports';
import type { HintReport, ProfileFacts, RunExplanation, RunHintsView, RunResult, RunStepsView, StuckPlace, TaskBatch, TaskFindings, TaskSummary } from '../shared/api.js';
import { isStuck, isWrongGuess, runEnding } from '@rawstep/reports/endings';
import type { RunRecord } from '../shared/config.js';
import { readOptional, type ProjectStore } from '@rawstep/project/store';
import { HttpError } from './http.js';
import type { ExperimentQueue } from './queue.js';
import { buildPlan, buildSteps, eventSteps } from './steps.js';

const live = (run: RunRecord) => run.state === 'queued' || run.state === 'running';
const finished = (run: RunRecord) => run.state === 'success' || run.state === 'failure' || run.state === 'inconclusive';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
type RunFacts = { unheard: boolean; startPage?: { eventId: string; width: number; height: number; url: string } };
/** Where a recorded cursor location sat on the start page, in page pixels; undefined when it was on another page. */
function pageBox(location: unknown, startUrl: string): StuckPlace['location'] {
  if (!record(location) || !record(location.rect) || !record(location.scroll) || typeof location.url !== 'string') return undefined;
  const sameDocument = (a: string, b: string) => a.split('#')[0] === b.split('#')[0];
  const { x, y, width, height } = location.rect, { x: sx, y: sy } = location.scroll;
  if (!sameDocument(location.url, startUrl) || ![x, y, width, height, sx, sy].every(n => typeof n === 'number')) return undefined;
  return { x: (x as number) + (sx as number), y: (y as number) + (sy as number), width: width as number, height: height as number };
}
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Read-only projections of saved run files for the dashboard UI. */
export class RunViews {
  /** Findings and hint reports per task, valid while the task's set of finished runs is the one they were computed from. */
  private readonly findingsCache = new Map<string, { key: string; findings: HintFinding[]; reports: Map<string, HintReport> }>();
  private readonly factsCache = new Map<string, RunFacts>();
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
  /** Hints against the shortest goal-reaching finished run of the same task, from any experiment. */
  async hints(experimentId: string, runId: string): Promise<RunHintsView> {
    const run = this.queue.find(experimentId, runId), trace = await this.trace(experimentId, runId);
    if (!trace) throw new HttpError(404, '이 실행의 추적 기록이 아직 없습니다.');
    const candidates = this.queue.experiments.flatMap(e => e.runs.filter(r => r.id !== runId && r.taskId === run.taskId && r.outcome?.status === 'success' && finished(r)).map(r => ({ experimentId: e.id, run: r })))
      .sort((a, b) => (a.run.outcome?.steps ?? Infinity) - (b.run.outcome?.steps ?? Infinity));
    let reference: { experimentId: string; runId: string; trace: RunTrace } | undefined;
    for (const c of candidates) {
      const t = await this.trace(c.experimentId, c.run.id);
      if (t && selectReference([t])) { reference = { experimentId: c.experimentId, runId: c.run.id, trace: t }; break; }
    }
    return { ...extractHints(trace, reference ? { reference: reference.trace } : {}), ...(reference ? { referenceRun: { experimentId: reference.experimentId, runId: reference.runId } } : {}) };
  }
  /** The batches (experiments) that ran a task, newest first. */
  batches(taskId: string): TaskBatch[] {
    return this.queue.experiments.filter(experiment => experiment.runs.some(run => run.taskId === taskId)).map(experiment => {
      const runs = experiment.runs.filter(run => run.taskId === taskId);
      return { experimentId: experiment.id, createdAt: experiment.createdAt, ...(experiment.request.note ? { note: experiment.request.note } : {}), runs: runs.length, finished: runs.filter(finished).length };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** The batch a task's results show when none is asked for: the newest one with a finished run, else the newest. */
  private defaultBatch(taskId: string): string | undefined {
    const batches = this.batches(taskId);
    return (batches.find(batch => batch.finished > 0) ?? batches[0])?.experimentId;
  }
  /** Every run of one task in one batch, oldest first, with the time it started (or, when it has not, its experiment was created). */
  private taskEntries(taskId: string, experimentId: string | undefined) {
    return this.queue.experiments.filter(experiment => experiment.id === experimentId)
      .flatMap(experiment => experiment.runs.filter(run => run.taskId === taskId).map(run => ({ experimentId: experiment.id, run, at: run.startedAt ?? experiment.createdAt })))
      .sort((a, b) => a.at.localeCompare(b.at) || a.run.repeat - b.run.repeat);
  }
  /**
   * The hints of a finished run: its hints.json, or the hints worked out again from its trace when they were saved by an older
   * Rawstep (they would lack kinds added since).
   */
  private async currentHints(experimentId: string, runId: string): Promise<HintReport | undefined> {
    const saved = await this.savedHints(experimentId, runId);
    if (!saved?.schemaVersion || saved.schemaVersion === HINTS_SCHEMA_VERSION) return saved;
    return await this.trace(experimentId, runId).then(t => t && extractHints(t)) ?? saved;
  }
  /** Results of one batch of a task: runs of different batches are never counted together (the page may have changed in between). */
  private async taskData(taskId: string, experimentId: string | undefined) {
    // A run that never got going (the browser or model could not start) is not evidence about the page.
    const entries = this.taskEntries(taskId, experimentId), done = entries.filter(entry => finished(entry.run) && entry.run.outcome?.reason !== 'error');
    const steps = (run: RunRecord) => typeof run.outcome?.steps === 'number' ? run.outcome.steps : undefined;
    const reached = done.filter(entry => entry.run.outcome?.status === 'success');
    const fastest = reached.reduce<typeof reached[number] | undefined>((best, entry) => steps(entry.run) !== undefined && (!best || steps(entry.run)! < steps(best.run)!) ? entry : best, undefined);
    const key = done.map(entry => entry.run.id).join(',');
    const cacheKey = `${taskId}\u0000${experimentId ?? ''}`;
    let cached = this.findingsCache.get(cacheKey);
    if (cached?.key !== key) {
      // hints.json names the trace's run id; findings must point at the dashboard run so links and run numbers resolve.
      const reports = await Promise.all(done.map(async entry => {
        const report = await this.currentHints(entry.experimentId, entry.run.id);
        return report ? { ...report, runId: entry.run.id } : undefined;
      }));
      const readable = reports.filter((report): report is HintReport => !!report);
      cached = { key, findings: aggregateHints(readable), reports: new Map(readable.map(report => [report.runId, report])) };
      // A missing hints.json may still be written; only a complete set is kept.
      if (readable.length === done.length) this.findingsCache.set(cacheKey, cached); else this.findingsCache.delete(cacheKey);
    }
    const reports = cached.reports;
    const facts = new Map<string, RunFacts>();
    for (const entry of done) facts.set(entry.run.id, await this.runFacts(entry.experimentId, entry.run.id));
    const hintsOf = (runId: string, kind: Hint['kind']) => reports.get(runId)?.hints.filter(hint => hint.kind === kind) ?? [];

    // The start page to place stuck objects on: the newest run that recorded one.
    const pageOf = [...done].reverse().find(entry => facts.get(entry.run.id)?.startPage);
    const startPage = pageOf ? { ...facts.get(pageOf.run.id)!.startPage!, experimentId: pageOf.experimentId, runId: pageOf.run.id } : undefined;
    // Stuck places are objects that did not respond as the user expected when pressed; other broken expectations are wrong guesses.
    const costly = isStuck, wrongGuess = isWrongGuess;
    const broken = cached.findings.filter(finding => finding.kind === 'expectation-broken' && finding.target)
      .map(finding => ({ ...finding, occurrences: finding.occurrences.filter(costly) })).filter(finding => finding.occurrences.length > 0);
    const stuck: StuckPlace[] = broken.map(finding => {
      const runIds = new Set(finding.occurrences.map(o => o.runId)), counts = new Map<string, number>(), byProfile = new Map<string, StuckPlace['byProfile'][number]>();
      for (const o of finding.occurrences) { const text = record(o.detail.assumption) && typeof o.detail.assumption.text === 'string' ? o.detail.assumption.text : undefined; if (text) counts.set(text, (counts.get(text) ?? 0) + 1); }
      for (const entry of done.filter(entry => runIds.has(entry.run.id))) {
        const item = byProfile.get(entry.run.profileId) ?? { profileId: entry.run.profileId, runs: 0 };
        item.runs++; byProfile.set(entry.run.profileId, item);
      }
      const location = startPage && finding.occurrences.map(o => pageBox(o.detail.location, startPage.url)).find(Boolean);
      return { target: finding.target!, runs: runIds.size, totalRuns: done.length, byProfile: [...byProfile.values()],
        gaveUpOn: new Set(finding.occurrences.filter(o => o.detail.gaveUpOn === true).map(o => o.runId)).size,
        assumptions: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([text]) => text).slice(0, 3), ...(location ? { location } : {}) };
    }).sort((a, b) => b.runs - a.runs || b.gaveUpOn - a.gaveUpOn);
    const placeOf = (target: HintTarget | undefined) => target ? stuck.findIndex(place => place.target.role === target.role && place.target.name === target.name) : -1;

    // Conditions as the run recorded them, without the profile itself: a profile edited between runs shows as differing runs.
    const conditionsKey = (run: RunRecord) => { const { profile: _profile, ...rest } = (run.snapshot.spec.conditions ?? {}) as Record<string, unknown>; return JSON.stringify(rest); };
    const groups = new Map<string, typeof done>();
    for (const entry of done) groups.set(entry.run.profileId, [...groups.get(entry.run.profileId) ?? [], entry]);
    const newestKey = new Map([...groups].map(([group, list]) => [group, conditionsKey(list.at(-1)!.run)]));
    const results: RunResult[] = done.map(entry => {
      const run = entry.run, early = hintsOf(run.id, 'early-stop')[0];
      const stopSource = run.outcome?.stopSource ?? (typeof early?.detail.stopSource === 'string' ? early.detail.stopSource : undefined);
      const end = runEnding(run.outcome, stopSource)!, give = record(early?.detail.giveUp) ? early.detail.giveUp : undefined;
      const allBreaks = hintsOf(run.id, 'expectation-broken'), breaks = allBreaks.filter(costly), stretch = hintsOf(run.id, 'goal-word-stretch')[0]?.detail.moves;
      const tried = Array.isArray(give?.tried) ? give.tried.filter((id): id is string => typeof id === 'string') : [];
      return {
        experimentId: entry.experimentId, runId: run.id, profileId: run.profileId, ...end, steps: steps(run) ?? null,
        ...(end.ending === 'gave-up' && give ? { giveUp: { reason: String(give.reason ?? ''), ...(typeof run.outcome?.step === 'number' ? { step: run.outcome.step } : {}),
          tried: tried.map(id => { const at = allBreaks.find(hint => record(hint.detail.assumption) && hint.detail.assumption.id === id), text = at && record(at.detail.assumption) ? at.detail.assumption.text : undefined;
            return { id, ...(typeof text === 'string' ? { text } : {}), ...(at?.steps[0] !== undefined ? { step: at.steps[0] } : {}), ...(at?.target ? { target: at.target } : {}) }; }) } } : {}),
        stretch: typeof stretch === 'number' ? stretch : null,
        wrongGuesses: allBreaks.filter(wrongGuess).length,
        unheard: end.ending === 'reached' && facts.get(run.id)!.unheard,
        // Two expectations broken at once on one object are one place passed, not two.
        stuck: [...new Map(breaks.map(hint => ({ place: placeOf(hint.target), step: hint.steps[0] ?? 0 })).filter(item => item.place >= 0).map(item => [`${item.place}:${item.step}`, item])).values()],
        differs: conditionsKey(run) !== newestKey.get(run.profileId),
      };
    });
    const resultOf = new Map(results.map(result => [result.runId, result]));
    const byProfile = [...groups.values()].map(group => {
      const counts = group.filter(entry => entry.run.outcome?.status === 'success').flatMap(entry => steps(entry.run) ?? []), ids = new Set(group.map(entry => entry.run.id));
      // The element the most of this group's runs got stuck on: findings count runs, so restrict them to this group's runs.
      const top = cached.findings.filter(finding => finding.source === 'page' && finding.target)
        .map(finding => ({ finding, runs: new Set(finding.occurrences.filter(occurrence => ids.has(occurrence.runId)).map(occurrence => occurrence.runId)).size }))
        .filter(item => item.runs > 0).sort((a, b) => b.runs - a.runs)[0];
      const own = group.map(entry => resultOf.get(entry.run.id)!), endings: ProfileFacts['endings'] = { reached: 0, 'gave-up': 0, mistaken: 0, unmeasured: 0 }, unmeasuredBy: ProfileFacts['unmeasuredBy'] = {};
      for (const result of own) { endings[result.ending]++; if (result.by) unmeasuredBy[result.by] = (unmeasuredBy[result.by] ?? 0) + 1; }
      const longest = own.filter(result => result.stretch !== null).sort((a, b) => b.stretch! - a.stretch!)[0];
      const newest = (group.at(-1)!.run.snapshot.spec.conditions ?? {}) as { combo?: { name?: unknown }; atEnvironment?: { name?: unknown } };
      return {
        profileId: group[0]!.run.profileId, runs: group.length, reached: endings.reached, endings, unmeasuredBy,
        medianSteps: median(counts), minSteps: counts.length ? Math.min(...counts) : null, maxSteps: counts.length ? Math.max(...counts) : null,
        unheard: own.filter(result => result.unheard).length,
        longestStretch: longest ? { moves: longest.stretch!, runId: longest.runId } : null,
        wrongGuesses: median(own.map(result => result.wrongGuesses)),
        topTarget: top?.finding.target ?? null,
        conditions: { ...(typeof newest.combo?.name === 'string' ? { combo: newest.combo.name } : {}), ...(typeof newest.atEnvironment?.name === 'string' ? { at: newest.atEnvironment.name } : {}) },
        differing: own.filter(result => result.differs).length,
      };
    });
    const taskFacts: TaskFindings['facts'] = {
      runs: done.length, reached: reached.length, medianSteps: median(done.flatMap(entry => steps(entry.run) ?? [])),
      fastest: fastest ? { experimentId: fastest.experimentId, runId: fastest.run.id, steps: steps(fastest.run)! } : null,
      byProfile,
    };
    const page = startPage ? { experimentId: startPage.experimentId, runId: startPage.runId, eventId: startPage.eventId, width: startPage.width, height: startPage.height } : undefined;
    return { entries, done, facts: taskFacts, findings: cached.findings, results, stuck, ...(page ? { startPage: page } : {}), steps };
  }
  /**
   * What a finished run's journal says beyond its hints: whether its last `goal.reached` was unheard (and no `goal.lost` came after
   * it), and the whole start page if it recorded one. A finished run's journal does not change.
   */
  private async runFacts(experimentId: string, runId: string): Promise<RunFacts> {
    const known = this.factsCache.get(runId);
    if (known) return known;
    let heard: unknown, startPage: RunFacts['startPage'];
    for (const event of await this.events(experimentId, runId)) {
      if (event.type === 'goal.reached') heard = (event.data as { heard?: unknown } | null)?.heard;
      else if (event.type === 'goal.lost') heard = undefined;
      else if (event.type === 'browser.start-page' && record(event.data) && typeof event.data.width === 'number' && typeof event.data.height === 'number' && typeof event.data.url === 'string')
        startPage = { eventId: event.id, width: event.data.width, height: event.data.height, url: event.data.url };
    }
    const result = { unheard: heard === false, ...(startPage ? { startPage } : {}) };
    this.factsCache.set(runId, result);
    return result;
  }
  /** Hint findings and facts over the finished runs of one batch of a task (the newest when none is named). */
  async findings(taskId: string, experimentId = this.defaultBatch(taskId)): Promise<TaskFindings> {
    const batches = this.batches(taskId);
    if (experimentId && !batches.some(batch => batch.experimentId === experimentId)) throw new HttpError(404, '이 작업을 실행한 묶음이 아닙니다.');
    const { facts, findings, results, stuck, startPage } = await this.taskData(taskId, experimentId);
    return { taskId, ...(experimentId ? { batch: experimentId } : {}), batches, facts, findings, results, stuck, ...(startPage ? { startPage } : {}) };
  }
  /** One row per task that has runs, for the task table. */
  async taskSummaries(): Promise<TaskSummary[]> {
    const taskIds = [...new Set(this.queue.experiments.flatMap(experiment => experiment.runs.map(run => run.taskId)))];
    const rows: TaskSummary[] = [];
    for (const taskId of taskIds) {
      // The task table shows the newest batch, as the task page does; lastRunAt is the newest run in any batch.
      const { facts, findings } = await this.taskData(taskId, this.defaultBatch(taskId));
      const entries = this.queue.experiments.flatMap(experiment => experiment.runs.filter(run => run.taskId === taskId).map(run => ({ at: run.startedAt ?? experiment.createdAt }))).sort((a, b) => a.at.localeCompare(b.at));
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
