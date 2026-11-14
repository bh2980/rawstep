import type { SurfaceFacts, BackendSession, BackendMetadata, Observation, PolicyAction, Task, VerificationRecord } from '../contracts/index.js';
import type { AppendEventOptions, TraceEnvironment, TraceEvent, TraceEventType } from '../trace/index.js';

/**
 * What the runner knows when it checks a goal: the last press and what was heard after it. A surface adds what it observed itself
 * (a browser's page changes).
 */
export type SurfaceVerificationContext = {
  latestActivation?: { step: number; action: PolicyAction; observation: Observation };
};

/**
 * What the runner lends a surface: the trace, the run's clock and the backend. Everything a surface does goes through these, so a
 * cancel, the time budget and input privacy apply to it as they do to the runner.
 */
export type SurfaceContext = {
  readonly outDir: string;
  readonly signal: AbortSignal;
  append(type: TraceEventType, data: unknown, options?: AppendEventOptions): TraceEvent;
  updateEnvironment(fields: Partial<TraceEnvironment>, options?: Pick<AppendEventOptions, 'redacted'>): void;
  /**
   * True while what the surface records may hold a secret being typed (see the runner's input taint). Words a surface records
   * then are withheld; structure (an event's kind, a count) may stay.
   */
  tainted(): boolean;
  /** Runs work against the task's time budget, and rejects when the run is cancelled or the budget runs out. */
  withinBudget<T>(work: () => Promise<T> | T): Promise<T>;
  /** A look the run can do without: on failure it resolves to `fallback`, unless the failure ends the run. */
  bestEffort<T, F>(work: () => Promise<T> | T, fallback: F): Promise<T | F>;
  /** Runs work whose time does not count against the budget (a person passing a check); a cancel still stops it. */
  offClock<T>(work: () => Promise<T> | T): Promise<T>;
  readonly backend: {
    /** Hands the opened session to the backend (`Backend.attachSession`). */
    attach(session: BackendSession): Promise<void>;
    /** What the backend said about itself when it started (`BackendMetadata.environment`). */
    readonly environment: BackendMetadata['environment'];
    /** The backend presses real operating-system keys (a native screen reader): they land wherever the system focus is. */
    readonly native: boolean;
  };
};

/**
 * Where a run takes place: a web page in a browser, or an app on a device. The runner owns the loop (the policy, budgets, input
 * privacy, the goal and its grace); the surface owns opening the place, waiting for it to settle after an action, checking the goal
 * there and the records only that place has. A policy never sees any of it.
 */
export interface Surface {
  /** The session handed to the backend. */
  readonly session: BackendSession;
  /**
   * Called once after opening and before the first observation: anything the surface must settle first (a person passing a human
   * check, focus in the page, the environment profile) and its metadata records.
   */
  prepare(): Promise<void>;
  /** Called before each observation; throws to end the run when the environment it promised no longer holds. */
  inspect?(step: number): Promise<void>;
  /** Changes when a new document or screen loads; the backend's `enterPage` runs once for each. Undefined when it cannot tell. */
  documentId(): Promise<string | number | undefined>;
  /** The title a screen reader announces when the document loads; undefined when there is none. */
  title(): Promise<string | undefined>;
  /** Whether keyboard focus is in an editable field, the gate for text entry. */
  focusIsEditable(): Promise<boolean>;
  /** Called just before the backend carries out an action. */
  beforeAction(step: number, action: PolicyAction): void;
  /** Called after it: wait until what the action started has settled. `executed` is false when the action failed. */
  afterAction(step: number, executed: boolean): Promise<void>;
  /** Writes what the surface saw since the last call into the trace. `final` at the end of the run. */
  flush(options?: { final?: boolean }): void;
  /** Checks the task's goal here. */
  verify(context: SurfaceVerificationContext): Promise<VerificationRecord>;
  /** Which goal rules hold before any action, recorded for hints. Absent when checking has side effects (a custom verifier). */
  baseline?(): Promise<VerificationRecord>;
  /** All text showing now, to tell whether a typed secret is on screen before a screenshot. */
  visibleText?(): Promise<string | undefined>;
  /**
   * Saves a PNG of what shows now at `path`, for people reading the run, never for the policy. `maskFields` hides form fields once
   * a secret was typed. The runner records it as `surface.screenshot`.
   */
  screenshot?(path: string, options: { maskFields: boolean }): Promise<void>;
  /**
   * Saves a PNG of the whole start (a browser's full page, not only what fits the window) at `path`, to show where runs got stuck.
   * Resolves to the picture's size and anything that places it (a page's `url`), which the runner records as
   * `surface.start-screenshot`; undefined when there is nothing to take.
   */
  startScreenshot?(path: string): Promise<({ width: number; height: number } & Record<string, unknown>) | undefined>;
  close(): Promise<void>;
}

/** Opens a surface for one run. The facts are what a backend's preflight is told before anything opens. */
export type SurfaceOpener = {
  readonly facts: SurfaceFacts;
  /** Opens the place. A surface that opens after the run was stopped closes itself. */
  open(task: Task, context: SurfaceContext): Promise<Surface>;
  /** Records the surface's own evidence of a failure that ended the run, opened or not (blocked navigations, an access block). */
  recordFailure?(error: unknown, context: SurfaceContext): void;
};
