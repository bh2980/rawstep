import type { ChoiceModel, ChoiceRequest, ChoiceResult } from '../policy/choice.js';
import { assertSystemOneInputs, validateSystemOneResult, type SystemOneClient } from './client.js';
import type { ScreenshotModelAdapter, ScreenshotModelRequest, ScreenshotModelResponse } from '../screenshot/model.js';
import { copySystemOnePrompt, systemOnePromptEvidence, SPEECH_DECISION_PROMPT, SCREENSHOT_DECISION_PROMPT, type SystemOnePrompt } from './prompts.js';

/**
 * A SystemOne decision model as a policy's choice model. The prompt's instructions go with every request, and the
 * prompt evidence fingerprints the instructions plus candidate wording (never live speech, images or input values).
 */
export class SystemOneChoiceModel implements ChoiceModel {
  readonly inputs: readonly ('text' | 'image')[];
  private readonly prompt: SystemOnePrompt;
  constructor(readonly client: SystemOneClient, prompt: SystemOnePrompt = SPEECH_DECISION_PROMPT) {
    assertSystemOneInputs(client, ['text']);
    this.prompt = copySystemOnePrompt(prompt);
    this.inputs = [...client.capabilities.inputs];
  }
  async choose(request: ChoiceRequest, { signal }: { signal: AbortSignal }): Promise<ChoiceResult> {
    const choices = request.choices.map(({ id, label }) => ({ id, label }));
    const result = await this.client.evaluate({ state: request.state, instructions: this.prompt.instructions, choices,
      ...(request.images?.length ? { images: request.images.map(pngBase64 => ({ pngBase64 })) } : {}) }, { signal });
    signal.throwIfAborted(); validateSystemOneResult(result, choices);
    return { choiceId: result.choiceId, probabilities: result.probabilities, model: result.model, prompt: systemOnePromptEvidence(this.prompt, choices) };
  }
}

/** Bridge, not a second visual policy: existing focus gates/repetition/replay remain authoritative. */
export class SystemOneScreenshotAdapter implements ScreenshotModelAdapter {
  private readonly prompt: SystemOnePrompt;
  constructor(readonly client: SystemOneClient, prompt: SystemOnePrompt = SCREENSHOT_DECISION_PROMPT) {
    assertSystemOneInputs(client, ['text', 'image'], 1, 2);
    this.prompt = copySystemOnePrompt(prompt);
  }
  async choose(request: ScreenshotModelRequest, { signal }: { signal: AbortSignal }): Promise<ScreenshotModelResponse> {
    const result = await this.client.evaluate({
      state: { goal: request.goal, purpose: request.purpose ?? 'action', viewport: { ...request.screenshot.viewport },
        history: structuredClone(request.history),
        visualState: { sha256: request.visualState.sha256, visits: request.visualState.visits, unchangedTransitions: request.visualState.unchangedTransitions },
        imageOrder: request.previousScreenshot ? ['current', 'previous'] : ['current'] },
      instructions: this.prompt.instructions,
      choices: request.choices.map(c => ({ id: c.id, label: c.label })),
      images: [request.screenshot, ...(request.previousScreenshot ? [request.previousScreenshot] : [])].map(s => ({ pngBase64: s.pngBase64 })),
    }, { signal });
    signal.throwIfAborted(); validateSystemOneResult(result, request.choices);
    return { choiceId: result.choiceId, probabilities: result.probabilities, model: result.model,
      prompt: systemOnePromptEvidence(this.prompt, request.choices.map(c => ({ id: c.id, label: c.label }))) };
  }
}
