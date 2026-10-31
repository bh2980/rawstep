/** Single source for runtime defaults shared by the runner, policies, CLI and dashboard. Isomorphic: no Node imports. */
export const RAWSTEP_DEFAULTS = Object.freeze({
  task: Object.freeze({ maxSteps: 40, timeoutMs: 120_000 }),
  viewport: Object.freeze({ width: 1280, height: 800 }),
  /** Quiet period after network idle before the next observation. */
  settleMs: 120,
  /** Bounded resource cleanup; native screen-reader bridges get longer to release OS state. */
  cleanupTimeoutMs: Object.freeze({ default: 2_000, nativeBackend: 5_000 }),
  /** Per-request budget for planner and analysis model calls. */
  modelTimeoutMs: 60_000,
  /** The same action producing the same speech this many times in a row stops the run (the repetition guard). */
  policy: Object.freeze({ maxUnchangedTransitions: 4 }),
  /**
   * Planner runs: planner calls a run may make (a cost limit), moves between the planner's looks at the effort spent, actions on one
   * task without hearing anything new before a new plan, and past actions the planner remembers.
   */
  orchestration: Object.freeze({ maxPlannerCalls: 40, reviewEvery: 60, stepActionLimit: 12, plannerHistoryLimit: 60 }),
});

/** Hostnames treated as this machine. `URL#hostname` keeps IPv6 brackets; bare `::1` is accepted too. */
export const LOOPBACK_HOSTNAMES: readonly string[] = Object.freeze(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.includes(hostname);
}

/** False for unparsable input, so callers fail closed. */
export function isLoopbackUrl(url: string | URL): boolean {
  try { return isLoopbackHostname((typeof url === 'string' ? new URL(url) : url).hostname); }
  catch { return false; }
}
