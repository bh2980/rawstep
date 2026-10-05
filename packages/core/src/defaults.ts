/** Single source for runtime defaults shared by the runner, policies, CLI and dashboard. Isomorphic: no Node imports. */
export const RAWSTEP_DEFAULTS = Object.freeze({
  task: Object.freeze({ maxSteps: 40, timeoutMs: 120_000 }),
  viewport: Object.freeze({ width: 1280, height: 800 }),
  /** Quiet period after network idle before the next observation. */
  settleMs: 120,
  /** Bounded resource cleanup; native screen-reader bridges get longer to release OS state. */
  cleanupTimeoutMs: Object.freeze({ default: 2_000, nativeBackend: 5_000 }),
  /** Per-request budget for decision, stop-reason and analysis model calls. */
  modelTimeoutMs: 60_000,
  /** Decision-policy limits; screenshot policies use all three, speech policies use historyLimit. */
  policy: Object.freeze({ maxStateVisits: 5, maxUnchangedTransitions: 4, historyLimit: 12 }),
  focusGate: Object.freeze({ minimumProbability: 0.75, minimumMargin: 0.25 }),
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
