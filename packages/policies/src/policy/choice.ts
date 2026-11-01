/** One action a planner may plan with: an opaque ID and the wording it reads. */
export type ChoiceCandidate = { id: string; label: string };

/**
 * Why a model call gave nothing usable. A reply that came back: not JSON, the wrong shape (with the schema's complaints), cut off, from
 * another model, or echoing the credential. No usable reply: the provider refused the key, does not know the model, kept rate limiting,
 * failed on its side, could not be reached, or (`no-reply`) anything else; an agent CLI that would not start or answer is `agent-failed`.
 * `reply` is the model's own text, shortened, and left out when it echoed the credential. The provider's error text is never kept: it can
 * carry credentials.
 */
export type ModelFailure = {
  kind: 'not-json' | 'schema' | 'incomplete' | 'model-changed' | 'credential-echoed' | 'no-reply'
    | 'key-refused' | 'model-not-found' | 'rate-limited' | 'provider-error' | 'unreachable' | 'agent-failed';
  /** The provider's HTTP status, when it answered with one. */
  status?: number;
  issues?: { path: string; message: string }[];
  reply?: string;
};
