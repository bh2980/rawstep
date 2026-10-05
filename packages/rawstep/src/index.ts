/** Model-neutral screen reader task execution and offline trace tooling. */
export { describeInputs, matchesText, MAX_SCRIPT_SOURCE, resolveTask, validateNavigation } from './contracts/index.js';
export type { ActivatedAnnouncementVerificationRule, AllowedActions, AnyVerificationRule, Backend, BackendAction, BackendCapabilities, BackendKeyboardObservation, BackendObservation, BackendOperationOptions, BackendOutput, BackendRunContext, BackendSession, BackendSpeechObservation, Decision, DecisionPolicy, DomEventVerificationRule, EventVerificationRule, FocusedVerificationRule, HistoryEntry, InputDescriptor, KeyboardObservation, LegacyKeyboardObservation, NavigationPolicy, NotVerificationRule, Observation, ObservedEventKind, PolicyAction, RequestVerificationRule, ResolvedNavigationPolicy, ResponseVerificationRule, ScreenReaderObservation, ScreenshotObservation, ScriptCheckError, ScriptVerificationRule, Task, TaskInputOptions, TextMatcher, VerificationRecord, VerificationRuleRecord, VerificationWitness, VerifyRule, VerifyRuleType, VerifySpec } from './contracts/index.js';
export { AT_DRIVER_KEYS, AtDriverBackend, AtDriverClient, AtDriverError, getAtDriverProfile } from './at-driver/index.js';
export type { AtDriverAction, AtDriverBackendOptions, AtDriverCapabilities, AtDriverClientOptions, AtDriverEvent, AtDriverMetadata, AtDriverObservation, AtDriverOperationOptions, AtDriverOutput, AtDriverProfile, AtDriverProfileName, AtDriverReceipt, AtDriverTransportEvent, CommandReceipt, WebSocketFactory, WebSocketLike } from './at-driver/index.js';
export { loadPolicy, ScriptedPolicy } from './policy/index.js';
export { FakeSystemOneClient, modelBaseURL, OpenRouterSystemOneClient, SCREENSHOT_DECISION_PROMPT, SPEECH_DECISION_PROMPT, speechChoices, SystemOneHttpClient, SystemOneScreenshotAdapter, SystemOneSpeechPolicy, VercelEvaluationClient } from './systemone/index.js';
export type { SystemOneCapabilities, SystemOneChoice, SystemOneClient, SystemOneHttpOptions, SystemOneImage, SystemOneInput, SystemOnePrompt, SystemOnePromptEvidence, SystemOneRequest, SystemOneResult } from './systemone/index.js';
export { runTask } from './runner/index.js';
export type { RunOptions } from './runner/index.js';
export { createRedactor, FileTraceSink, hydrateScreenshots, isScreenshotRef, MemoryTraceSink, readTrace, REDACTED, screenshotSha256, TRACE_SCHEMA_VERSION, traceFilePath, TraceRecorder, validateTrace, writeJsonAtomic } from './trace/index.js';
export type { AppendEventOptions, CollectionWindow, RunOutcome, RunTrace, ScreenshotRef, TraceEnvironment, TraceEvent, TraceEventType, TraceRecorderOptions, TraceSink, TraceSource, TraceTaskMetadata } from './trace/index.js';
export { ANALYSIS_SCHEMA_VERSION, analyzeSavedTrace, analyzeTrace, deterministicAnalyzer, LlmTraceAnalyzer, loadAnalyzer, readAnalysis, summarizeTraceEvidence, validateAnalysisReport, validateAnalyzerResult } from './analyze/index.js';
export type { AnalysisFailure, AnalysisFinding, AnalysisReport, AnalyzerResult, AnalyzeSavedTraceOptions, EvidenceModality, LlmAnalyzerOptions, TraceAnalyzer, TraceEvidenceSummary } from './analyze/index.js';
export { renderReportHtml, summarizeTrace, writeReport } from './report/index.js';
export type { ReportAction, ReportCounts, ReportFailure, ReportSummary, ReportVerification, ReportVerificationRule } from './report/index.js';
export { formatSimulatedSpeech, MOCK_VOICEOVER_LIMITATIONS, MOCK_VOICEOVER_PROFILE, MOCK_VOICEOVER_WARNING, MockVoiceOverBackend, runMockVoiceOverTask } from './mock-voiceover/index.js';
export type { MockVoiceOverRunOptions, MockWordingOptions, SimulatedSemanticNode } from './mock-voiceover/index.js';
export { assertScreenshotReplayTaskSafety, diagnoseScreenshotStop, exportScreenshotReplay, FOCUS_CONTEXT_CHOICES, HttpScreenshotModel, restrictChoicesByVisualFocus, runScreenshotReplay, runScreenshotTask, SCREENSHOT_KEYS, SCREENSHOT_MODEL_PROTOCOL, screenshotChoices, ScreenshotDecisionPolicy, ScreenshotKeyboardBackend, ScreenshotReplayPolicy, screenshotReplayTaskHash, STOP_REASON_CHOICES, summarizeVisualExploration, validateModelResponse, validateScreenshotReplay } from './screenshot/index.js';
export type { FocusGateOptions, ScreenshotChoice, ScreenshotModelAdapter, ScreenshotModelRequest, ScreenshotModelResponse, ScreenshotPolicyOptions, ScreenshotReplay, ScreenshotRunOptions, StopReasonReport, VisualExplorationSummary } from './screenshot/index.js';
export { applyProfile, BUILTIN_PROFILES, collectBrowserDiagnostics, createChromiumTabZoomController, DEFAULT_PROFILE, ProfileApplicationError, resolveEnvironmentProfile, verifyLiveProfile } from './profiles/index.js';
export type { AppliedProfile, BrowserDiagnostic, DiagnosticFinding, EnvironmentProfile, NativeZoomController, ProfileSetting } from './profiles/index.js';
export { classifyRun, readMatrix, runEnvironmentMatrix, summarizeMatrixRow, taskFingerprint, validateHumanEvidence } from './matrix/index.js';
export type { FindingCategory, HumanTestEvidence, MatrixOptions, MatrixReport, MatrixRow } from './matrix/index.js';
export { mapOrcaAction, ORCA_NATIVE_PROTOCOL, OrcaBackend, OrcaBridgeClient, OrcaBridgeError, orcaBridgePath } from './orca/index.js';
export type { OrcaBackendOptions, OrcaBridgeOptions, OrcaCommandReceipt, OrcaEvent, OrcaMetadata, OrcaObservation, OrcaOutput, OrcaReceipt, OrcaTransportEvent } from './orca/index.js';
// Corpus errors come from the data-free root so importing `rawstep` never loads the research corpus (use `rawstep/evidence`).
export { UnsupportedCorpusPatternError } from '@rawstep/screenreaders';
export type { CorpusSpeechResult } from './evidence/index.js';
