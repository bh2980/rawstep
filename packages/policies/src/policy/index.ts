import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Decision, DecisionPolicy } from '@rawstep/core/contracts';
export type { Decision, DecisionPolicy, PolicyAction, AllowedActions } from '@rawstep/core/contracts';

/** Deterministic policy for protocol checks, fixtures, and replaying an action sequence. */
export class ScriptedPolicy implements DecisionPolicy {
  private index = 0;
  constructor(private readonly decisions: readonly Decision[]) {}
  decide(): Decision {
    return structuredClone(this.decisions[this.index++] ?? { stop: 'stuck', rationale: 'Script exhausted.' });
  }
}
/** Loading a policy executes trusted local JavaScript; no provider is selected by RawStep. */
export async function loadPolicy(modulePath: string, options: { fresh?: boolean } = {}): Promise<DecisionPolicy> {
  const url = pathToFileURL(resolve(modulePath));
  if (options.fresh) url.searchParams.set("rawstep-instance", crypto.randomUUID());
  const mod = await import(url.href);
  const policy = mod.default ?? mod.policy;
  if (!policy || typeof policy.decide !== 'function') throw new Error('Policy module must export a default or named policy object with decide(input).');
  return policy;
}
export type { ChoiceCandidate, ChoiceModel, ChoiceRequest, ChoiceResult } from './choice.js';
export { actionOnly, modelHistory } from './history.js';
export type { ModelHistoryEntry } from './history.js';
export { SpeechDecisionPolicy, currentItem, currentItemState, speechChoices, speechGuardStop, speechRepetition } from './speech.js';
export type { SpeechGuard, SpeechPolicyOptions } from './speech.js';
export { ACTION_ONLY_EXECUTOR_GUIDE, ORCHESTRATED_EXECUTOR_GUIDE, OrchestratedSpeechPolicy, confidenceOf, followPlan, orchestratedPrompt } from './orchestration.js';
export { FixedPlanner, planDraftSchema, planFileSchema } from './fixed-plan.js';
export type { CueRequest, CueResult, OrchestrationOptions, PlanRequest, PlanResult, Planner, TaskAttempt } from './orchestration.js';
export { activateNext, applyDraft, currentTask, failCurrent, finishCurrent, markCheckpoint, needsCheckpoint, phaseOf, planOutline, planTasks, renderPlanMarkdown, cueText, matchCue, verifyCue, type CueRole, type CueState, type DraftCue } from './plan-document.js';
export type { Assumption, AssumptionStatus, Criterion, CriterionStatus, HelpReason, PlanDocument, PlanDraft, PlanPhase, PlanRevision, PlanTask, PlanTrigger, TaskEnding, TaskStatus } from './plan-document.js';
