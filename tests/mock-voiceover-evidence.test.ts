import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatSimulatedSpeech, MOCK_VOICEOVER_PROFILE, MockVoiceOverBackend, type SimulatedSemanticNode } from '@rawstep/screenreaders/mock-voiceover';

type Fixture = {
  observationId: string;
  sourceUrl: string;
  sourceJsonPointer: string;
  sourceSha256: string;
  environment: { testedOn: string; atVersion: string; browserVersion: string; osVersion: string; quickNav: null; verbosity: null };
  action: { id: string };
  reportedSpeech: string;
  semanticInput: Partial<SimulatedSemanticNode>;
  semanticInputProvenance: string;
  runtimeEvidenceProvenance: 'simulation';
};
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/a11ysupport-navigation.json', import.meta.url), 'utf8')) as Fixture[];
// Compare only token ordering: reported manual transcripts do not reliably preserve
// punctuation/capitalization. Never normalize away state, role, value, or hint words.
const wording = (value: string) => value.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
const semantic = (value: Partial<SimulatedSemanticNode>): SimulatedSemanticNode => ({ role: 'button', name: '', protected: false, disabled: false, readonly: false, required: false, multiline: false, modal: false, ...value });

describe('source-backed simulation navigation wording', () => {
  it.each(fixtures)('matches the limited recorded wording for $observationId', fixture => {
    expect(wording(formatSimulatedSpeech(semantic(fixture.semanticInput)))).toBe(wording(fixture.reportedSpeech));
    expect(fixture.sourceUrl).toContain('/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/');
    expect(fixture.sourceJsonPointer).toMatch(/^\/commands\/vo_macos\/safari\/\d+$/);
    expect(fixture.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.environment.testedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.environment.quickNav).toBeNull();
    expect(fixture.environment.verbosity).toBeNull();
    expect(fixture.semanticInputProvenance).toContain('not an observed native AX tree');
    expect(fixture.runtimeEvidenceProvenance).toBe('simulation');
  });

  it('does not turn source-backed wording into native measurement provenance', async () => {
    const backend = new MockVoiceOverBackend();
    const started = await backend.start();
    expect(MOCK_VOICEOVER_PROFILE).toBe('english-dom-navigation-evidence-v2');
    expect(started).toMatchObject({ evidenceProvenance: 'simulation', profile: MOCK_VOICEOVER_PROFILE, environment: { nativeScreenReader: false, atVersion: '2' } });
    await backend.close();
  });

  it('never reads a protected value even when calling the formatter directly', () => {
    expect(formatSimulatedSpeech(semantic({ role: 'textbox', name: 'Password', protected: true, value: 'do-not-announce' }))).toBe('Password, secure text field');
  });

  it("never speaks Chromium's internal role names such as LabelText", () => {
    expect(formatSimulatedSpeech(semantic({ role: 'LabelText', name: 'Email address' }))).toBe('Email address');
    expect(formatSimulatedSpeech(semantic({ role: 'LabelText', name: '' }))).toBe('');
    expect(formatSimulatedSpeech(semantic({ role: 'tab', name: 'Details' }))).toBe('Details, tab');
  });
});
