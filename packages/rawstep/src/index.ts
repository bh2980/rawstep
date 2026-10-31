/** Model-neutral screen reader task execution and offline trace tooling. */
export { describeInputs, matchesText, MAX_SCRIPT_SOURCE, resolveTask, validateNavigation } from './contracts/index.js';
export type { ActionExecution, ActivatedAnnouncementVerificationRule, AllowedActions, AnyVerificationRule, Backend, BackendAction, BackendCapabilities, BackendObservation, BackendOperationOptions, BackendOutput, BackendRunContext, BackendSession, BackendSpeechObservation, Decision, DecisionPolicy, DomEventVerificationRule, EventVerificationRule, ExecutionFailure, FocusedVerificationRule, HistoryEntry, InputDescriptor, NavigationPolicy, NotVerificationRule, Observation, ObservedEventKind, PolicyAction, RequestVerificationRule, ResolvedNavigationPolicy, ResponseVerificationRule, ScreenReaderObservation, ScriptCheckError, ScriptVerificationRule, Task, TaskInputOptions, TextMatcher, VerificationRecord, VerificationRuleRecord, VerificationWitness, VerifyRule, VerifyRuleType, VerifySpec } from './contracts/index.js';
export { AT_DRIVER_KEYS, AtDriverBackend, AtDriverClient, AtDriverError, getAtDriverProfile } from './at-driver/index.js';
export type { AtDriverAction, AtDriverBackendOptions, AtDriverCapabilities, AtDriverClientOptions, AtDriverEvent, AtDriverMetadata, AtDriverObservation, AtDriverOperationOptions, AtDriverOutput, AtDriverProfile, AtDriverProfileName, AtDriverReceipt, AtDriverTransportEvent, CommandReceipt, WebSocketFactory, WebSocketLike } from './at-driver/index.js';
export { LlmPlanner, SPEECH_PLANNER_INSTRUCTIONS } from '@rawstep/policies/llm';
export { loadPolicy, OrchestratedSpeechPolicy, renderPlanMarkdown, ScriptedPolicy, speechChoices } from './policy/index.js';
export type { ModelHistoryEntry, OrchestrationOptions, PlanDocument, PlanDraft, Planner, PlanRequest, PlanResult, SpeechPolicyOptions } from './policy/index.js';
// The high-level entry point: run a task from rawstep.config.json. The low-level native runner is `rawstep/runner`.
export { ProjectError, runTask } from './project/index.js';
export type { RunTaskOptions, RunTaskResult } from './project/index.js';
export { aggregateHints, extractHints, HINTS_SCHEMA_VERSION, runEnding, writeHints } from './hints/index.js';
export type { EndingOf, Hint, HintFinding, HintKind, HintReport, HintSource, HintTarget, RunEnding, UnmeasuredBy } from './hints/index.js';
export type { RunOptions } from './runner/index.js';
export { createRedactor, FileTraceSink, MemoryTraceSink, readTrace, REDACTED, TRACE_SCHEMA_VERSION, traceFilePath, TraceRecorder, validateTrace, writeJsonAtomic } from './trace/index.js';
export type { AppendEventOptions, CollectionWindow, RunOutcome, RunTrace, TraceEnvironment, TraceEvent, TraceEventType, TraceRecorderOptions, TraceSink, TraceSource, TraceTaskMetadata } from './trace/index.js';
export { ANALYSIS_SCHEMA_VERSION, analyzeSavedTrace, analyzeTrace, deterministicAnalyzer, LlmTraceAnalyzer, loadAnalyzer, readAnalysis, summarizeTraceEvidence, validateAnalysisReport, validateAnalyzerResult } from './analyze/index.js';
export type { AnalysisFailure, AnalysisFinding, AnalysisReport, AnalyzerResult, AnalyzeSavedTraceOptions, EvidenceModality, LlmAnalyzerOptions, TraceAnalyzer, TraceEvidenceSummary } from './analyze/index.js';
export { renderReportHtml, summarizeTrace, writeReport } from './report/index.js';
export type { ReportAction, ReportCounts, ReportFailure, ReportSummary, ReportVerification, ReportVerificationRule } from './report/index.js';
export { formatSimulatedSpeech, MOCK_VOICEOVER_LIMITATIONS, MOCK_VOICEOVER_PROFILE, MOCK_VOICEOVER_WARNING, MockVoiceOverBackend, runMockVoiceOverTask } from './mock-voiceover/index.js';
export type { MockVoiceOverRunOptions, MockWordingOptions, SimulatedSemanticNode } from './mock-voiceover/index.js';
export { applyProfile, BUILTIN_PROFILES, collectBrowserDiagnostics, DEFAULT_PROFILE, ProfileApplicationError, resolveEnvironmentProfile, verifyLiveProfile } from './profiles/index.js';
export type { AppliedProfile, BrowserDiagnostic, DiagnosticFinding, EnvironmentProfile, ProfileSetting } from './profiles/index.js';
// Corpus errors come from the data-free root so importing `rawstep` never loads the research corpus (use `rawstep/evidence`).
export { UnsupportedCorpusPatternError } from '@rawstep/screenreaders';
export type { CorpusSpeechResult } from './evidence/index.js';
