import type { ChoiceModel } from '@rawstep/policies/policy';
import { createCliModel, createLlmModel, LlmChoiceModel, type LlmModel } from '@rawstep/policies/llm';
import { isCliProvider } from './config.js';
export { cliStatus } from '@rawstep/policies/llm';
import type { ScreenshotModelAdapter, ScreenshotModelRequest } from '@rawstep/policies/screenshot/model';
import { resolveBaseURL, type Model, type Prompt } from './config.js';

/** An LLM on its connection: a coding-agent CLI runs locally with the person's sign-in; every other provider is an OpenAI-compatible endpoint. */
export function llmModelOf(model: Model, name: string, apiKey?: string, fetcher?: typeof fetch): LlmModel {
  if (isCliProvider(model.provider)) return createCliModel({ provider: model.provider, modelId: model.modelId, timeoutMs: model.timeoutMs, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) });
  return createLlmModel({ baseURL: resolveBaseURL(model), modelId: model.modelId, apiKey, timeoutMs: model.timeoutMs, name, fetch: fetcher });
}
/** The LLM a model combo chose, as a choice model with the run's prompt. */
export function llmChoiceModel(model: Model, prompt: Prompt, apiKey?: string, fetcher?: typeof fetch): LlmChoiceModel {
  return new LlmChoiceModel(llmModelOf(model, 'rawstep-choice', apiKey, fetcher), prompt, model.inputs);
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
