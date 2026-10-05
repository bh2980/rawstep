import type { Decision, ScreenshotObservation } from '@rawstep/core/contracts';

export const SCREENSHOT_MODEL_PROTOCOL = 'rawstep-screenshot-choice-v1' as const;
export type ScreenshotChoice = { id: string; label: string; decision: Decision };
export type ScreenshotModelRequest = {
  protocol: typeof SCREENSHOT_MODEL_PROTOCOL;
  purpose?: 'action' | 'stop-reason' | 'focus-context';
  goal: string;
  screenshot: ScreenshotObservation;
  previousScreenshot?: ScreenshotObservation;
  choices: ScreenshotChoice[];
  history: { step: number; decision: Decision }[];
  visualState: { sha256: string; visits: number; unchangedTransitions: number };
};
export type ScreenshotModelResponse = {
  choiceId: string;
  /** Same order as request.choices. Scores are model confidence, not measured accuracy. */
  probabilities?: number[];
  model: { id: string; requestedId?: string; revision?: string; runtime: string };
  prompt?: { id: string; version: string; sha256: string };
  inferenceMs?: number;
  focusAssessment?: { visibility: 'visible' | 'not-visible' | 'uncertain'; note?: string };
};
export interface ScreenshotModelAdapter {
  choose(request: ScreenshotModelRequest, options: { signal: AbortSignal }): Promise<ScreenshotModelResponse>;
}

export function validateModelResponse(value: unknown, choices: readonly ScreenshotChoice[]): asserts value is ScreenshotModelResponse {
  if (!value || typeof value !== 'object') throw new Error('Screenshot model response must be an object.');
  const result = value as ScreenshotModelResponse;
  if (!choices.some(choice => choice.id === result.choiceId)) throw new Error('Screenshot model selected an unknown choice.');
  if (!result.model || typeof result.model.id !== 'string' || !result.model.id.trim() || typeof result.model.runtime !== 'string' || !result.model.runtime.trim()) throw new Error('Screenshot model must report model identity and runtime.');
  if (result.model.revision !== undefined && typeof result.model.revision !== 'string') throw new Error('Invalid model revision.');
  if (result.model.requestedId !== undefined && typeof result.model.requestedId !== 'string') throw new Error('Invalid requested model identity.');
  if (result.prompt && (typeof result.prompt.id !== 'string' || !result.prompt.id.trim() || typeof result.prompt.version !== 'string' || !result.prompt.version.trim() || !/^[a-f0-9]{64}$/.test(result.prompt.sha256))) throw new Error('Invalid prompt evidence.');
  if (result.inferenceMs !== undefined && (!Number.isFinite(result.inferenceMs) || result.inferenceMs < 0)) throw new Error('Invalid inference duration.');
  if (result.probabilities !== undefined && (!Array.isArray(result.probabilities) || result.probabilities.length !== choices.length || result.probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1) || Math.abs(result.probabilities.reduce((a, b) => a + b, 0) - 1) > 0.01)) throw new Error('Model probabilities must be normalized and match the choice list.');
  if (result.focusAssessment && (!['visible', 'not-visible', 'uncertain'].includes(result.focusAssessment.visibility) || (result.focusAssessment.note !== undefined && typeof result.focusAssessment.note !== 'string'))) throw new Error('Invalid visual focus assessment.');
}
