import type { TraceEvent } from '@rawstep/core/trace';
import type { PlanTrigger } from '@rawstep/policies/policy';
import type { Hint, ModelCall, ObservedChange, PlanDocument, PlanTask, PlanVersionView, RunNotice, RunPlanView, RunStepsView, StepView } from '../shared/api.js';

const REDACTED = '[REDACTED]';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** A plain string that is not the redaction marker; redacted values are never surfaced. */
const text = (value: unknown) => typeof value === 'string' && value !== REDACTED ? value : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** A focus box of four finite numbers with a size; anything else the trace holds is not shown. */
const box = (value: unknown): ObservedChange['rect'] =>
  record(value) && finite(value.x) && finite(value.y) && finite(value.width) && finite(value.height) && value.width > 0 && value.height > 0
    ? { x: Math.round(value.x), y: Math.round(value.y), width: Math.round(value.width), height: Math.round(value.height) } : undefined;
const rules = (value: unknown) => Array.isArray(value) ? value.filter(record).map(r => ({ ruleIndex: Number(r.ruleIndex), ruleType: String(r.ruleType), passed: r.passed === true })) : [];

/** The screen reader cursor's box in a step's screenshot, when the observation recorded one. */
function cursorOf(value: unknown): StepView['cursor'] {
  if (!record(value) || !record(value.rect) || !record(value.viewport)) return undefined;
  const { x, y, width, height } = value.rect, { width: w, height: h } = value.viewport;
  return [x, y, width, height, w, h].every(n => typeof n === 'number' && Number.isFinite(n)) ? { rect: { x: x as number, y: y as number, width: width as number, height: height as number }, viewport: { w: w as number, h: h as number } } : undefined;
}
/** Where the runner writes a run's diagnostic screenshots, relative to the run directory. */
export const DIAGNOSTIC_PATH = /^diagnostics\/(step-\d{1,5}|start-page)\.png$/;
/** Hosts and markers of bot checks a run cannot get past; Rawstep never tries to. */
const BOT_CHECK = /(^|\.)(challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net)$|^www\.google\.com$/;
const hostOf = (url: unknown) => { try { return typeof url === 'string' ? new URL(url).hostname : undefined; } catch { return undefined; } };
const isBotCheck = (url: unknown) => {
  const host = hostOf(url);
  return !!host && (BOT_CHECK.test(host) && (host !== 'www.google.com' || String(url).includes('/recaptcha')) || String(url).includes('__cf_chl'));
};
/** Bot checks and blocked navigations, one notice per kind with every host it involved. */
function noticesOf(events: readonly TraceEvent[]): RunNotice[] {
  const found = new Map<RunNotice['kind'], RunNotice>(); let step = 0;
  const note = (kind: 'bot-check' | 'navigation-blocked', url: unknown) => {
    const host = hostOf(url) ?? '?', notice = found.get(kind) ?? { kind, step, hosts: [], count: 0 };
    notice.count++; if (!notice.hosts.includes(host)) notice.hosts.push(host);
    found.set(kind, notice);
  };
  for (const event of events) {
    const data = record(event.data) ? event.data : {};
    if (event.type === 'policy.decision' && typeof data.step === 'number') step = data.step;
    if (event.type === 'browser.navigation-blocked') note(isBotCheck(data.url) ? 'bot-check' : 'navigation-blocked', data.url);
    else if (event.type === 'observer.navigation' && isBotCheck(data.url)) note('bot-check', data.url);
    else if (event.type === 'run.person-check-left' || event.type === 'run.person-check-rejected') {
      const kind = event.type === 'run.person-check-left' ? 'person-check-left' : 'person-check-rejected';
      found.set(kind, { kind, step: typeof data.step === 'number' ? data.step : step, hosts: typeof data.host === 'string' ? [data.host] : [], count: 1 });
    }
    else if (event.type === 'run.person-resumed' && typeof data.waitedMs === 'number') {
      const notice = found.get('person-check') as Extract<RunNotice, { kind: 'person-check' }> | undefined;
      if (notice) { notice.waitedMs += data.waitedMs; notice.count++; } else found.set('person-check', { kind: 'person-check', step: typeof data.step === 'number' ? data.step : step, waitedMs: data.waitedMs, hosts: [], count: 1 });
    }
  }
  return [...found.values()];
}

