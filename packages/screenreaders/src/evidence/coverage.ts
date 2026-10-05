import { EVIDENCE_CASES, EVIDENCE_GROUPS } from './data.js';
import type { EvidenceAt, EvidenceCase, EvidenceCoverageFilter, EvidenceCoverageSummary, EvidenceGroup } from './types.js';

/** Atomic candidate cells; this is an explicit bounded backlog, not a sample-size guarantee. */
export const REQUIRED_EVIDENCE_CELLS = Object.freeze([
  'static-text/next_item', 'heading/next_item', 'heading/next_heading',
  'link/next_item', 'link/next_focusable_item', 'link/activate_link',
  'button/next_item', 'button/next_focusable_item', 'button/activate_button', 'button.disabled/next_item',
  'toggle-button.false/next_item', 'toggle-button.false/next_focusable_item',
  'toggle-button.true/next_item', 'toggle-button.true/next_focusable_item',
  'toggle-button.mixed/next_item', 'toggle-button.mixed/next_focusable_item', 'toggle-button/activate_form_control',
  'checkbox.unchecked/next_item', 'checkbox.checked/next_item', 'checkbox.mixed/next_item',
  'checkbox.unchecked/next_focusable_item', 'checkbox/activate_form_control',
  'radio/next_item', 'radio/next_focusable_item', 'radio/arrow_selection',
  'disclosure.collapsed/next_focusable_item', 'disclosure.expanded/next_focusable_item', 'disclosure/activate_button',
  'textbox.optional/next_focusable_item', 'textbox.required/next_focusable_item',
  'textbox.filled/next_item', 'textbox/enter_text', 'textbox.readonly/enter_text', 'textbox.protected/enter_text',
  'textarea.valued/next_form_field', 'textarea/enter_text',
  'select/next_focusable_item', 'select/next_option', 'select/select_option',
  'dialog/open', 'dialog/close_focus_restore', 'status/update', 'alert/update', 'focused-node/remove',
] as const);

const LIMITATIONS = [
  'Counts are reported result records, not unique utterances, independent repetitions, or correctness votes.',
  'sourceRecords/sourceCounts cover the complete catalog; compatibleRecords applies the requested filter.',
  'Eligible reported speech is a curation candidate, not an approved simulator rule or native-conformance result.',
  'All implemented cases are source-bounded wording simulations. No native VoiceOver or NVDA execution was performed for these cases.',
  'Settings not reported by the source remain unknown. Declared setup targets are not observed native cursor/focus telemetry.',
  'Different recorded AT/browser versions remain separate profiles; family summaries can aggregate them but cannot establish a version-specific runtime.',
  'Activation speech, browse/focus mode changes, multi-control reading units, selection/caret state, hints, live-region queues, earcons and exact timing remain uncalibrated.',
  'Contradictory, conditional, generalized, untestable or contaminated records are not automatic supported cases.',
];

type Selection = { at?: EvidenceAt; browser?: string; atVersion?: string; browserVersion?: string; osVersion?: string; known: boolean };
function selection(filter: EvidenceCoverageFilter): Selection {
  const id = filter.profileId;
  const result: Selection = { known: true, atVersion: filter.atVersion, browserVersion: filter.browserVersion, osVersion: filter.osVersion };
  if (!id) return result;
  if (['voiceover', 'voiceover-safari', 'voiceover-macos', 'mock-voiceover', 'english-dom-navigation-evidence-v2', 'voiceover for macos', 'voiceover (macos)', 'mock voiceover (simulation)'].includes(id)) return { ...result, at: 'voiceover', browser: 'safari' };
  if (id === 'nvda') return { ...result, at: 'nvda' };
  if (['nvda-chrome', 'nvda-firefox', 'nvda-edge'].includes(id)) return { ...result, at: 'nvda', browser: id.slice(5) };
  const exact = EVIDENCE_CASES.find(item => item.profileId === id);
  if (!exact) return { ...result, known: false };
  if ((filter.atVersion && filter.atVersion !== exact.atVersion) || (filter.browserVersion && filter.browserVersion !== exact.browserVersion) || (filter.osVersion && filter.osVersion !== exact.osVersion)) return { ...result, known: false };
  return { ...result, at: exact.at, browser: exact.browser, atVersion: exact.atVersion, browserVersion: exact.browserVersion, osVersion: exact.osVersion ?? undefined };
}
function compatible(item: EvidenceGroup | EvidenceCase, target: Selection): boolean {
  return target.known && (!target.at || item.at === target.at) && (!target.browser || item.browser === target.browser) && (!target.atVersion || item.atVersion === target.atVersion) && (!target.browserVersion || item.browserVersion === target.browserVersion) && (!target.osVersion || item.osVersion === target.osVersion);
}
export function selectEvidenceCases(filter: EvidenceCoverageFilter = {}): readonly EvidenceCase[] {
  const target = selection(filter);
  return EVIDENCE_CASES.filter(item => compatible(item, target)).map(item => structuredClone(item));
}
export function summarizeEvidenceCoverage(filter: EvidenceCoverageFilter = {}): EvidenceCoverageSummary {
  const target = selection(filter);
  const groups = EVIDENCE_GROUPS.filter(item => compatible(item, target));
  const cases = selectEvidenceCases(filter);
  const covered = new Set(cases.map(item => `${item.pattern}/${item.command}`));
  const qualityFlagCounts: Record<string, number> = {};
  for (const group of groups) for (const [flag, count] of Object.entries(group.qualityFlagCounts)) qualityFlagCounts[flag] = (qualityFlagCounts[flag] ?? 0) + count;
  const sourceCounts = { voiceover: 0, nvda: 0 };
  for (const group of EVIDENCE_GROUPS) sourceCounts[group.at] += group.records;
  return {
    schemaVersion: '1.0', scopeStatus: groups.length ? 'partial' : 'no-compatible-evidence', filter: { ...filter },
    sourceRecords: sourceCounts.voiceover + sourceCounts.nvda,
    compatibleRecords: groups.reduce((sum, item) => sum + item.records, 0),
    eligibleReportedSpeechRecords: groups.reduce((sum, item) => sum + item.eligibleReportedSpeechRecords, 0),
    regressionCaseCount: cases.length,
    supportedCases: cases.map(item => ({ id: item.id, profileId: item.profileId, pattern: item.pattern, command: item.command, atVersion: item.atVersion, browserVersion: item.browserVersion, scope: 'source-bounded-wording-only' })),
    missingCoverage: REQUIRED_EVIDENCE_CELLS.filter(cell => !covered.has(cell)).map(pattern => ({ pattern, reason: target.known ? 'No implemented observed-output regression covers this exact state/action cell in the selected environment.' : 'Unknown or conflicting profile filter; no evidence scope was silently broadened.' })),
    qualityFlagCounts, sourceCounts, limitations: [...LIMITATIONS], nativeParityEstablished: false,
  };
}
