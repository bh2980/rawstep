import { createHash } from 'node:crypto';
import { matchesText, resolveTask } from '@rawstep/core/contracts';
import type { Decision, DecisionPolicy, ScreenshotObservation, Task, VerifyRule } from '@rawstep/core/contracts';
import { SCREENSHOT_KEYS } from '@rawstep/core/screenshot';
import { screenshotSha256 as storedSha256, validateTrace, type RunTrace } from '@rawstep/core/trace';
import { screenshotHash } from './policy.js';

export type ScreenshotReplay = {
  schema: 'rawstep-screenshot-replay-v1';
  sourceRunId: string;
  taskSha256: string;
  goalSha256: string;
  steps: { screenshotSha256: string; viewport: { w: number; h: number }; key: string; inferenceEventId: string }[];
  verificationEventId: string;
  limitations: string;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stable = (v: unknown): string => JSON.stringify(v, (_, value: unknown) => record(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
/** Hash the effective task contract, including independent verification and navigation restrictions. */
export function screenshotReplayTaskHash(source: Task): string {
  const task = resolveTask(source);
  return createHash('sha256').update(stable({ mode: task.mode ?? 'keyboard', url: task.url, goal: task.goal, verify: task.verify, navigation: task.navigation ?? { strategy: 'same-origin' }, profile: task.profile ?? null })).digest('hex');
}
export function validateScreenshotReplay(value: unknown): asserts value is ScreenshotReplay {
  if (!record(value) || value.schema !== 'rawstep-screenshot-replay-v1' || typeof value.sourceRunId !== 'string' || !value.sourceRunId || typeof value.verificationEventId !== 'string' || !value.verificationEventId || typeof value.goalSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.goalSha256) || typeof value.taskSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.taskSha256) || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 10_000) throw new Error('Invalid screenshot replay manifest.');
  for (const step of value.steps) if (!record(step) || typeof step.screenshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(step.screenshotSha256) || !record(step.viewport) || !Number.isSafeInteger(step.viewport.w) || Number(step.viewport.w) < 1 || !Number.isSafeInteger(step.viewport.h) || Number(step.viewport.h) < 1 || typeof step.key !== 'string' || !(SCREENSHOT_KEYS as readonly string[]).includes(step.key) || typeof step.inferenceEventId !== 'string' || !step.inferenceEventId) throw new Error('Invalid screenshot replay step.');
}
/** Remote regression replay must retain the request-level read-only guard. */
export function assertScreenshotReplayTaskSafety(task: Task): void {
  const resolved = resolveTask(task);
  const url = new URL(resolved.url);
  if (!['file:', 'http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported screenshot replay URL.');
  if (url.protocol !== 'file:' && resolved.navigation?.readOnly !== true) throw new Error('HTTP(S) screenshot replay requires explicit navigation.readOnly: true.');
}
function witnessMatches(witness: unknown, rule: VerifyRule): boolean {
  if (!record(witness)) return false;
  if ('titleIncludes' in rule) return witness.kind === 'title' && typeof witness.title === 'string' && witness.title.includes(rule.titleIncludes);
  if ('urlIncludes' in rule) return witness.kind === 'url' && typeof witness.url === 'string' && witness.url.includes(rule.urlIncludes);
  if ('textVisible' in rule || 'textVisibleExact' in rule) {
    const normalize = (value: string) => value.replace(/[\u200b\u00ad]/g, '').trim().replace(/\s+/g, ' ');
    return witness.kind === 'visible-text' && witness.visible === true && typeof witness.text === 'string' && ('textVisibleExact' in rule ? normalize(witness.text) === normalize(rule.textVisibleExact) : normalize(witness.text).toLowerCase().includes(normalize(rule.textVisible).toLowerCase()));
  }
  if ('domEventSeen' in rule) return witness.kind === 'dom-event' && witness.selector === rule.domEventSeen.selector && witness.event === rule.domEventSeen.event;
  if ('requestSeen' in rule || 'responseSeen' in rule) {
    const r = 'requestSeen' in rule ? rule.requestSeen : rule.responseSeen;
    return witness.kind === ('requestSeen' in rule ? 'request' : 'response') && typeof witness.url === 'string' && witness.url.includes(r.urlIncludes) && typeof witness.method === 'string' && !!witness.method && (!r.method || witness.method.toUpperCase() === r.method.toUpperCase()) && (!('status' in r) || r.status === undefined || witness.status === r.status);
  }
  if ('event' in rule) {
    const event = record(witness.event) ? witness.event : undefined, expected = rule.event;
    return witness.kind === 'observer-event' && !!event && event.kind === expected.kind && (expected.role === undefined || event.role === expected.role) && (expected.attr === undefined || event.attr === expected.attr) && (expected.value === undefined || event.value === expected.value)
      && (expected.name === undefined || matchesText(expected.name, event.name as string)) && (expected.text === undefined || matchesText(expected.text, event.text as string)) && (expected.url === undefined || matchesText(expected.url, event.url as string));
  }
  // Native/simulated announcement witnesses, and focused/not/any rules, do not make a keyboard screenshot replay.

  return false;
}
/** Only independently witnessed, successful, keyboard-only model paths are eligible. */
export function exportScreenshotReplay(trace: RunTrace, task: Task): ScreenshotReplay {
  validateTrace(trace); assertScreenshotReplayTaskSafety(task);
  if (trace.outcome?.status !== 'success' || trace.outcome.reason !== 'verified' || trace.task.mode !== 'keyboard' || trace.events.some(e => e.redacted || e.type === 'privacy.input-taint')) throw new Error('Replay export requires an unredacted independently verified keyboard run.');
  const hasNamedInputs = (value: unknown) => value !== undefined && (!record(value) || Object.keys(value).length > 0);
  if (Object.keys(task.input ?? {}).length || hasNamedInputs(trace.task.input) || hasNamedInputs(trace.task.inputs)) throw new Error('Replay export excludes named inputs and their values.');
  if (screenshotReplayTaskHash(trace.task as unknown as Task) !== screenshotReplayTaskHash(task)) throw new Error('Task contract does not match the successful source run.');
  const steps: ScreenshotReplay['steps'] = [];
  let observation: Record<string, unknown> | undefined, observationSeq = 0, lastExecutionSeq = 0, lastDecisionSeq = 0;
  for (const event of trace.events) {
    if (event.type === 'keyboard.observation' && event.source === 'runner' && record(event.data)) { observation = event.data; observationSeq = event.seq; }
    if (event.type !== 'policy.decision') continue;
    if (event.source !== 'policy' || !record(event.data) || !record(event.data.decision)) throw new Error('Malformed replay policy decision.');
    lastDecisionSeq = event.seq;
    const decision = event.data.decision;
    if (!('action' in decision)) continue;
    const a = decision.action;
    if (!record(a) || a.kind !== 'key' || typeof a.key !== 'string' || !(SCREENSHOT_KEYS as readonly string[]).includes(a.key) || !record(observation?.screenshot) || observationSeq <= lastExecutionSeq) throw new Error('Replay export requires fresh saved pixels and keyboard actions only.');
    const stepNumber = event.data.step;
    if (stepNumber !== steps.length + 1) throw new Error('Replay action steps are not consecutive.');
    const executions = trace.events.filter(e => e.type === 'action.result' && record(e.data) && e.data.step === stepNumber);
    const nextDecision = trace.events.find(e => e.type === 'policy.decision' && e.seq > event.seq);
    const execution = executions[0];
    if (executions.length !== 1 || !execution || execution.source !== 'runner' || execution.seq <= event.seq || (nextDecision && execution.seq >= nextDecision.seq) || !record(execution.data) || execution.data.ok !== true || stable(execution.data.action) !== stable({ kind: 'key', key: a.key })) throw new Error('Replay action result must match the ordered successful runner dispatch.');
    const inferences = trace.events.filter(e => e.type === 'policy.evidence' && e.source === 'policy' && e.seq > observationSeq && e.seq < event.seq && record(e.data) && e.data.step === stepNumber && record(e.data.evidence) && e.data.evidence.kind === 'model-inference' && e.data.evidence.choiceId === `key:${a.key}`);
    if (inferences.length !== 1) throw new Error('Replay export requires one matching model inference for each action.');
    const inference = inferences[0]!;
    // Stored observations are blob references that keep the viewport beside the hash.
    const screenshot = observation!.screenshot as { viewport: ScreenshotObservation['viewport'] };
    const screenshotSha256 = storedSha256(screenshot);
    if (!screenshotSha256 || !record(screenshot.viewport) || !Number.isInteger(screenshot.viewport.w) || screenshot.viewport.w < 1 || !Number.isInteger(screenshot.viewport.h) || screenshot.viewport.h < 1) throw new Error('Expected screenshot blob evidence with a viewport.');
    const evidence = (inference.data as { evidence: Record<string, unknown> }).evidence;
    if (!record(evidence.model) || typeof evidence.model.id !== 'string' || !evidence.model.id.trim() || typeof evidence.model.runtime !== 'string' || !evidence.model.runtime.trim()) throw new Error('Replay export requires model identity and runtime.');
    if (evidence.screenshotSha256 !== screenshotSha256) throw new Error('Model inference pixels do not match the replay observation.');
    steps.push({ screenshotSha256, viewport: { ...screenshot.viewport }, key: a.key, inferenceEventId: inference.id });
    lastExecutionSeq = execution.seq;
  }
  const verifications = trace.events.filter(e => e.type === 'verifier.result');
  const verification = verifications.at(-1);
  const data = verification?.data;
  const rules = record(data) ? data.rules : undefined;
  if (!verification || verification.source !== 'verifier' || verification.seq <= Math.max(lastExecutionSeq, lastDecisionSeq) || !record(data) || data.passed !== true || !Array.isArray(data.failures) || data.failures.length || !Array.isArray(rules) || rules.length !== task.verify.all.length || !rules.every((r, i) => {
    const rule = task.verify.all[i]!, type = Object.keys(rule)[0];
    return record(r) && r.ruleIndex === i && r.ruleType === type && r.passed === true && Array.isArray(r.evidenceEventIds) && r.evidenceEventIds.length > 0 && new Set(r.evidenceEventIds).size === r.evidenceEventIds.length && r.evidenceEventIds.every(id => trace.events.some(e => e.id === id && e.seq > lastExecutionSeq && e.seq < verification.seq && e.type === 'verifier.evidence' && e.source === 'verifier' && !e.redacted && record(e.data) && e.data.step === data.step && e.data.ruleIndex === i && e.data.ruleType === type && e.data.passed === true && witnessMatches(e.data.witness, rule)));
  })) throw new Error('Replay export requires final linked independent witnesses matching every goal rule.');
  const result: ScreenshotReplay = { schema: 'rawstep-screenshot-replay-v1', sourceRunId: trace.runId, taskSha256: screenshotReplayTaskHash(task), goalSha256: createHash('sha256').update(task.goal).digest('hex'), steps, verificationEventId: verification.id,
    limitations: 'Exact-pixel keyboard regression replay, not another model run. Visible changes invalidate before dispatch; invisible behavior is not established by pixels. Remote use requires request-level read-only guards, which do not prevent GET side effects or client-only changes. Re-verify goals independently. No native assistive-technology parity is implied.' };
  validateScreenshotReplay(result); return result;
}
/** Fails closed on changed pixels, disallowed keys, prior failures, or a reused/out-of-order policy. */
export class ScreenshotReplayPolicy implements DecisionPolicy {
  private readonly replay: ScreenshotReplay;
  private index = 0;
  private evidence: unknown[] = [];
  constructor(replay: ScreenshotReplay) { validateScreenshotReplay(replay); this.replay = structuredClone(replay); }
  takeDecisionEvidence(): readonly unknown[] { return this.evidence.splice(0); }
  decide(input: Parameters<DecisionPolicy['decide']>[0]): Decision {
    input.signal.throwIfAborted(); this.evidence = [];
    const fail = (reason: string): Decision => { this.evidence.push({ kind: 'replay-invalidated', reason, nextStep: this.index + 1, sourceRunId: this.replay.sourceRunId }); return { stop: 'uncertain', stopSource: 'exploration-guard', rationale: reason }; };
    if (createHash('sha256').update(input.goal).digest('hex') !== this.replay.goalSha256) return fail('Replay goal changed.');
    if (input.observation.kind !== 'keyboard') return fail('Replay requires screenshot observations.');
    if (input.history.length !== this.index || input.history.some((e, i) => e.execution?.ok !== true || !('action' in e.decision) || e.decision.action.kind !== 'key' || e.decision.action.key !== this.replay.steps[i]?.key)) return fail('Replay history differs from the successful path.');
    const step = this.replay.steps[this.index];
    // The runner checks the independent goal after every action; exhaustion never claims success.
    if (!step) return fail('Replay path exhausted; independent goal verification is still required.');
    const image = input.observation.screenshot;
    if (image.viewport.w !== step.viewport.w || image.viewport.h !== step.viewport.h || screenshotHash(image) !== step.screenshotSha256) return fail('Page pixels or viewport changed; recapture and review this scenario.');
    if (!input.allowedActions.keys.includes(step.key)) return fail('Replay key is no longer permitted.');
    this.evidence.push({ kind: 'deterministic-replay', sourceRunId: this.replay.sourceRunId, sourceInferenceEventId: step.inferenceEventId, screenshotSha256: step.screenshotSha256, key: step.key, modelCalled: false });
    this.index++; return { action: { kind: 'key', key: step.key } };
  }
}