/** The step each event belongs to, the same way the steps view folds them: its own step, otherwise the decision before it. */
export function eventSteps(events: readonly TraceEvent[]): Map<string, number> {
  const steps = new Map<string, number>(); let current = 0;
  for (const event of events) {
    const data = record(event.data) ? event.data : {}, own = typeof data.step === 'number' ? data.step : undefined;
    if (event.type === 'policy.decision' && own !== undefined) current = own;
    steps.set(event.id, own ?? current);
  }
  return steps;
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter((s): s is string => s !== undefined) : [];
const int = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) ? value : undefined;
const TASK_STATUSES = new Set<PlanTask['status']>(['pending', 'active', 'done', 'abandoned', 'failed']);
const taskStatus = (value: unknown): PlanTask['status'] | undefined => TASK_STATUSES.has(value as PlanTask['status']) ? value as PlanTask['status'] : undefined;
function ending(value: unknown): PlanTask['ending'] | undefined {
  if (!record(value) || !['done', 'replaced', 'limit'].includes(String(value.reason)) || int(value.step) === undefined) return undefined;
  const verified = ['heard', 'recognized', 'not-heard', 'unchecked'].includes(String(value.verified)) ? value.verified as NonNullable<PlanTask['ending']>['verified'] : undefined;
  return { reason: value.reason as NonNullable<PlanTask['ending']>['reason'], step: int(value.step)!, ...(verified ? { verified } : {}) };
}
function planTask(value: unknown): PlanTask | undefined {
  if (!record(value) || !text(value.id)) return undefined;
  const end = ending(value.ending);
  return { id: text(value.id)!, number: text(value.number) ?? '', goal: text(value.goal) ?? '', done: text(value.done) ?? '', cue: text(value.cue) ?? '', ...(text(value.cueRole) ? { cueRole: text(value.cueRole) as PlanTask['cueRole'] } : {}), ...(text(value.cueState) ? { cueState: text(value.cueState) as PlanTask['cueState'] } : {}), serves: strings(value.serves), relies: strings(value.relies),
    status: taskStatus(value.status) ?? 'pending', actions: int(value.actions) ?? 0, addedIn: int(value.addedIn) ?? 1, ...(end ? { ending: end } : {}) };
}
/** A plan document as the trace holds it, keeping only well-formed parts; redacted wording reads as empty. */
function planDocument(value: unknown): PlanDocument | undefined {
  if (!record(value) || int(value.version) === undefined || !Array.isArray(value.phases)) return undefined;
  const list = (v: unknown) => Array.isArray(v) ? v.filter(record) : [];
  const status = <T extends string>(v: unknown, allowed: readonly T[]): T => allowed.includes(v as T) ? v as T : allowed[0]!;
  return {
    goal: text(value.goal) ?? '', version: int(value.version)!, complete: value.complete === true, strategy: text(value.strategy) ?? '',
    criteria: list(value.criteria).filter(c => text(c.id)).map(c => ({ id: text(c.id)!, text: text(c.text) ?? '', status: status(c.status, ['open', 'met', 'unmet'] as const), addedIn: int(c.addedIn) ?? 1 })),
    assumptions: list(value.assumptions).filter(a => text(a.id)).map(a => ({ id: text(a.id)!, text: text(a.text) ?? '', status: status(a.status, ['open', 'held', 'broken'] as const), addedIn: int(a.addedIn) ?? 1,
      ...(int(a.settledIn) !== undefined ? { settledIn: int(a.settledIn)! } : {}) })),
    phases: list(value.phases).map((p, i) => ({ id: text(p.id) ?? `p${i + 1}`, number: text(p.number) ?? String(i + 1), title: text(p.title) ?? '', criteria: strings(p.criteria),
      tasks: list(p.tasks).flatMap(t => planTask(t) ?? []),
      ...(record(p.checkpoint) && int(p.checkpoint.version) !== undefined ? { checkpoint: { version: int(p.checkpoint.version)!, step: int(p.checkpoint.step) ?? 0 } } : {}) })),
    retired: list(value.retired).flatMap(t => { const task = planTask(t); return task ? [{ ...task, phase: text(t.phase) ?? '' }] : []; }),
    ...(text(value.current) ? { current: text(value.current)! } : {}),
    revisions: [],
  };
}
function revisionOf(value: unknown): PlanVersionView | undefined {
  if (!record(value) || int(value.version) === undefined) return undefined;
  return { version: int(value.version)!, step: int(value.step) ?? 0, trigger: text(value.trigger) ?? 'start', rationale: text(value.rationale) ?? '',
    added: strings(value.added), abandoned: strings(value.abandoned), broken: strings(value.broken), met: strings(value.met) };
}
const allTasks = (doc: PlanDocument): PlanTask[] => [...doc.phases.flatMap(p => p.tasks), ...doc.retired];
/** One planner call from an orchestration-plan record (full evidence or the structure kept after text entry). */
function callOf(e: Record<string, unknown>): ModelCall | undefined {
  if (e.kind !== 'orchestration-plan') return undefined;
  const modelId = record(e.model) ? text(e.model.id) : undefined;
  const elapsed = typeof e.elapsedMs === 'number' ? e.elapsedMs : undefined;
  return { ...(modelId ? { modelId } : {}), ...(elapsed !== undefined ? { elapsedMs: elapsed } : {}), ...(text(e.trigger) ? { trigger: text(e.trigger)! } : {}), ...(int(e.version) !== undefined ? { version: int(e.version)! } : {}) };
}
/**
 * The plan document of an orchestrated run from its policy evidence: each `orchestration-plan` brings a whole version, task events
 * move statuses in between, and follow records link each action step to its task. After text entry the evidence keeps only its
 * structure (`summary`), so those versions keep the last wording and only statuses, versions and links move on. Action counts are
 * recounted from the steps, so a live run shows them as they grow.
 */
