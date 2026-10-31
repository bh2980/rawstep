import type { Decision, ExecutionFailure, HistoryEntry, Observation } from '@rawstep/core/contracts';

/**
 * One past step as a decision model sees it: what it chose, whether the runner could carry it out, and whether
 * anything it can observe changed afterwards. Without the result a model cannot tell "typed into the field" from
 * "tried to type with nothing focused" and repeats the failed action.
 */
export type ModelHistoryEntry = {
  step: number;
  /** The action or stop only: rationale and stop source are runner bookkeeping, not model input. */
  decision: Decision;
  /** What the screen reader said before this decision. */
  speech?: string[];
  /** Whether the runner executed the action, and Rawstep's reason when it could not. The raw error text is never sent: it can carry page content. */
  execution?: { ok: boolean; failure?: ExecutionFailure };
  /** Whether the speech after this decision differs from the speech it was made on. */
  changed?: boolean;
};

export function actionOnly(decision: Decision): Decision {
  if ('stop' in decision) return { stop: decision.stop };
  const a = decision.action;
  return { action: a.kind === 'key' ? { kind: a.kind, key: a.key } : a.kind === 'intent' ? { kind: a.kind, intent: a.intent } : { kind: a.kind, input: a.input } };
}
/** Speech text: equal keys mean the model could not observe any difference. */
const observed = (o: Observation): string => o.speech.join('\n');

/** The last `limit` steps with their results, built from the runner's history and the observation the newest step produced. */
export function modelHistory(history: readonly HistoryEntry[], current: Observation, limit: number): ModelHistoryEntry[] {
  return history.map((entry, i): ModelHistoryEntry => {
    const after = history[i + 1]?.observation ?? current;
    return {
      step: entry.step, decision: actionOnly(entry.decision),
      speech: [...entry.observation.speech],
      ...(entry.execution ? { execution: entry.execution.ok ? { ok: true } : { ok: false, failure: entry.execution.failure ?? 'backend' } } : {}),
      ...('action' in entry.decision ? { changed: observed(after) !== observed(entry.observation) } : {}),
    };
  }).slice(-limit);
}
