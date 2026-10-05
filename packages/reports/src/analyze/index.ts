import { summarizeVisualExploration } from "../screenshot/analysis.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readTrace, traceFilePath, validateTrace, writeJsonAtomic, type RunOutcome, type RunTrace, type TraceEvent } from "@rawstep/core/trace";
import { findRawstepError } from "@rawstep/core/errors";

export const ANALYSIS_SCHEMA_VERSION = "1.0" as const;
export interface AnalysisFinding {
  id: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "error";
  /** IDs in the saved trace, not model-generated quotations or selector guesses. */
  evidenceEventIds: string[];
}
export interface AnalyzerResult { summary: string; findings: AnalysisFinding[] }
export interface TraceAnalyzer {
  id: string;
  analyze(trace: Readonly<RunTrace>): AnalyzerResult | Promise<AnalyzerResult>;
}
export interface AnalysisReport extends AnalyzerResult {
  schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
  traceSchemaVersion: RunTrace["schemaVersion"];
  runId: string;
  analyzer: { id: string };
  analyzedAt: string;
  status: "completed" | "failed";
  /** A copy of recorded execution outcome, never an analyzer's judgment. */
  runOutcome?: RunOutcome;
  error?: string;
  /** Why analysis failed, without raw analyzer text: callers can tell cancellation from failure. */
  failure?: AnalysisFailure;
}
export type AnalysisFailure = "cancelled" | "timeout" | "invalid-result" | "analyzer-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

export function validateAnalyzerResult(value: unknown, trace: RunTrace): asserts value is AnalyzerResult {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.findings)) {
    throw new Error("Analyzer must return a summary and findings array.");
  }
  const eventIds = new Set(trace.events.map((event) => event.id));
  const findingIds = new Set<string>();
  for (const finding of value.findings) {
    if (!isRecord(finding) || typeof finding.id !== "string" || !finding.id || findingIds.has(finding.id) ||
        typeof finding.title !== "string" || !finding.title || typeof finding.description !== "string" ||
        !["info", "warning", "error"].includes(String(finding.severity)) || !Array.isArray(finding.evidenceEventIds) ||
        finding.evidenceEventIds.length === 0 || !finding.evidenceEventIds.every((id) => typeof id === "string" && eventIds.has(id))) {
      throw new Error("Analyzer finding is invalid or references missing trace evidence.");
    }
    findingIds.add(finding.id);
  }
}

export function validateAnalysisReport(value: unknown, trace: RunTrace): asserts value is AnalysisReport {
  if (!isRecord(value) || value.schemaVersion !== ANALYSIS_SCHEMA_VERSION || value.runId !== trace.runId ||
      value.traceSchemaVersion !== trace.schemaVersion || !["completed", "failed"].includes(String(value.status)) ||
      !isRecord(value.analyzer) || typeof value.analyzer.id !== "string" || !value.analyzer.id ||
      typeof value.analyzedAt !== "string" || !Number.isFinite(Date.parse(value.analyzedAt)) ||
      (value.error !== undefined && typeof value.error !== "string") ||
      (value.failure !== undefined && !["cancelled", "timeout", "invalid-result", "analyzer-error"].includes(String(value.failure)))) {
    throw new Error("Analysis does not belong to this trace or uses an invalid schema.");
  }
  if (!isDeepStrictEqual(value.runOutcome, trace.outcome)) {
    throw new Error("Analysis cannot change the recorded run outcome.");
  }
  validateAnalyzerResult(value, trace);
}

export async function readAnalysis(path: string, trace: RunTrace): Promise<AnalysisReport> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  validateAnalysisReport(value, trace);
  return value;
}

function dataOf(event: TraceEvent): Record<string, unknown> { return isRecord(event.data) ? event.data : {}; }

