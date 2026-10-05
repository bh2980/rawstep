export { AtDriverBackend, AtDriverClient, AtDriverError, AT_DRIVER_KEYS, getAtDriverProfile } from './at-driver/index.js';
export type { AtDriverAction, AtDriverBackendOptions, AtDriverCapabilities, AtDriverClientOptions, AtDriverEvent, AtDriverMetadata, AtDriverObservation, AtDriverOperationOptions, AtDriverOutput, AtDriverProfile, AtDriverProfileName, AtDriverReceipt, AtDriverTransportEvent, CommandReceipt, WebSocketFactory, WebSocketLike } from './at-driver/index.js';
export { OrcaBackend, OrcaBridgeClient, OrcaBridgeError, ORCA_NATIVE_PROTOCOL, orcaBridgePath, mapOrcaAction } from './orca/index.js';
export type { OrcaBackendOptions, OrcaBridgeOptions, OrcaCommandReceipt, OrcaEvent, OrcaMetadata, OrcaObservation, OrcaOutput, OrcaReceipt, OrcaTransportEvent } from './orca/index.js';
export { MockVoiceOverBackend, runMockVoiceOverTask, MOCK_VOICEOVER_WARNING, MOCK_VOICEOVER_PROFILE, MOCK_VOICEOVER_LIMITATIONS, formatSimulatedSpeech } from './mock-voiceover/index.js';
export type { MockVoiceOverRunOptions, MockWordingOptions, SimulatedSemanticNode } from './mock-voiceover/index.js';
// Corpus errors live in a data-free module so the root never loads the research corpus (see `@rawstep/screenreaders/evidence`).
export { UnsupportedCorpusPatternError } from './evidence/unsupported.js';
export type { CorpusSpeechResult } from './evidence/learned.js';
