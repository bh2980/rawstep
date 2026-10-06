import type { ChoiceModel } from '@rawstep/policies/policy';
import { createLlmModel, LlmChoiceModel } from '@rawstep/policies/llm';
import type { ScreenshotModelAdapter, ScreenshotModelRequest } from '@rawstep/policies/screenshot/model';
import { resolveBaseURL, type Model, type Prompt } from './config.js';

/** The LLM a run profile chose, as a choice model with the run's prompt. */
export function llmChoiceModel(model: Model, prompt: Prompt, apiKey?: string, fetcher?: typeof fetch): LlmChoiceModel {
  const llm = createLlmModel({ baseURL: resolveBaseURL(model), modelId: model.modelId, apiKey, timeoutMs: model.timeoutMs, name: 'rawstep-choice', fetch: fetcher });
  return new LlmChoiceModel(llm, prompt, model.inputs);
}
/** Keyboard-mode bridge: the screenshot policy's request as a choice model's state and images. */
export class LlmScreenshotAdapter implements ScreenshotModelAdapter {
  constructor(private readonly model: ChoiceModel) {}
  choose(request: ScreenshotModelRequest, { signal }: { signal: AbortSignal }) {
    return this.model.choose({
      state: { goal: request.goal, purpose: request.purpose, viewport: request.screenshot.viewport, history: request.history, visualState: request.visualState },
      choices: request.choices.map(({ id, label }) => ({ id, label })),
      images: [request.screenshot.pngBase64, ...(request.previousScreenshot ? [request.previousScreenshot.pngBase64] : [])],
    }, { signal });
  }
}
