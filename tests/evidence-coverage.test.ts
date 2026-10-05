import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareEvidenceCase, compareEvidenceFixtures, formatEvidenceSpeech, normalizeEvidenceWording,
  selectEvidenceCases, summarizeEvidenceCoverage, REQUIRED_EVIDENCE_CELLS,
  type EvidenceCase, type EvidenceSpeechRequest,
} from '@rawstep/screenreaders/evidence';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/screenreader-evidence/observed-cases.json', import.meta.url), 'utf8')) as EvidenceCase[];
const request = (item: EvidenceCase): EvidenceSpeechRequest => ({ profileId: item.profileId, command: item.command, node: structuredClone(item.node), context: { ...item.context }, elementKind: item.elementKind });
const nvda = fixtures.filter(item => item.at === 'nvda');

describe('versioned observed-output reference cases', () => {
  it.each(fixtures)('compares the source transcript independently for $id', fixture => {
    const actual = formatEvidenceSpeech(request(fixture));
    expect(actual.status).toBe('matched');
    expect(normalizeEvidenceWording(actual.speech!)).toBe(normalizeEvidenceWording(fixture.reportedSpeech));
    expect(actual).toMatchObject({ evidenceProvenance: 'simulation', nativeParityEstablished: false, scope: 'source-bounded-wording-only' });
    expect(actual.sourceIds).toContain(fixture.id);
    expect(fixture.source.url).toContain('/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/');
    expect(fixture.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.semanticInputProvenance).toBe('manual-abstraction-not-native-AX');
    expect(fixture.contextProvenance).toBe('simulation-premise-not-observed-settings');
  });

  it('is not a replay of the expected transcript and detects a wrong state word', () => {
    const original = nvda.find(item => item.pattern === 'toggle-button.true' && item.command === 'next_item')!;
    const changed = structuredClone(original);
    changed.reportedSpeech = changed.reportedSpeech.replace('pressed', 'not pressed');
    expect(compareEvidenceCase(changed).status).toBe('mismatch');
    const adapted = request(original); adapted.node.name = 'Save';
    expect(formatEvidenceSpeech(adapted).speech).toBe('toggle button, pressed, Save');
    expect(compareEvidenceCase(original).status).toBe('matched');
  });

  it('keeps NVDA next-item and Tab order distinct', () => {
    const button = nvda.find(item => item.pattern === 'button' && item.command === 'next_item')!;
    const next = request(button);
    expect(formatEvidenceSpeech(next).speech).toBe('button, apply');
    expect(formatEvidenceSpeech({ ...next, command: 'next_focusable_item' }).speech).toBe('apply, button');
    expect(formatEvidenceSpeech({ ...next, command: 'activate_button' })).toMatchObject({ status: 'unsupported', speech: null });
  });

  it.each([
    ['unknown reading unit', (r: EvidenceSpeechRequest) => { r.context.readingUnit = 'unknown'; }],
    ['unknown group context', (r: EvidenceSpeechRequest) => { r.context.groupContext = 'unknown'; }],
    ['unknown language', (r: EvidenceSpeechRequest) => { r.context.language = 'unknown'; }],
    ['unmodeled description', (r: EvidenceSpeechRequest) => { r.node.description = 'More information'; }],
    ['combined expanded state', (r: EvidenceSpeechRequest) => { r.node.expanded = false; }],
    ['disabled state', (r: EvidenceSpeechRequest) => { r.node.disabled = true; }],
    ['password protection', (r: EvidenceSpeechRequest) => { r.node.protected = true; r.node.value = 'secret'; }],
    ['wrong element', (r: EvidenceSpeechRequest) => { r.elementKind = 'input-text'; }],
    ['unknown semantic flag', (r: EvidenceSpeechRequest) => { (r.node as any).invalid = true; }],
  ])('returns explicit unsupported for %s rather than plausible fallback speech', (_name, mutate) => {
    const r = request(nvda[0]!); mutate(r);
    expect(formatEvidenceSpeech(r)).toMatchObject({ status: 'unsupported', speech: null, sourceIds: [], nativeParityEstablished: false });
  });

  it('does not silently select a nearest version or treat family names as exact formatter profiles', () => {
    const r = request(nvda[0]!);
    expect(formatEvidenceSpeech({ ...r, profileId: 'nvda' }).status).toBe('unsupported');
    expect(formatEvidenceSpeech({ ...r, profileId: r.profileId.replace('143', '144') }).status).toBe('unsupported');
  });
});

describe('corpus counts and missing state/action coverage', () => {
  it('keeps raw source volume separate from calibrated cases and returns actual gaps', () => {
    const summary = summarizeEvidenceCoverage();
    expect(summary.sourceCounts).toEqual({ voiceover: 1290, nvda: 1624 });
    expect(summary.sourceRecords).toBe(2914);
    expect(summary.compatibleRecords).toBe(2914);
    expect(summary.regressionCaseCount).toBe(25);
    expect(summary.qualityFlagCounts['state-output-contradiction']).toBe(4);
    expect(summary.scopeStatus).toBe('partial');
    expect(summary.nativeParityEstablished).toBe(false);
    expect(summary.missingCoverage.map(item => item.pattern)).toContain('dialog/close_focus_restore');
    expect(summary.missingCoverage.map(item => item.pattern)).toContain('toggle-button/activate_form_control');
    expect(summary.missingCoverage.length).toBeGreaterThan(0);
  });

  it('filters browser/version data without inflating NVDA Chrome count or native claims', () => {
    const chrome = summarizeEvidenceCoverage({ profileId: 'nvda-chrome' });
    expect(chrome.compatibleRecords).toBe(530);
    expect(chrome.regressionCaseCount).toBe(12);
    expect(chrome.supportedCases.every(item => item.scope === 'source-bounded-wording-only')).toBe(true);
    expect(chrome.missingCoverage.some(item => item.pattern === 'checkbox.unchecked/next_item')).toBe(true);
    const versioned = summarizeEvidenceCoverage({ profileId: 'nvda-chrome', atVersion: '2025.3.1', browserVersion: '143' });
    expect(versioned.regressionCaseCount).toBe(2);
    expect(versioned.supportedCases.every(item => item.atVersion === '2025.3.1')).toBe(true);
    const firefox = summarizeEvidenceCoverage({ profileId: 'nvda-firefox' });
    expect(firefox.compatibleRecords).toBe(557);
    expect(firefox.regressionCaseCount).toBe(0);
    expect(firefox.scopeStatus).toBe('partial');
  });

  it('reports unknown/conflicting filters as no evidence rather than falling back to all profiles', () => {
    const unknown = summarizeEvidenceCoverage({ profileId: 'invented' });
    expect(unknown.compatibleRecords).toBe(0);
    expect(unknown.regressionCaseCount).toBe(0);
    expect(unknown.scopeStatus).toBe('no-compatible-evidence');
    expect(unknown.missingCoverage).toHaveLength(REQUIRED_EVIDENCE_CELLS.length);
    expect(summarizeEvidenceCoverage({ profileId: 'nvda-chrome-2025.3.1-143', atVersion: '2021.1' }).compatibleRecords).toBe(0);
  });

  it('does not let caller mutation corrupt the retained observed cases', () => {
    const selected = selectEvidenceCases({ profileId: 'nvda' });
    selected[0]!.reportedSpeech = 'CORRUPTED'; selected[0]!.node.name = 'CORRUPTED';
    expect(selectEvidenceCases({ profileId: 'nvda' })[0]!.reportedSpeech).not.toContain('CORRUPTED');
    expect(compareEvidenceFixtures().every(item => item.status === 'matched')).toBe(true);
  });
});
