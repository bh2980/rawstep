/**
 * Shared error type. `code` is stable for callers to branch on; messages are for people and may change.
 * `outcome` tells the runner how to record a run that this error ends, instead of a generic error.
 */
export type RawstepErrorCode =
  | 'unsupported-pattern' | 'access-blocked' | 'unsupported-profile' | 'browser-setup'
  | 'backend-precondition' | 'analysis-cancelled' | 'analysis-timeout' | 'analysis-failed'
  | 'llm-cancelled' | 'llm-timeout' | 'llm-failed'
  | 'decision-cancelled' | 'decision-timeout' | 'decision-failed';
export type RawstepOutcomeHint = { status: 'inconclusive' | 'failure'; reason: 'unsupported-pattern' | 'access-blocked' | 'unsupported-profile' };

const BRAND = Symbol.for('rawstep.RawstepError');

export class RawstepError extends Error {
  /** Set by subclasses to the same string they assign to `name`; `instanceof` then matches it across copies. */
  static readonly errorName: string = 'RawstepError';
  readonly code: RawstepErrorCode;
  readonly outcome?: RawstepOutcomeHint;
  constructor(code: RawstepErrorCode, message: string, options: { cause?: unknown; outcome?: RawstepOutcomeHint } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RawstepError';
    this.code = code;
    if (options.outcome) this.outcome = options.outcome;
    Object.defineProperty(this, BRAND, { value: true });
  }
  /**
   * More than one copy of these classes can be loaded (the bundled `rawstep` next to a workspace or another
   * install), so `instanceof` checks a global brand and the error name rather than the prototype chain.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (!value || typeof value !== 'object' || (value as Record<symbol, unknown>)[BRAND] !== true) return false;
    return this === RawstepError || (value as Error).name === (this as typeof RawstepError).errorName;
  }
}

/** First RawstepError in the cause chain (bounded), optionally matching a predicate. */
export function findRawstepError(error: unknown, predicate: (error: RawstepError) => boolean = () => true): RawstepError | undefined {
  for (let current = error, depth = 0; current && depth < 8; current = (current as { cause?: unknown }).cause, depth++) {
    if (current instanceof RawstepError && predicate(current)) return current;
  }
  return undefined;
}
