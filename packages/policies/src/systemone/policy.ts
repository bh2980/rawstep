import type { ChoiceModel, ChoiceRequest, ChoiceResult } from '../policy/choice.js';
import { assertSystemOneChoices, validateSystemOneResult, type SystemOneClient } from './client.js';
import { copySystemOnePrompt, systemOnePromptEvidence, SPEECH_DECISION_PROMPT, type SystemOnePrompt } from './prompts.js';

/**
 * A SystemOne decision model as a policy's choice model. The prompt's instructions go with every request, and the
 * prompt evidence fingerprints the instructions plus candidate wording (never live speech or input values).
 */
export class SystemOneChoiceModel implements ChoiceModel {
  private readonly prompt: SystemOnePrompt;
  constructor(readonly client: SystemOneClient, prompt: SystemOnePrompt = SPEECH_DECISION_PROMPT) {
    assertSystemOneChoices(client);
    this.prompt = copySystemOnePrompt(prompt);
  }
  async choose(request: ChoiceRequest, { signal }: { signal: AbortSignal }): Promise<ChoiceResult> {
    const choices = request.choices.map(({ id, label }) => ({ id, label }));
    const result = await this.client.evaluate({ state: request.state, instructions: this.prompt.instructions, choices }, { signal });
    signal.throwIfAborted(); validateSystemOneResult(result, choices);
    return { choiceId: result.choiceId, probabilities: result.probabilities, model: result.model, prompt: systemOnePromptEvidence(this.prompt, choices) };
  }
}

