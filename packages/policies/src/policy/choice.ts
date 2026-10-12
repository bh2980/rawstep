/** One candidate a choice model may pick: an opaque ID and the wording the model reads. */
export type ChoiceCandidate = { id: string; label: string };
export type ChoiceRequest = {
  /** Model-facing state only (goal, observation text, history); never DOM, verifier results or input values. */
  state: Record<string, unknown>;
  choices: readonly ChoiceCandidate[];
  /** Base64 PNG pixels, current first. */
  images?: readonly string[];
};
export type ChoiceResult = {
  choiceId: string;
  /** Same order as the request's choices, when the model reports scores. Scores are confidence, not measured accuracy. */
  probabilities?: number[];
  model: { id: string; requestedId?: string; runtime: string; revision?: string };
  prompt?: { id: string; version: string; sha256: string };
};
/**
 * A model that picks one of the supplied candidates: a SystemOne decision model or an LLM. Policies build the state
 * and candidates; the model only chooses, so it cannot invent an action the runner would execute.
 */
export interface ChoiceModel {
  /** What the model can take; a policy checks this when it is built. */
  readonly inputs: readonly ('text' | 'image')[];
  choose(request: ChoiceRequest, options: { signal: AbortSignal }): Promise<ChoiceResult>;
}
