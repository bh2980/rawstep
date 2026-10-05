/**
 * Shared error type. `code` is stable for callers to branch on; messages are for people and may change.
 * `outcome` tells the runner how to record a run that this error ends, instead of a generic error.
 */
export type RawstepErrorCode =
  | 'unsupported-pattern' | 'access-blocked' | 'unsupported-profile' | 'browser-setup'
  | 'backend-precondition' | 'analysis-cancelled' | 'analysis-timeout' | 'analysis-failed'
  | 'llm-cancelled' | 'llm-timeout' | 'llm-failed';
export type RawstepOutcomeHint = { status: 'inconclusive' | 'failure'; reason: 'unsupported-pattern' | 'access-blocked' | 'unsupported-profile' };

export class RawstepError extends Error {
  readonly code: RawstepErrorCode;
  readonly outcome?: RawstepOutcomeHint;
  constructor(code: RawstepErrorCode, message: string, options: { cause?: unknown; outcome?: RawstepOutcomeHint } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RawstepError';
    this.code = code;
    if (options.outcome) this.outcome = options.outcome;
  }
}

/** First RawstepError in the cause chain (bounded), optionally matching a predicate. */
export function findRawstepError(error: unknown, predicate: (error: RawstepError) => boolean = () => true): RawstepError | undefined {
  for (let current = error, depth = 0; current && depth < 8; current = (current as { cause?: unknown }).cause, depth++) {
    if (current instanceof RawstepError && predicate(current)) return current;
  }
  return undefined;
}
