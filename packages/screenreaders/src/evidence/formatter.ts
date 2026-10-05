import { formatSimulatedSpeech } from '../mock-voiceover/semantics.js';
import { EVIDENCE_CASES } from './data.js';
import type { EvidenceCase, EvidenceSpeechRequest, EvidenceSpeechResult } from './types.js';

const NODE_KEYS = new Set(['role', 'name', 'value', 'description', 'protected', 'disabled', 'readonly', 'required', 'multiline', 'checked', 'pressed', 'expanded', 'selected', 'level', 'modal']);
const BOOL_KEYS = ['protected', 'disabled', 'readonly', 'required', 'multiline', 'modal'] as const;

/** A deliberately strict wording reference. It does not drive or impersonate NVDA. */
export function formatEvidenceSpeech(input: EvidenceSpeechRequest): EvidenceSpeechResult {
  const base = { profileId: input.profileId, evidenceProvenance: 'simulation' as const, scope: 'source-bounded-wording-only' as const, nativeParityEstablished: false as const };
  const unsupported = (reason: string): EvidenceSpeechResult => ({ ...base, status: 'unsupported', speech: null, sourceIds: [], reason });
  if (!input.node || typeof input.node !== 'object' || Object.keys(input.node).some(key => !NODE_KEYS.has(key))) return unsupported('Unknown or missing semantic input; no fallback wording was synthesized.');
  if (typeof input.node.name !== 'string' || !input.node.name.trim() || typeof input.node.role !== 'string' || BOOL_KEYS.some(key => typeof input.node[key] !== 'boolean')) return unsupported('A named control and explicit semantic flags are required.');
  if (!input.context || input.context.language !== 'en' || input.context.readingUnit !== 'single-control' || input.context.groupContext !== 'none') return unsupported('This reference only covers an explicitly assumed isolated English control; group or reading-unit behavior is unmodeled.');
  if (!EVIDENCE_CASES.some(item => item.profileId === input.profileId)) return unsupported('Unknown exact evidence profile; an AT family alias is not a versioned wording profile.');
  const cases = EVIDENCE_CASES.filter(item => matches(item, input));
  if (!cases.length) return unsupported('No calibrated case covers this exact profile, element, state, and command.');
  const node = input.node;
  let speech: string;
  if (cases[0]!.at === 'voiceover') {
    speech = formatSimulatedSpeech(node);
  } else if (node.role === 'button') {
    const role = node.pressed === undefined ? 'button' : 'toggle button';
    const state = node.pressed === undefined ? [] : node.pressed === true ? ['pressed'] : node.pressed === false ? ['not pressed'] : ['not pressed', input.command === 'next_item' ? 'half checked' : 'half-checked'];
    speech = (input.command === 'next_item' ? [role, ...state, node.name] : [node.name, role, ...state]).join(', ');
  } else if (node.role === 'link') {
    speech = (input.command === 'next_item' ? ['link', node.name] : [node.name, 'link']).join(', ');
  } else if (node.role === 'textbox') {
    speech = [node.name, 'edit', ...(node.required ? ['required'] : []), 'Blank'].join(', ');
  } else return unsupported('No formatter implementation exists for the matched source family.');
  return { ...base, status: 'matched', speech, sourceIds: cases.map(item => item.id) };
}

function matches(item: EvidenceCase, input: EvidenceSpeechRequest): boolean {
  if (item.profileId !== input.profileId || item.command !== input.command || item.elementKind !== input.elementKind) return false;
  const actual = input.node;
  // Names are parameterized. Only the existing textarea rule parameterizes a value;
  // filled single-line, caret/selection, descriptions and extra states are unsupported.
  for (const key of NODE_KEYS) {
    if (key === 'name') continue;
    if (key === 'value' && item.pattern === 'textarea.valued') {
      if (typeof actual.value !== 'string' || !actual.value) return false;
      continue;
    }
    const value = actual[key as keyof typeof actual];
    const expected = item.node[key as keyof typeof actual];
    if ((key === 'value' || key === 'description') && (value === undefined || value === '') && (expected === undefined || expected === '')) continue;
    if (value !== expected) return false;
  }
  return true;
}
