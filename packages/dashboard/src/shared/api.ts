/**
 * Dashboard API contract between the local Node service and the web UI.
 * Type-only imports keep this file free of Node code so the browser bundle can use it.
 */
import type { VerifyRule } from '@rawstep/core/contracts';
import type { Hint, HintReport } from '@rawstep/reports/hints';

export type { Hint, HintReport };

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
};

/** Hints for one run, compared against the shortest goal-reaching run of the same task and mode, if any. */
export type RunHintsView = HintReport & { referenceRun?: { experimentId: string; runId: string } };

/** One task × model cell of the overview. */
export type OverviewRow = {
  taskId: string;
  taskName: string;
  modelId: string;
  modelName: string;
  mode: 'keyboard' | 'screenreader';
  runs: number;
  finished: number;
  goalReached: number;
  /** Median steps over finished runs. */
  medianSteps: number | null;
  /** Steps of the shortest goal-reaching run (the reference). */
  referenceSteps: number | null;
  /** Most frequent hint kinds across finished runs. */
  topHints: { kind: Hint['kind']; count: number }[];
};

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