export type EvidenceModality = 'screenreader' | 'simulation' | 'keyboard';
export interface TraceEvidenceSummary {
  modality: EvidenceModality | 'mixed' | 'unknown';
  modalities: EvidenceModality[];
  /** Native screen-reader output only; simulation is inventoried separately. */
  readableSpeechEvents: TraceEvent[];
  redactedSpeechEvents: TraceEvent[];
  readableSimulationOutputEvents: TraceEvent[];
  redactedSimulationOutputEvents: TraceEvent[];
  /** Current screenshots only: previousScreenshot repeats an earlier observation. */
  readableScreenshotEvents: TraceEvent[];
  redactedScreenshotEvents: TraceEvent[];
  readableVerifierEvidenceEvents: TraceEvent[];
  redactedVerifierEvidenceEvents: TraceEvent[];
  /** Trace references only; file availability is not established by analysis. */
  diagnosticScreenshotEvents: TraceEvent[];
  redactedDiagnosticScreenshotEvents: TraceEvent[];
  redactedEvents: TraceEvent[];
}

/** Evidence inventory shared by deterministic analysis and reports, without interpreting page content. */
export function summarizeTraceEvidence(trace: Readonly<RunTrace>): TraceEvidenceSummary {
  const outputEvents = trace.events.filter((event) => event.source === 'screen-reader' &&
    ['screen-reader.output', 'backend.output'].includes(event.type));
  const simulationOutputs = trace.events.filter((event) => event.source === 'simulation' &&
    ['simulation.output', 'backend.output'].includes(event.type));
  const keyboardEvents = trace.events.filter((event) => event.source === 'runner' && event.type === 'keyboard.observation');
  const metadata = trace.events.filter((event) => event.type === 'backend.metadata').map(dataOf);
  const isSimulated = (data: Record<string, unknown>): boolean => data.evidenceProvenance === 'simulation' ||
    data.observationProvenance === 'simulation' || data.backend === 'mock-voiceover';
  const simulation = trace.environment.observationProvenance === 'simulation' || simulationOutputs.length > 0 ||
    trace.events.some((event) => event.source === 'simulation' && event.type === 'simulation.observation') ||
    metadata.some(isSimulated);
  const keyboard = trace.task.mode === 'keyboard' || keyboardEvents.length > 0 || metadata.some((data) =>
    data.observationKind === 'keyboard' || data.backend === 'legacy-keyboard');
  const screenreader = (!simulation && trace.task.mode === 'screenreader') || outputEvents.length > 0 ||
    trace.events.some((event) => event.source === 'screen-reader' && event.type === 'screen-reader.observation') ||
    metadata.some((data) => !isSimulated(data) && (data.backend === 'at-driver' || data.evidenceProvenance === 'native' ||
      (!simulation && data.observationKind === 'screenreader')));
  const modalities: EvidenceModality[] = [
    ...(screenreader ? ['screenreader' as const] : []),
    ...(simulation ? ['simulation' as const] : []),
    ...(keyboard ? ['keyboard' as const] : [])
  ];
  const hasReadableOutput = (event: TraceEvent): boolean => {
    const data = dataOf(event);
    const text = isRecord(data.output) ? data.output.text : data.text;
    return !event.redacted && typeof text === 'string' && text.trim().length > 0;
  };
  const hasScreenshot = (event: TraceEvent): boolean => {
    const screenshot = dataOf(event).screenshot;
    return isRecord(screenshot) && typeof screenshot.pngBase64 === 'string' &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(screenshot.pngBase64) &&
      Buffer.from(screenshot.pngBase64, 'base64').subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  };
  const evidence = trace.events.filter((event) => event.source === 'verifier' && event.type === 'verifier.evidence' &&
    isRecord(dataOf(event).witness));
  return {
    modality: modalities.length > 1 ? 'mixed' : modalities[0] ?? 'unknown',
    modalities,
    readableSpeechEvents: outputEvents.filter(hasReadableOutput),
    redactedSpeechEvents: outputEvents.filter((event) => event.redacted),
    readableSimulationOutputEvents: simulationOutputs.filter(hasReadableOutput),
    redactedSimulationOutputEvents: simulationOutputs.filter((event) => event.redacted),
    readableScreenshotEvents: keyboardEvents.filter(hasScreenshot),
    redactedScreenshotEvents: keyboardEvents.filter((event) => event.redacted && !hasScreenshot(event)),
    readableVerifierEvidenceEvents: evidence.filter((event) => !event.redacted),
    redactedVerifierEvidenceEvents: evidence.filter((event) => event.redacted),
    diagnosticScreenshotEvents: trace.events.filter((event) => event.source === 'browser-diagnostic' &&
      event.type === 'browser.screenshot' && typeof dataOf(event).path === 'string' && !event.redacted),
    redactedDiagnosticScreenshotEvents: trace.events.filter((event) => event.source === 'browser-diagnostic' &&
      event.type === 'browser.screenshot-redacted'),
    redactedEvents: trace.events.filter((event) => event.redacted)
  };
}

