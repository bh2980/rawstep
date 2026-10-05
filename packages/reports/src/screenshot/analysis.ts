import { createHash } from 'node:crypto';
import type { RunTrace } from '@rawstep/core/trace';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export type VisualExplorationSummary = {
  states: { sha256: string; visits: number; observationEventIds: string[] }[];
  transitions: { fromEventId: string; toEventId: string; changedPixels: boolean; actionEventIds: string[] }[];
  inferenceEventIds: string[];
  repetitionLimitEventIds: string[];
  modelFocusObservations: { eventId: string; visibility: string; note?: string }[];
  limitation: string;
};
/** Offline pixel identity is deliberately weaker than inferred focus/control identity. */
export function summarizeVisualExploration(trace: Readonly<RunTrace>): VisualExplorationSummary {
  const states: VisualExplorationSummary['states'] = [];
  const transitions: VisualExplorationSummary['transitions'] = [];
  const inferenceEventIds: string[] = [];
  const repetitionLimitEventIds: string[] = [];
  const modelFocusObservations: VisualExplorationSummary['modelFocusObservations'] = [];
  let previous: { eventId: string; sha256: string; sequence: number } | undefined;
  for (const event of trace.events) {
    if (event.source === 'policy' && event.type === 'policy.evidence' && !event.redacted) {
      const evidence = record(record(event.data).evidence);
      if (evidence.kind === 'exploration-limit') repetitionLimitEventIds.push(event.id);
      if (evidence.kind === 'model-inference') {
        inferenceEventIds.push(event.id);
        const focus = record(evidence.focusAssessment);
        if (['visible', 'not-visible', 'uncertain'].includes(String(focus.visibility))) modelFocusObservations.push({ eventId: event.id, visibility: String(focus.visibility), ...(typeof focus.note === 'string' ? { note: focus.note } : {}) });
      }
    }
    if (event.source !== 'runner' || event.type !== 'keyboard.observation') continue;
    const png = record(record(event.data).screenshot).pngBase64;
    if (typeof png !== 'string' || Buffer.from(png, 'base64').subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') { previous = undefined; continue; }
    const sha256 = createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
    let state = states.find(item => item.sha256 === sha256);
    if (!state) { state = { sha256, visits: 0, observationEventIds: [] }; states.push(state); }
    state.visits++;
    state.observationEventIds.push(event.id);
    if (previous) transitions.push({ fromEventId: previous.eventId, toEventId: event.id, changedPixels: previous.sha256 !== sha256,
      actionEventIds: trace.events.filter(item => item.seq > previous!.sequence && item.seq < event.seq && item.type === 'action.result').map(item => item.id) });
    previous = { eventId: event.id, sha256, sequence: event.seq };
  }
  return { states, transitions, inferenceEventIds, repetitionLimitEventIds, modelFocusObservations,
    limitation: 'Pixel equality does not identify focused elements. Changes may be focus, scrolling, animation, or page content; unchanged pixels may conceal focus movement. Model assessments are uncertain. This is a bounded keyboard exploration, not WCAG certification or screen-reader testing.' };
}
