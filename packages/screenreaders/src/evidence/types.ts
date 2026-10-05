import type { SimulatedSemanticNode } from '../mock-voiceover/semantics.js';

export type EvidenceAt = 'voiceover' | 'nvda';
export type EvidenceCoverageFilter = { profileId?: string; atVersion?: string; browserVersion?: string; osVersion?: string };
export type EvidenceContext = {
  /** Required for NVDA: browse-mode lines can contain several controls. */
  readingUnit: 'single-control' | 'unknown';
  /** No automatic claim that an ancestor/group announcement is absent. */
  groupContext: 'none' | 'unknown';
  language: 'en' | 'unknown';
};
export type EvidenceSpeechRequest = {
  profileId: string;
  command: string;
  node: SimulatedSemanticNode;
  elementKind: 'input-button' | 'button' | 'link' | 'input-text' | 'textarea' | 'checkbox';
  context: EvidenceContext;
};
export type EvidenceSpeechResult = {
  status: 'matched' | 'unsupported';
  speech: string | null;
  reason?: string;
  profileId: string;
  evidenceProvenance: 'simulation';
  scope: 'source-bounded-wording-only';
  sourceIds: string[];
  nativeParityEstablished: false;
};
export type EvidenceCase = {
  id: string;
  at: EvidenceAt;
  profileId: string;
  atVersion: string;
  browser: 'safari' | 'chrome';
  browserVersion: string;
  osVersion: string | null;
  pattern: string;
  command: string;
  elementKind: EvidenceSpeechRequest['elementKind'];
  node: SimulatedSemanticNode;
  context: EvidenceContext;
  reportedSpeech: string;
  semanticInputProvenance: 'manual-abstraction-not-native-AX';
  contextProvenance: 'simulation-premise-not-observed-settings';
  source: { url: string; jsonPointer: string; sha256: string; attribution: string; testedOn: string; commit: string };
  unknownSettings: string[];
};
export type EvidenceComparison = {
  caseId: string;
  profileId: string;
  status: 'matched' | 'mismatch' | 'unsupported';
  expectedSpeech: string;
  actualSpeech: string | null;
  reason?: string;
  nativeParityEstablished: false;
};
export type EvidenceCoverageSummary = {
  schemaVersion: '1.0';
  scopeStatus: 'partial' | 'no-compatible-evidence';
  filter: EvidenceCoverageFilter;
  sourceRecords: number;
  compatibleRecords: number;
  eligibleReportedSpeechRecords: number;
  regressionCaseCount: number;
  supportedCases: { id: string; profileId: string; pattern: string; command: string; atVersion: string; browserVersion: string; scope: 'source-bounded-wording-only' }[];
  missingCoverage: { pattern: string; reason: string }[];
  qualityFlagCounts: Record<string, number>;
  sourceCounts: { voiceover: number; nvda: number };
  limitations: string[];
  nativeParityEstablished: false;
};
export type EvidenceGroup = {
  source: 'a11ysupport' | 'aria-at';
  at: EvidenceAt;
  atVersion: string | null;
  browser: string;
  browserVersion: string | null;
  osVersion: string | null;
  records: number;
  eligibleReportedSpeechRecords: number;
  qualityFlagCounts: Record<string, number>;
};
