/** What a decision model accepts: how many candidates one request may carry. */
export type SystemOneCapabilities = { maxChoices: number };
export type SystemOneChoice = { id: string; label: string };
export type SystemOneRequest = {
  state: Record<string, unknown>;
  instructions: string;
  choices: readonly SystemOneChoice[];
};
export type SystemOneResult = {
  choiceId: string;
  probabilities: number[];
  model: { id: string; requestedId: string; runtime: string; revision?: string };
};
export interface SystemOneClient {
  readonly capabilities: SystemOneCapabilities;
  /** Network preflight belongs before browser/AT acquisition. No inference. */
  prepare?(options: { signal: AbortSignal }): Promise<void>;
  evaluate(request: SystemOneRequest, options: { signal: AbortSignal }): Promise<SystemOneResult>;
}

export function validateCapabilities(capabilities: SystemOneCapabilities): void {
  if (!Number.isSafeInteger(capabilities.maxChoices) || capabilities.maxChoices < 1) throw new Error('Invalid SystemOne capabilities.');
}
export function assertSystemOneChoices(client: SystemOneClient, choices = 1): void {
  validateCapabilities(client.capabilities);
  if (choices > client.capabilities.maxChoices) throw new Error('SystemOne candidate count exceeds model capabilities.');
}
export function validateSystemOneRequest(request: SystemOneRequest, client: SystemOneClient): void {
  assertSystemOneChoices(client, request.choices.length);
  if (!request.choices.length || request.choices.some(c => !c.id.trim() || !c.label.trim()) || new Set(request.choices.map(c => c.id)).size !== request.choices.length)
    throw new Error('SystemOne choices must have unique nonempty IDs and labels.');
}
export function validateSystemOneResult(result: SystemOneResult, choices: readonly SystemOneChoice[]): void {
  if (!choices.some(c => c.id === result?.choiceId) || !Array.isArray(result.probabilities) || result.probabilities.length !== choices.length ||
      result.probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1) || Math.abs(result.probabilities.reduce((a, b) => a + b, 0) - 1) > 0.01 ||
      !result.model?.id?.trim() || !result.model.requestedId?.trim() || !result.model.runtime?.trim()) throw new Error('Invalid SystemOne choice, probability distribution, or model identity.');
}

/** Explicit test double, never automatically substituted for a real client. */
export class FakeSystemOneClient implements SystemOneClient {
  readonly capabilities: SystemOneCapabilities;
  readonly requests: SystemOneRequest[] = [];
  private position = 0;
  constructor(private readonly choices: readonly string[] | ((request: SystemOneRequest) => string), capabilities: SystemOneCapabilities = { maxChoices: 255 }) {
    validateCapabilities(capabilities); this.capabilities = structuredClone(capabilities);
  }
  async evaluate(request: SystemOneRequest, { signal }: { signal: AbortSignal }): Promise<SystemOneResult> {
    signal.throwIfAborted(); validateSystemOneRequest(request, this);
    this.requests.push(structuredClone(request));
    const choiceId = typeof this.choices === 'function' ? this.choices(request) : this.choices[this.position++]!;
    const result = { choiceId, probabilities: request.choices.map(c => c.id === choiceId ? 1 : 0), model: { id: 'fake-systemone', requestedId: 'fake-systemone', runtime: 'test-double' } };
    validateSystemOneResult(result, request.choices); return result;
  }
}
