/**
 * Dashboard API contract between the local Node service and the web UI.
 * Type-only imports keep this file free of Node code so the browser bundle can use it.
 */
import type { VerifyRule } from '@rawstep/core/contracts';
import type { PlanDocument, PlanPhase, PlanTask } from '@rawstep/policies/policy';
import type { Hint, HintFinding, HintReport, HintTarget } from '@rawstep/reports/hints';
import type { RunEnding, UnmeasuredBy } from '@rawstep/reports/endings';
import type { BatchOwner } from '@rawstep/project/experiment';

export type { Hint, HintFinding, HintReport, PlanDocument, PlanPhase, PlanTask };

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

/** A planner event: a new plan and why it was asked for, a task Rawstep finished, or the run stopping after too many plans. */
export type PlanEvent = { kind: 'plan'; reason: string; outline: string[]; steps: string[] } | { kind: 'step-done'; goal: string } | { kind: 'limit'; reason: string };
/** One planner call inside a runner step, in the order it was made: which plan version it wrote and why (`trigger`). Calls recorded after text entry keep only their structure. */
export type ModelCall = { modelId?: string; elapsedMs?: number; trigger?: string; version?: number };
/** One version of a run's plan: when it was made (before which runner step), why, and the planner's own account of the change. */
export type PlanVersionView = {
  version: number; step: number; trigger: string; rationale: string;
  added: string[]; abandoned: string[]; broken: string[]; met: string[];
};
/**
 * The plan document of an orchestrated run, rebuilt from policy evidence so it is live while the run records. `document` is the
 * newest version with task statuses and action counts brought up to date; `documents` holds each version as it stood while it was
 * current. `stepTasks` links each action step to the task and plan version it served; `calls` lists every planner call per step.
 */
export type RunPlanView = {
  document: PlanDocument;
  documents: Record<number, PlanDocument>;
  versions: PlanVersionView[];
  stepTasks: Record<number, { taskId: string; planVersion: number }>;
  calls: Record<number, ModelCall[]>;
  /** Evidence after text entry keeps only structure: plan wording and speech are gone from those versions. */
  redacted: boolean;
};
export type StepView = {
  /** 0 is the initial page before any action. */
  step: number;
  at?: string;
  action?: { kind: string; key?: string; intent?: string; input?: string };
  stop?: { stop: string; source?: string };
  /** Whether the backend accepted the action; undefined for the initial page and stops. */
  ok?: boolean;
  /** What the screen showed after this step, served by GET .../png/:eventId: the run's diagnostic screenshot, kept for people and never sent to the model. */
  screenshot?: { eventId: string };
  /** Where the screen reader cursor was in the screenshot, in its viewport's CSS pixels (simulated screen readers only). */
  cursor?: { rect: { x: number; y: number; width: number; height: number }; viewport: { w: number; h: number } };
  /** Screen-reader speech collected after this step (simulated or native, see provenance). */
  speech?: { lines: string[]; provenance: 'native' | 'simulation' | 'unspecified' };
  /** How Rawstep took this step from the plan: the choice it made among the actions the page allowed, in the order it saw them. */
  follow?: { choiceId: string; candidates?: { id: string; label?: string }[] };
  /** What the plan did during this step: a new plan, a finished task, the replanning limit. */
  plan?: { events: PlanEvent[] };
  /** Every planner call of this step in order (a step can ask the planner several times); absent when none. */
  calls?: ModelCall[];
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
  /** The planner has been asked for a plan (since this time, for this reason) and has not answered yet. */
  plannerWaiting?: { since: string; trigger?: string };
  explanation?: RunExplanation;
  /** Goal rules that already held before the first action (from verifier.baseline). */
  baseline?: { passed: boolean; rules: { ruleIndex: number; ruleType: string; passed: boolean }[] };
  /** The run is still recording; more steps will arrive. */
  live: boolean;
  /** Every hint of the run with its details; `StepView.hints` only has the kinds. Run-level hints have no steps. */
  hints: Hint[];
  /** Runs with a planner: the plan document, its versions and which task each action served. */
  plan?: RunPlanView;
};

/** Hints for one run, compared against the shortest goal-reaching run of the same task, if any. */
export type RunHintsView = HintReport & { referenceRun?: { experimentId: string; runId: string } };

/** One batch of runs (an experiment) that ran a task. */
export type TaskBatch = { experimentId: string; createdAt: string; note?: string; /** Where the batch was started from, when its owner recorded it (the command line shows as "CLI" in lists). */ via?: BatchOwner['via']; runs: number; finished: number };

/**
 * Facts and recurring hint findings of one task over the finished runs of one batch. Batches are never counted together: the page
 * may have changed between them.
 */
