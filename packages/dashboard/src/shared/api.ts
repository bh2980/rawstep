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
  screenshot?: { eventId: string; sha256: string };
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

export type RunStepsView = {
  experimentId: string;
  runId: string;
  steps: StepView[];
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
  /** The last 10 finished runs, oldest first. */
  recent: { experimentId: string; runId: string; steps: number | null; reached: boolean }[];
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
