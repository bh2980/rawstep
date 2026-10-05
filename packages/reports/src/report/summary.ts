import type { RunTrace, TraceEvent } from "@rawstep/core/trace";
import { summarizeTraceEvidence, type EvidenceModality } from "../analyze/index.js";

export interface ReportCounts {
  events: number;
  redactedEvents: number;
  readableSpeechEvents: number;
  redactedSpeechEvents: number;
  readableSimulationOutputEvents: number;
  redactedSimulationOutputEvents: number;
  keyboardScreenshots: number;
  withheldKeyboardScreenshots: number;
  diagnosticScreenshots: number;
  withheldDiagnosticScreenshots: number;
  readableVerifierEvidence: number;
  redactedVerifierEvidence: number;
}
export interface ReportAction {
  step?: number;
  action: unknown;
  status: "succeeded" | "failed" | "not-recorded";
  error?: string;
  decisionEventId?: string;
  resultEventId?: string;
  verificationEventIds: string[];
}
export interface ReportFailure {
  eventId?: string;
  type: string;
  message: string;
  stage?: string;
  step?: number;
}
export interface ReportVerificationRule {
  ruleIndex: number;
  ruleType: string;
  passed?: boolean;
  failure?: string;
  evidenceEventIds: string[];
}
export interface ReportVerification {
  eventId: string;
  step?: number;
  passed?: boolean;
  failures: string[];
  rules: ReportVerificationRule[];
}
export interface ReportSummary {
  modality: EvidenceModality | "mixed" | "unknown";
  modalities: EvidenceModality[];
  counts: ReportCounts;
  actions: ReportAction[];
  firstFailure: ReportFailure | null;
  verification: ReportVerification[];
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stepOf(data: Record<string, unknown>): number | undefined {
  return typeof data.step === "number" ? data.step : undefined;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
export function pngFor(data: unknown): string | undefined {
  const png = record(record(data).screenshot).pngBase64;
  return typeof png === "string" && /^[A-Za-z0-9+/=]+$/.test(png) &&
    Buffer.from(png, "base64").subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? png : undefined;
}

function firstFailure(trace: RunTrace): ReportFailure | null {
  // Checking after each action is expected to return false until the goal is met.
  // Only the final unmet check of an unsuccessful run belongs in this summary.
  const finalVerification = trace.outcome && ["failure", "inconclusive"].includes(trace.outcome.status) &&
    (trace.outcome.reason === undefined || ["verification-failed", "policy-stuck", "maxSteps"].includes(trace.outcome.reason))
    ? [...trace.events].reverse().find(event => event.type === "verifier.result") : undefined;
  for (const event of trace.events) {
    const data = record(event.data);
    const failed = (event.type === "action.result" && data.ok === false) ||
      (event === finalVerification && data.passed === false) ||
      ["run.error", "run.aborted", "backend.error", "policy.rejected", "browser.navigation-blocked"].includes(event.type);
    if (!failed) continue;
    const failure = strings(data.failures)[0];
    const message = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : failure ??
      (event.type === "run.aborted" ? `Run cancelled${typeof data.signal === "string" ? ` by ${data.signal}` : ""}.` :
        typeof data.reason === "string" ? data.reason : "Failure recorded; inspect the linked event.");
    return { eventId: event.id, type: event.type, message, ...(typeof data.stage === "string" ? { stage: data.stage } : {}),
      ...(stepOf(data) !== undefined ? { step: stepOf(data) } : {}) };
  }
  const outcome = trace.outcome;
  if (!outcome || outcome.status === "success") return null;
  return { type: "run.outcome", message: typeof outcome.error === "string" ? outcome.error : outcome.reason ?? "Run did not complete successfully.",
    ...(typeof outcome.stage === "string" ? { stage: outcome.stage } : {}), ...(typeof outcome.step === "number" ? { step: outcome.step } : {}) };
}

/** Read-only projections of saved evidence, with no inferred success or speech causality. */
export function summarizeTrace(trace: RunTrace): ReportSummary {
  const evidence = summarizeTraceEvidence(trace);
  const counts: ReportCounts = { events: trace.events.length, redactedEvents: evidence.redactedEvents.length,
    readableSpeechEvents: evidence.readableSpeechEvents.length, redactedSpeechEvents: evidence.redactedSpeechEvents.length,
    readableSimulationOutputEvents: evidence.readableSimulationOutputEvents.length, redactedSimulationOutputEvents: evidence.redactedSimulationOutputEvents.length,
    keyboardScreenshots: evidence.readableScreenshotEvents.length, withheldKeyboardScreenshots: evidence.redactedScreenshotEvents.length,
    diagnosticScreenshots: evidence.diagnosticScreenshotEvents.length, withheldDiagnosticScreenshots: evidence.redactedDiagnosticScreenshotEvents.length,
    readableVerifierEvidence: evidence.readableVerifierEvidenceEvents.length, redactedVerifierEvidence: evidence.redactedVerifierEvidenceEvents.length };
  const eventIds = new Set(trace.events.map(event => event.id));
  const actions: ReportAction[] = [];
  const verification: ReportVerification[] = [];
  for (const event of trace.events) {
    const data = record(event.data);
    if (event.type === "policy.decision" && record(data.decision).action) {
      actions.push({ step: stepOf(data), action: record(data.decision).action, status: "not-recorded", decisionEventId: event.id, verificationEventIds: [] });
    }
    if (event.type === "action.result") {
      const action: ReportAction = [...actions].reverse().find(item => item.step === stepOf(data) && !item.resultEventId) ??
        { step: stepOf(data), action: data.action, status: "not-recorded" as const, verificationEventIds: [] };
      if (!actions.includes(action)) actions.push(action);
      action.status = data.ok === true ? "succeeded" : data.ok === false ? "failed" : "not-recorded";
      action.resultEventId = event.id;
      if (typeof data.error === "string") action.error = data.error;
    }
    if (event.type === "verifier.result") {
      verification.push({ eventId: event.id, step: stepOf(data), passed: typeof data.passed === "boolean" ? data.passed : undefined,
        failures: strings(data.failures), rules: Array.isArray(data.rules) ? data.rules.map((rule, index) => {
          const item = record(rule);
          return { ruleIndex: typeof item.ruleIndex === "number" ? item.ruleIndex : index, ruleType: typeof item.ruleType === "string" ? item.ruleType : "unspecified",
            passed: typeof item.passed === "boolean" ? item.passed : undefined,
            ...(typeof item.failure === "string" ? { failure: item.failure } : {}),
            evidenceEventIds: strings(item.evidenceEventIds).filter(id => eventIds.has(id)) };
        }) : [] });
    }
  }
  for (const action of actions) {
    action.verificationEventIds = verification.filter(result => action.step !== undefined && result.step === action.step).map(result => result.eventId);
  }
  return { modality: evidence.modality, modalities: evidence.modalities,
    counts, actions, firstFailure: firstFailure(trace), verification };
}

export function actionLabel(action: unknown): string {
  const data = record(action);
  if (data.kind === "key" && typeof data.key === "string") return `Key: ${data.key}`;
  if (data.kind === "intent" && typeof data.intent === "string") return `Intent: ${data.intent}`;
  if (["typeText", "replaceText"].includes(String(data.kind)) && typeof data.input === "string") return `${data.kind}: input ${data.input}`;
  return action === undefined ? "Action not recorded" : JSON.stringify(action);
}

export function eventGrounds(event: TraceEvent): unknown {
  const { step: _step, ruleIndex: _index, ruleType: _type, passed: _passed, failure: _failure, ...grounds } = record(event.data);
  return grounds;
}