export type TaskFindings = {
  taskId: string;
  /** The batch these figures are about; absent when the task never ran. */
  batch?: string;
  /** Every batch that ran the task, newest first. */
  batches: TaskBatch[];
  facts: {
    /** Finished runs of the task. */
    runs: number;
    /** Finished runs that reached the goal. */
    reached: number;
    /** Median action count over finished runs that have one; null when none do. */
    medianSteps: number | null;
    /** The goal-reaching run with the fewest actions. */
    fastest: { experimentId: string; runId: string; steps: number } | null;
    /** The same figures for each run profile the task ran with, so results of different users are never mixed. */
    byProfile: ProfileFacts[];
  };
  /** Hints grouped by kind and page element across the runs whose hints.json could be read; run-level hints are left out. */
  findings: HintFinding[];
  /** Every finished run, oldest first: how it ended and what it cost. */
  results: RunResult[];
  /** Page objects where the simulated user's expectations broke, the most runs first. */
  stuck: StuckPlace[];
  /** The whole start page of the newest run that recorded one, to place `stuck` on. */
  startPage?: { experimentId: string; runId: string; eventId: string; width: number; height: number };
};

/** How one run profile did on a task. */
export type ProfileFacts = {
  profileId: string;
  runs: number; reached: number;
  /** How the runs ended, and which limit ended the unmeasured ones. */
  endings: Record<RunEnding, number>; unmeasuredBy: Partial<Record<UnmeasuredBy, number>>;
  /** Moves of the runs that reached the goal: what reaching it cost. */
  medianSteps: number | null; minSteps: number | null; maxSteps: number | null;
  /** Runs that reached the goal while nothing the user heard said so (`goal.reached` with `heard: false`). */
  unheard: number;
  /** The longest run of moves without a goal word that still meant something, and the run it was in. */
  longestStretch: { moves: number; runId: string } | null;
  /** Median, over the runs, of the user's guesses about where something is that turned out wrong; null without runs. */
  wrongGuesses: number | null;
  /** The page element the most runs of this profile got stuck on, if any. */
  topTarget: { role: string; name?: string } | null;
  /** What the newest run of the profile ran with (combination and screen reader environment names). */
  conditions: { combo?: string; at?: string };
  /** Runs of the profile whose conditions differ from its newest run's (the profile was changed between runs). */
  differing: number;
};

/** One finished run of a task: how it ended and what it cost. */
export type RunResult = {
  experimentId: string; runId: string; profileId: string;
  ending: RunEnding; by?: UnmeasuredBy;
  steps: number | null;
  /** The user's give-up: why, at which step, and the broken expectations it rests on with where each broke. */
  giveUp?: { reason: string; step?: number; tried: { id: string; text?: string; step?: number; target?: HintTarget }[] };
  /** The longest run of moves without a goal word that still meant something. */
  stretch: number | null;
  /** The user's guesses about where something is that turned out wrong (expectations broken while moving, not after a press). */
  wrongGuesses: number;
  /** Reached the goal while nothing the user heard said so. */
  unheard: boolean;
  /** The `stuck` places (by index) this run's expectations broke at, with the step. */
  stuck: { place: number; step: number }[];
  /** Ran with other conditions than the newest run of its profile. */
  differs: boolean;
};

/**
 * One run picked for a side-by-side comparison, which may come from any task or batch. `result` is how it ended and what it cost; it
 * is null while the run is still going and for a run that never got going (the browser or model could not start), neither of which is
 * evidence about the page. `stuck` lists the page elements its simulated user's expectations broke at, with the step.
 */
export type ComparedRun = {
  experimentId: string; runId: string; taskId: string; profileId: string;
  result: RunResult | null;
  stuck: { target: HintTarget; step: number }[];
};
/** The runs asked for, in the order asked. */
export type RunComparison = { runs: ComparedRun[] };

/** One page object that did not respond as the simulated user expected when they pressed it, across a task's runs. */
export type StuckPlace = {
  target: HintTarget;
  /** Runs whose expectations broke here, out of the task's finished runs. */
  runs: number; totalRuns: number;
  byProfile: { profileId: string; runs: number }[];
  /** Runs that gave up naming an expectation that broke here. */
  gaveUpOn: number;
  /** The expectations that broke, as the planner worded them, the most frequent first. */
  assumptions: string[];
  /** Its box on the start page (`TaskFindings.startPage`) in CSS pixels, when it broke on that page. */
  location?: { x: number; y: number; width: number; height: number };
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
/** `cli-missing` / `cli-signed-out`: a coding-agent CLI connection whose program is not installed, or that needs the person to sign in first. */
export type CheckKind = 'ready' | 'missing-key' | 'invalid-address' | 'unreachable' | 'rejected' | 'model-not-listed' | 'unverified' | 'failed' | 'cli-missing' | 'cli-signed-out';
export type ModelCheck = { ok: boolean; kind: CheckKind; /** What was asked: the model list, or a coding-agent CLI started over ACP. */ via: 'model-list' | 'agent' | 'none'; checkedAt: string };
/** One browser launch on request: the engine, its version and where it came from. */
export type BrowserCheck = { ok: true; name: string; version: string; source: 'custom' | 'auto' | 'connected' } | { ok: false; kind: 'not-found' | 'launch-failed' | 'connect-not-listening' | 'connect-refused' | 'connect-not-devtools'; source: 'custom' | 'auto' | 'connected' };

/** The files of the project, for picking a path: project-relative with forward slashes, and the project folder they are relative to. */
export type ProjectFiles = { root: string; files: string[]; truncated: boolean };
