/** One action a planner may plan with: an opaque ID and the wording it reads. */
export type ChoiceCandidate = { id: string; label: string };

/**
 * Why a model reply was not used: not JSON, the wrong shape (with the schema's complaints), cut off, from another model, echoing the
 * credential, or no reply at all. `reply` is the model's own text, shortened, and left out when it echoed the credential. The
 * provider's error text is never kept: it can carry credentials.
 */
export type ModelFailure = {
  kind: 'not-json' | 'schema' | 'incomplete' | 'model-changed' | 'credential-echoed' | 'no-reply';
  issues?: { path: string; message: string }[];
  reply?: string;
};