export function buildPlan(events: readonly TraceEvent[]): RunPlanView | undefined {
  const documents = new Map<number, PlanDocument>(), versions = new Map<number, PlanVersionView>();
  const stepTasks: RunPlanView['stepTasks'] = {}, calls: RunPlanView['calls'] = {};
  let latest: PlanDocument | undefined, redacted = false, any = false;
  const adopt = (doc: PlanDocument) => { latest = doc; documents.set(doc.version, structuredClone(doc)); };
  for (const event of events) {
    if (event.type !== 'policy.evidence') continue;
    const data = record(event.data) ? event.data : {}, step = int(data.step) ?? 0;
    const full = record(data.evidence), e = full ? data.evidence as Record<string, unknown> : record(data.summary) ? data.summary : undefined;
    if (!e) continue;
    if (!full) redacted = true;
    const call = callOf(e);
    if (call) (calls[step] ??= []).push(call);
    if (e.kind === 'orchestration-plan') {
      any = true;
      const doc = full ? planDocument(e.document) : undefined, version = int(e.version) ?? doc?.version;
      const revision = full ? revisionOf(e.revision) : undefined;
      if (version !== undefined) versions.set(version, revision ?? { version, step, trigger: text(e.trigger) ?? 'start', rationale: '', added: [], abandoned: [], broken: [], met: [] });
      if (doc && record(e.document)) for (const r of Array.isArray(e.document.revisions) ? e.document.revisions : []) { const old = revisionOf(r); if (old && !versions.has(old.version)) versions.set(old.version, old); }
      if (doc) adopt(doc);
      else if (latest && version !== undefined) adopt({ ...structuredClone(latest), version });
    } else if (e.kind === 'orchestration-task' && text(e.taskId)) {
      any = true;
      const to = taskStatus(e.toStatus), end = ending(e.ending);
      for (const doc of [latest, latest && documents.get(latest.version)]) {
        const task = doc && allTasks(doc).find(t => t.id === text(e.taskId));
        if (!doc || !task || !to) continue;
        task.status = to;
        if (end) task.ending = end;
        if (to === 'active') doc.current = task.id; else if (doc.current === task.id) delete doc.current;
      }
    } else if (e.kind === 'orchestration-limit') {
      any = true;
      const doc = full ? planDocument(e.document) : undefined;
      if (doc) adopt(doc);
    } else if (e.kind === 'orchestration-follow' && text(e.taskId) && int(e.planVersion) !== undefined) {
      stepTasks[step] = { taskId: text(e.taskId)!, planVersion: int(e.planVersion)! };
    }
  }
  if (!any || !latest) return undefined;
  // Actions per task, counted from the steps that served it up to each version; a step that only stopped the run served nothing.
  const actionSteps = new Set(events.filter(event => event.type === 'policy.decision' && record(event.data) && record(event.data.decision) && 'action' in event.data.decision).map(event => int((event.data as Record<string, unknown>).step)));
  const recount = (doc: PlanDocument) => {
    for (const task of allTasks(doc)) {
      const counted = Object.entries(stepTasks).filter(([step, served]) => served.taskId === task.id && served.planVersion <= doc.version && actionSteps.has(Number(step))).length;
      task.actions = Math.max(task.actions, counted);
    }
    doc.revisions = [...versions.values()].filter(v => v.version <= doc.version).sort((a, b) => a.version - b.version).map(v => ({ ...v, trigger: v.trigger as PlanTrigger }));
  };
  for (const doc of documents.values()) recount(doc);
  recount(latest);
  return { document: latest, documents: Object.fromEntries(documents), versions: [...versions.values()].sort((a, b) => a.version - b.version), stepTasks, calls, redacted };
}