/** Local observations only. These are run diagnostics, not a WCAG conformance verdict. */
export const deterministicAnalyzer: TraceAnalyzer = {
  id: "rawstep/deterministic-v1",
  analyze(trace) {
    const findings: AnalysisFinding[] = [];
    const policyBlocks = trace.events.filter((event) =>
      (event.source === 'browser-diagnostic' && event.type === 'browser.navigation-blocked') ||
      (event.source === "policy" && (event.type === 'policy.rejected' ||
        dataOf(event).allowed === false || dataOf(event).blocked === true || /blocked|denied|violation/.test(event.type))));
    if (policyBlocks.length) findings.push({
      id: "policy-block", title: "Run encountered a policy boundary", severity: "warning",
      description: "The trace records a rejected policy decision or a blocked browser navigation. These are execution constraints, not proof of an accessibility defect.",
      evidenceEventIds: policyBlocks.map((event) => event.id)
    });
    const failedCommands = trace.events.filter((event) => {
      const data = dataOf(event);
      return event.source === "runner" && /command|action/.test(event.type) &&
        (data.ok === false || (isRecord(data.result) && data.result.ok === false));
    });
    if (failedCommands.length) findings.push({
      id: "command-failure", title: "Command execution reported a failure", severity: "warning",
      description: "One or more command results report a failure. Inspect the referenced events before attributing it to the application.",
      evidenceEventIds: failedCommands.map((event) => event.id)
    });
    const evidence = summarizeTraceEvidence(trace);
    const { readableSpeechEvents: speech, redactedSpeechEvents: redactedSpeech,
      readableScreenshotEvents: screenshots, redactedScreenshotEvents: redactedScreenshots,
      readableVerifierEvidenceEvents: verifierEvidence, redactedVerifierEvidenceEvents: redactedVerifierEvidence } = evidence;
    if (trace.events.length && (evidence.modalities.includes('screenreader') || evidence.modality === 'unknown') && !speech.length && !redactedSpeech.length) findings.push({
      id: "missing-speech-evidence", title: "No nonempty screen-reader output was recorded", severity: "info",
      description: "This trace has no nonempty screen-reader output evidence. Transport, acknowledgment, and collection-window events are not speech evidence. This does not establish that the page was silent or inaccessible.",
      evidenceEventIds: [trace.events[0]!.id]
    });
    if (redactedSpeech.length) findings.push({
      id: "redacted-speech-evidence", title: "Some screen-reader output was redacted", severity: "info",
      description: "Input privacy redaction limits inspection of these output events. The saved trace cannot establish their original speech content.",
      evidenceEventIds: redactedSpeech.map((event) => event.id)
    });
    if (trace.events.length && evidence.modalities.includes('simulation')) findings.push({
      id: 'simulated-voiceover-evidence', title: 'Trace includes simulated VoiceOver evidence', severity: 'info',
      description: 'Simulated output comes from a browser-backed approximation with deterministic wording. It is not Apple VoiceOver speech, and it cannot establish native screen-reader behavior or accessibility conformance.',
      evidenceEventIds: [trace.events.find((event) => event.source === 'simulation')?.id ?? trace.events[0]!.id]
    });
    if (evidence.redactedSimulationOutputEvents.length) findings.push({
      id: 'redacted-simulation-evidence', title: 'Some simulated output was redacted', severity: 'info',
      description: 'Input privacy redaction limits inspection of these simulated output events. Their original generated text is unavailable in the saved trace.',
      evidenceEventIds: evidence.redactedSimulationOutputEvents.map((event) => event.id)
    });
    if (trace.events.length && evidence.modalities.includes('keyboard') && !screenshots.length && !redactedScreenshots.length) findings.push({
      id: 'missing-screenshot-evidence', title: 'No keyboard screenshot evidence was recorded', severity: 'info',
      description: 'This keyboard trace has no retained screenshot observation. Startup or observation collection may have failed; the trace does not establish what the page looked like.',
      evidenceEventIds: [trace.events[0]!.id]
    });
    if (redactedScreenshots.length) findings.push({
      id: 'redacted-screenshot-evidence', title: 'Some keyboard screenshots were removed for privacy', severity: 'info',
      description: 'Input privacy redaction removed these screenshots. Their original pixels cannot be inspected in the saved trace. Screenshots are visual evidence, not screen-reader output.',
      evidenceEventIds: redactedScreenshots.map((event) => event.id)
    });
    if (evidence.redactedDiagnosticScreenshotEvents.length) findings.push({
      id: 'redacted-diagnostic-screenshots', title: 'Diagnostic screenshots were omitted for privacy', severity: 'info',
      description: 'These requested browser diagnostic screenshots were skipped after text entry. No image file was saved for the omitted captures, so the trace cannot establish their original pixels.',
      evidenceEventIds: evidence.redactedDiagnosticScreenshotEvents.map((event) => event.id)
    });
    if (redactedVerifierEvidence.length) findings.push({
      id: 'redacted-verifier-evidence', title: 'Some verification evidence was redacted', severity: 'info',
      description: 'Verification results retain their recorded rule outcomes and evidence references, but privacy redaction limits inspection of the original observations.',
      evidenceEventIds: redactedVerifierEvidence.map((event) => event.id)
    });
    const visual = summarizeVisualExploration(trace);
    if (visual.repetitionLimitEventIds.length) findings.push({
      id: 'visual-repetition-limit', title: 'Visual repetition guard stopped exploration', severity: 'warning',
      description: 'Repeated screenshot pixels reached a configured exploration limit. This may indicate a keyboard trap or an unobservable focus change, but does not establish either. Review actions and saved screenshots.',
      evidenceEventIds: visual.repetitionLimitEventIds
    });
    const unseenFocus = visual.modelFocusObservations.filter(item => item.visibility === 'not-visible');
    if (unseenFocus.length) findings.push({
      id: 'model-focus-not-visible', title: 'Model reported no visible focus indicator', severity: 'warning',
      description: 'This is an uncertain visual model assessment, not a DOM focus check or a confirmed accessibility defect. Inspect the corresponding screenshots.',
      evidenceEventIds: unseenFocus.map(item => item.eventId)
    });
    const failedVerification = trace.events.filter((event) => event.source === 'verifier' &&
      event.type === 'verifier.result' && dataOf(event).passed === false);
    if (failedVerification.length) findings.push({
      id: 'verification-failure', title: 'Independent verification recorded an unmet rule', severity: 'info',
      description: 'At least one verification attempt did not pass. Later attempts may have succeeded; the recorded run outcome remains authoritative. Inspect per-rule outcomes and their observed evidence before attributing a cause.',
      evidenceEventIds: failedVerification.map((event) => event.id)
    });
    const observationSummary: string[] = [];
    if (evidence.modalities.includes('screenreader') || evidence.modality === 'unknown') {
      observationSummary.push(`${speech.length} readable screen-reader output events`, `${redactedSpeech.length} redacted output events`);
    }
    if (evidence.modalities.includes('simulation')) {
      observationSummary.push(`${evidence.readableSimulationOutputEvents.length} readable simulated VoiceOver output events`, `${evidence.redactedSimulationOutputEvents.length} redacted simulated output events`, 'simulated output is not native VoiceOver evidence');
    }
    if (evidence.modalities.includes('keyboard')) {
      observationSummary.push(`${screenshots.length} readable keyboard screenshot observations`, `${visual.states.length} distinct pixel states`, `${visual.inferenceEventIds.length} recorded model inferences`, `${redactedScreenshots.length} keyboard screenshot observations removed for privacy`);
    }
    return {
      summary: `Mode: ${evidence.modality}. ${trace.events.length} ordered events; ${observationSummary.join('; ')}; ${evidence.diagnosticScreenshotEvents.length} recorded diagnostic screenshot references; ${evidence.redactedDiagnosticScreenshotEvents.length} diagnostic screenshots omitted for privacy; ${verifierEvidence.length} readable verifier evidence events; ${redactedVerifierEvidence.length} redacted verifier evidence events. ${evidence.redactedEvents.length} total redacted events. ${policyBlocks.length} policy boundary events; ${failedCommands.length} command failures; ${failedVerification.length} failed verification attempts. Recorded run outcome: ${trace.outcome?.status ?? "unfinished"}. Diagnostic observations only; no accessibility conformance verdict.`,
      findings
    };
  }
};

