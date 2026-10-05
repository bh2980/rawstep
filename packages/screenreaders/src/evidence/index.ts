export type * from './types.js';
export { formatEvidenceSpeech } from './formatter.js';
export { summarizeEvidenceCoverage, selectEvidenceCases, REQUIRED_EVIDENCE_CELLS } from './coverage.js';
export { EVIDENCE_CATALOG } from './data.js';

import { selectEvidenceCases } from './coverage.js';
import { formatEvidenceSpeech } from './formatter.js';
import type { EvidenceCase, EvidenceComparison, EvidenceCoverageFilter, EvidenceSpeechRequest, EvidenceSpeechResult } from './types.js';

/** Deliberately limited transcript normalization; state/role/value words and order remain. */
export function normalizeEvidenceWording(value: string): string {
  return value.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function compareEvidenceCase(
  fixture: EvidenceCase,
  formatter: (request: EvidenceSpeechRequest) => EvidenceSpeechResult = formatEvidenceSpeech,
): EvidenceComparison {
  const result = formatter({ profileId: fixture.profileId, command: fixture.command, node: structuredClone(fixture.node), elementKind: fixture.elementKind, context: { ...fixture.context } });
  return {
    caseId: fixture.id, profileId: fixture.profileId,
    status: result.status === 'unsupported' ? 'unsupported' : result.speech !== null && normalizeEvidenceWording(result.speech) === normalizeEvidenceWording(fixture.reportedSpeech) ? 'matched' : 'mismatch',
    expectedSpeech: fixture.reportedSpeech, actualSpeech: result.speech, ...(result.reason ? { reason: result.reason } : {}), nativeParityEstablished: false,
  };
}
export function compareEvidenceFixtures(filter: EvidenceCoverageFilter = {}): EvidenceComparison[] {
  return selectEvidenceCases(filter).map(item => compareEvidenceCase(item));
}
export { formatCorpusSpeech, listCorpusRules, summarizeCorpusEvaluation, UnsupportedCorpusPatternError, type CorpusProfile, type CorpusSpeechInput, type CorpusSpeechResult } from './learned.js';
export { createCorpusMockBackend, runCorpusMockTask, type CorpusMockOptions } from './mock.js';