export type StepsInput ={ experimentId: string; runId: string; events: readonly TraceEvent[]; hints?: readonly Pick<Hint, 'kind' | 'steps'>[]; live: boolean };

/** Folds recorded trace events into one view per policy step. Step 0 is the initial page; steps are keyed by policy.decision.step. */
export function buildSteps({ experimentId, runId, events, hints = [], live }: StepsInput): Omit<RunStepsView, 'hints'> {
  const byStep = new Map<number, StepView>();
  const step = (n: number, at?: string): StepView => {
    let view = byStep.get(n);
    if (!view) byStep.set(n, view = { step: n, ...(at ? { at } : {}), observed: [], hints: [], redacted: false });
    return view;
  };
  let current = 0, baseline: RunStepsView['baseline'];
  if (events.length) step(0, events[0]!.timestamp);
  for (const event of events) {
    const data = record(event.data) ? event.data : {};
    const own = typeof data.step === 'number' ? data.step : undefined;
    // Observations carry no step number; they belong to the decision that precedes them.
    const target = event.type === 'policy.decision' && own !== undefined ? step(current = own, event.timestamp) : step(own ?? current, event.timestamp);
    if (event.redacted) target.redacted = true;
    if (event.type === 'policy.decision') {
      target.at = event.timestamp;
      const decision = record(data.decision) ? data.decision : {};
      if (record(decision.action)) {
        const a = decision.action, kind = text(a.kind);
        if (kind) target.action = { kind, ...(text(a.key) ? { key: text(a.key)! } : {}), ...(text(a.intent) ? { intent: text(a.intent)! } : {}), ...(text(a.input) ? { input: text(a.input)! } : {}) };
      } else if (text(decision.stop)) target.stop = { stop: text(decision.stop)!, ...(text(decision.stopSource) ? { source: text(decision.stopSource)! } : {}) };
    } else if (event.type === 'action.result') {
      target.ok = data.ok === true;
    } else if (event.type === 'browser.screenshot' && !event.redacted && text(data.path) && DIAGNOSTIC_PATH.test(text(data.path)!)) {
      if (!target.screenshot) target.screenshot = { eventId: event.id };
    } else if (event.type === 'screen-reader.observation' || event.type === 'simulation.observation') {
      const lines = Array.isArray(data.speech) ? data.speech.map(text).filter((l): l is string => !!l) : [];
      if (lines.length) {
        const provenance = data.provenance === 'native' || data.provenance === 'simulation' ? data.provenance : event.type === 'simulation.observation' ? 'simulation' : 'unspecified';
        target.speech = { lines: [...(target.speech?.lines ?? []), ...lines], provenance };
      }
      const cursor = cursorOf(data.cursor);
      if (cursor) target.cursor = cursor;
    } else if (event.type === 'policy.evidence') {
      const e = record(data.evidence) ? data.evidence : {};
      const call = callOf(record(data.evidence) ? data.evidence : record(data.summary) ? data.summary : {});
      if (call) (target.calls ??= []).push(call);
      const plan = () => target.plan ??= { events: [] };
      if (e.kind === 'orchestration-plan' && record(e.document)) {
        const doc = e.document, phases = Array.isArray(doc.phases) ? doc.phases.filter(record) : [];
        const tasks = phases.flatMap(p => Array.isArray(p.tasks) ? p.tasks.filter(record) : []);
        plan().events.push({ kind: 'plan', reason: text(e.trigger) ?? 'start', outline: text(doc.strategy) ? [text(doc.strategy)!] : [],
          steps: tasks.map(t => [text(t.number), text(t.goal)].filter(Boolean).join(' ')).filter(Boolean) });
      } else if (e.kind === 'orchestration-task' && e.toStatus === 'done' && text(e.taskId)) plan().events.push({ kind: 'step-done', goal: text(e.taskId)! });
      else if (e.kind === 'orchestration-limit') plan().events.push({ kind: 'limit', reason: text(e.reason) ?? 'plan-finished' });
      if (e.kind === 'orchestration-follow' && text(e.choiceId)) {
        const candidates = Array.isArray(e.choices) ? e.choices.filter(record).filter(c => text(c.id)).map(c => ({ id: text(c.id)!, ...(text(c.label) ? { label: text(c.label)! } : {}) })) : undefined;
        target.follow = { choiceId: text(e.choiceId)!, ...(candidates?.length ? { candidates } : {}) };
      }
    } else if (event.type === 'verifier.result') {
      if (typeof data.passed === 'boolean') target.verification = { passed: data.passed, rules: rules(data.rules) };
    } else if (event.type === 'verifier.baseline') {
      if (typeof data.passed === 'boolean' && Array.isArray(data.rules)) baseline = { passed: data.passed, rules: rules(data.rules) };
    } else if (event.type.startsWith('observer.') && text(data.kind)) {
      const change: ObservedChange = { kind: text(data.kind)! };
      if (typeof data.role === 'string' || data.role === null) change.role = data.role;
      for (const key of ['name', 'text', 'attr', 'url'] as const) if (text(data[key])) change[key] = text(data[key])!;
      if (data.value === null || text(data.value) !== undefined) change.value = data.value as string | null;
      // A redacted step is shown without its screenshot, so its geometry is not offered either.
      if (data.kind === 'focus' && !event.redacted && box(data.rect)) change.rect = box(data.rect)!;
      target.observed.push(change);
    }
  }
  for (const hint of hints) for (const n of hint.steps) {
    const view = byStep.get(n);
    if (view && !view.hints.includes(hint.kind)) view.hints.push(hint.kind);
  }
  const waits = events.filter(event => event.type === 'run.waiting-for-person' || event.type === 'run.person-resumed' || event.type === 'run.person-check-timeout');
  const waitingForPerson = live && waits.at(-1)?.type === 'run.waiting-for-person';
  return { experimentId, runId, steps: [...byStep.values()].sort((a, b) => a.step - b.step), notices: noticesOf(events), ...(waitingForPerson ? { waitingForPerson } : {}), ...(baseline ? { baseline } : {}), live };
}