/** Analyzer errors are data in a separate report; they cannot replace the execution result. */
export async function analyzeTrace(trace: RunTrace, analyzer: TraceAnalyzer = deterministicAnalyzer): Promise<AnalysisReport> {
  validateTrace(trace);
  const snapshot = freezeDeep(JSON.parse(JSON.stringify(trace)) as RunTrace);
  const base = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    traceSchemaVersion: snapshot.schemaVersion,
    runId: snapshot.runId,
    analyzer: { id: typeof analyzer?.id === "string" && analyzer.id ? analyzer.id : "unknown" },
    analyzedAt: new Date().toISOString(),
    ...(snapshot.outcome ? { runOutcome: JSON.parse(JSON.stringify(snapshot.outcome)) as RunOutcome } : {})
  };
  let failure: AnalysisFailure = "analyzer-error";
  try {
    if (!analyzer || !analyzer.id || typeof analyzer.analyze !== "function") throw new Error("Invalid analyzer plugin.");
    let candidate: unknown;
    try { candidate = await analyzer.analyze(snapshot); }
    catch (error) {
      const known = findRawstepError(error)?.code;
      failure = known === "analysis-cancelled" || (error instanceof Error && error.name === "AbortError") ? "cancelled" : known === "analysis-timeout" || (error instanceof Error && error.name === "TimeoutError") ? "timeout" : "analyzer-error";
      throw error;
    }
    failure = "invalid-result";
    validateAnalyzerResult(candidate, snapshot);
    // Materialize plugin output before validation/use so getters or later mutation cannot
    // replace a previously checked evidence reference.
    const result: unknown = JSON.parse(JSON.stringify(candidate));
    validateAnalyzerResult(result, snapshot);
    return { ...base, status: "completed", summary: result.summary, findings: result.findings };
  } catch {
    // Plugin errors can contain credentials/environment secrets. Keep them out of artifacts.
    return {
      ...base, status: "failed", findings: [], failure,
      summary: "Analysis failed. The saved trace and recorded run outcome are unchanged.",
      error: "Analyzer execution or evidence validation failed."
    };
  }
}

export interface AnalyzeSavedTraceOptions { analyzer?: TraceAnalyzer; outDir?: string }
export async function analyzeSavedTrace(path: string, options: AnalyzeSavedTraceOptions = {}): Promise<AnalysisReport> {
  const tracePath = await traceFilePath(path);
  const trace = await readTrace(tracePath);
  const report = await analyzeTrace(trace, options.analyzer);
  const outDir = options.outDir ?? dirname(tracePath);
  await mkdir(outDir, { recursive: true });
  await writeJsonAtomic(join(outDir, "analysis.json"), report);
  return report;
}

/** Loading a plugin is explicit: it executes trusted local JavaScript in this process. */
export async function loadAnalyzer(modulePath: string): Promise<TraceAnalyzer> {
  const module: unknown = await import(pathToFileURL(resolve(modulePath)).href);
  const exports = module as Record<string, unknown>;
  const candidate = exports.default ?? exports.analyzer;
  if (!isRecord(candidate) || typeof candidate.id !== "string" || !candidate.id || typeof candidate.analyze !== "function") {
    throw new Error("Analyzer module must export default (or analyzer) with id and analyze(trace).");
  }
  return candidate as unknown as TraceAnalyzer;
}
