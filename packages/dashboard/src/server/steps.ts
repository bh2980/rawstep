import { screenshotSha256, type TraceEvent } from '@rawstep/core/trace';
import type { Hint, ObservedChange, RunNotice, RunStepsView, StepView } from '../shared/api.js';

const REDACTED = '[REDACTED]';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** A plain string that is not the redaction marker; redacted values are never surfaced. */
const text = (value: unknown) => typeof value === 'string' && value !== REDACTED ? value : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** A focus box of four finite numbers with a size; anything else the trace holds is not shown. */
const box = (value: unknown): ObservedChange['rect'] =>
  record(value) && finite(value.x) && finite(value.y) && finite(value.width) && finite(value.height) && value.width > 0 && value.height > 0
    ? { x: Math.round(value.x), y: Math.round(value.y), width: Math.round(value.width), height: Math.round(value.height) } : undefined;
/** The viewport a screenshot was taken at, in CSS pixels. */
const viewportOf = (screenshot: unknown): { w: number; h: number } | undefined =>
  record(screenshot) && record(screenshot.viewport) && finite(screenshot.viewport.w) && finite(screenshot.viewport.h) && screenshot.viewport.w > 0 && screenshot.viewport.h > 0
    ? { w: screenshot.viewport.w, h: screenshot.viewport.h } : undefined;
const rules = (value: unknown) => Array.isArray(value) ? value.filter(record).map(r => ({ ruleIndex: Number(r.ruleIndex), ruleType: String(r.ruleType), passed: r.passed === true })) : [];

/** Where the runner writes a screen reader run's diagnostic screenshots, relative to the run directory. */
export const DIAGNOSTIC_PATH = /^diagnostics\/step-\d{1,5}\.png$/;
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

export type StepsInput = { experimentId: string; runId: string; events: readonly TraceEvent[]; hints?: readonly Pick<Hint, 'kind' | 'steps'>[]; live: boolean };

/** Folds recorded trace events into one view per policy step. Step 0 is the initial page; steps are keyed by policy.decision.step. */
export function buildSteps({ experimentId, runId, events, hints = [], live }: StepsInput): Omit<RunStepsView, 'modelKind' | 'hints'> {
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
    } else if (event.type === 'keyboard.observation') {
      const sha256 = screenshotSha256(data.screenshot);
      if (sha256 && !target.screenshot) target.screenshot = { eventId: event.id, sha256, ...(viewportOf(data.screenshot) ? { viewport: viewportOf(data.screenshot)! } : {}) };
    } else if (event.type === 'browser.screenshot' && text(data.path) && DIAGNOSTIC_PATH.test(text(data.path)!)) {
      if (!target.screenshot) target.screenshot = { eventId: event.id, reference: true };
    } else if (event.type === 'screen-reader.observation' || event.type === 'simulation.observation') {
      const lines = Array.isArray(data.speech) ? data.speech.map(text).filter((l): l is string => !!l) : [];
      if (lines.length) {
        const provenance = data.provenance === 'native' || data.provenance === 'simulation' ? data.provenance : event.type === 'simulation.observation' ? 'simulation' : 'unspecified';
        target.speech = { lines: [...(target.speech?.lines ?? []), ...lines], provenance };
      }
    } else if (event.type === 'policy.evidence') {
      const e = record(data.evidence) ? data.evidence : {};
      if (e.kind === 'model-inference' && text(e.choiceId)) {
        const probabilities = Array.isArray(e.probabilities) ? e.probabilities : [];
        const candidates = Array.isArray(e.choices) ? e.choices.filter(record).filter(c => text(c.id)).map((c, i) => ({ id: text(c.id)!, ...(text(c.label) ? { label: text(c.label)! } : {}), ...(typeof probabilities[i] === 'number' ? { probability: probabilities[i] as number } : {}) })) : undefined;
        const modelId = record(e.model) ? text(e.model.id) : undefined;
        target.model = { choiceId: text(e.choiceId)!, ...(candidates?.length ? { candidates } : {}), ...(modelId ? { modelId } : {}), ...(typeof e.inferenceMs === 'number' ? { inferenceMs: e.inferenceMs } : {}) };
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
