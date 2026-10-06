/**
 * Dashboard API contract between the local Node service and the web UI.
 * Type-only imports keep this file free of Node code so the browser bundle can use it.
 */
import type { VerifyRule } from '@rawstep/core/contracts';
import type { ModelKind } from '@rawstep/project/config';
import type { Hint, HintFinding, HintReport } from '@rawstep/reports/hints';

export type { Hint, HintFinding, HintReport };

/** A trace event reduced to what a person reads in the step timeline. Redacted fields are omitted, never guessed. */
export type ObservedChange = {
  kind: string;
  role?: string | null;
  name?: string;
  text?: string;
  attr?: string;
  value?: string | null;
  url?: string;
  /** Focus changes: the focused element's box in CSS pixels of the viewport (rounded), when the observer recorded one. */
  rect?: { x: number; y: number; width: number; height: number };
};

export type StepView = {
  /** 0 is the initial page before any action. */
  step: number;
  at?: string;
  action?: { kind: string; key?: string; intent?: string; input?: string };
  stop?: { stop: string; source?: string };
  /** Whether the backend accepted the action; undefined for the initial page and stops. */
  ok?: boolean;
  /** Screenshot after this step, served by GET .../png/:eventId. */
  /** What the screen showed. `reference`: a screen reader run's diagnostic screenshot, kept for people and never sent to the model (no hash). */
  screenshot?: { eventId: string; sha256?: string; reference?: true; /** The viewport in CSS pixels when it was taken; the focus box is in these units. */ viewport?: { w: number; h: number } };
  /** Screen-reader speech collected after this step (simulated or native, see provenance). */
  speech?: { lines: string[]; provenance: 'native' | 'simulation' | 'unspecified' };
  model?: {
    choiceId: string;
    /** Candidates in the order the model saw them; probabilities are uncalibrated model scores. */
    candidates?: { id: string; label?: string; probability?: number }[];
    modelId?: string;
    inferenceMs?: number;
  };
  /** Page observer changes recorded during this step. */
  observed: ObservedChange[];
  verification?: { passed: boolean; rules: { ruleIndex: number; ruleType: string; passed: boolean }[] };
  /** Hint kinds that point at this step. */
  hints: Hint['kind'][];
  /** True when privacy redaction removed words or pixels from this step. */
  redacted: boolean;
};

/**
 * Something the page did that explains a run without being a step: a bot check page (Cloudflare and the like) or navigations the
 * task's navigation range blocked. `hosts` are the distinct hosts involved, `count` how often it happened.
 */
export type RunNotice = { kind: 'bot-check' | 'navigation-blocked'; step: number; hosts: string[]; count: number }
  /** A person passed a human check; `waitedMs` is how long, taken out of the run's time budget. */
  | { kind: 'person-check'; step: number; waitedMs: number; hosts: string[]; count: number }
  /** The check sent the page to another site (`hosts`), or showed itself again once Rawstep attached: the site rejects this browser. */
  | { kind: 'person-check-left' | 'person-check-rejected'; step: number; hosts: string[]; count: number };
/**
 * What an LLM wrote about a finished run: a summary and hypotheses, each pointing at the steps of the events it cites. Never a verdict;
 * absent when the run profile has no LLM for this.
 */
export type RunExplanation = {
  status: 'completed' | 'failed';
  summary: string;
  findings: { title: string; description: string; severity: 'info' | 'warning' | 'error'; steps: number[] }[];
};
export type RunStepsView = {
  experimentId: string;
  runId: string;
  steps: StepView[];
  notices: RunNotice[];
  /** The run is paused until a person passes a human check in the browser window. */
  waitingForPerson?: boolean;
  explanation?: RunExplanation;
  /** Goal rules that already held before the first action (from verifier.baseline). */
  baseline?: { passed: boolean; rules: { ruleIndex: number; ruleType: string; passed: boolean }[] };
  /** The run is still recording; more steps will arrive. */
  live: boolean;
  /** Kind of the model that decided the actions. Decision models give calibrated-looking probabilities (uncalibrated scores), LLMs give none. */
  modelKind: ModelKind;
  /** Every hint of the run with its details; `StepView.hints` only has the kinds. Run-level hints have no steps. */
  hints: Hint[];
};

/** Hints for one run, compared against the shortest goal-reaching run of the same task and mode, if any. */
export type RunHintsView = HintReport & { referenceRun?: { experimentId: string; runId: string } };

/** Facts and recurring hint findings of one task over its finished runs (any model, mode and experiment). */
export type TaskFindings = {
  taskId: string;
  facts: {
    /** Finished runs of the task. */
    runs: number;
    /** Finished runs that reached the goal. */
    reached: number;
    /** Median action count over finished runs that have one; null when none do. */
    medianSteps: number | null;
    /** The goal-reaching run with the fewest actions. */
    fastest: { experimentId: string; runId: string; steps: number } | null;
  };
  /** Hints grouped by kind and page element across the runs whose hints.json could be read; run-level hints are left out. */
  findings: HintFinding[];
};

/** One row of the task table: how a task's runs went and what recurs, without the detail of `TaskFindings`. */
export type TaskSummary = {
  taskId: string;
  facts: TaskFindings['facts'];
  /** How many page elements show a recurring finding (source 'page'). */
  findingCount: number;
  /** The most frequent finding about the page itself (source 'page'), if any. */
  topFinding: Pick<HintFinding, 'kind' | 'target' | 'runs' | 'totalRuns'> | null;
  /** Start time of the newest run in any state; null when the task was never run. */
  lastRunAt: string | null;
};

/** A page element a completion check can point at, as the accessibility tree names it. */
export type PageElement = { role: string; name?: string };
export type PageElements = { page: { title: string; url: string }; elements: PageElement[] };

/** Server-sent event on /api/events, `event: run-event`: a trace event was recorded for a running run. */
export type RunEventMessage = { experimentId: string; runId: string; seq: number; type: string };

/** One proposed completion check. Nothing is applied until a person picks it. */
export type CheckSuggestion = {
  title: string;
  why: string;
  rule: VerifyRule;
  /** `true` when the rule already holds on the start page, so it cannot tell a finished task from an unstarted one. */
  trueAtStart?: boolean;
  /** False for rules that are not tried on the start page (event, focus, negated and script rules). */
  checkedAtStart: boolean;
};
export type SuggestionResult = { page: { title: string; url: string }; suggestions: CheckSuggestion[]; dropped: number };

/**
 * Why a connection check did not end in `ready`. The words are the dashboard's own; nothing a provider sent is ever shown.
 * `unverified` is not a failure: the server answered but gave no model list to confirm the model against.
 */
export type CheckKind = 'ready' | 'missing-key' | 'invalid-address' | 'unreachable' | 'rejected' | 'model-not-listed' | 'unverified' | 'timeout' | 'failed';
export type ModelCheck = { ok: boolean; kind: CheckKind; /** What was asked: the model list, the decision catalog, or one minimal decision. */ via: 'model-list' | 'decision-catalog' | 'decision-call' | 'none'; checkedAt: string };
/** One browser launch on request: the engine, its version and where it came from. */
export type BrowserCheck = { ok: true; name: string; version: string; source: 'custom' | 'auto' } | { ok: false; kind: 'not-found' | 'launch-failed'; source: 'custom' | 'auto' };
