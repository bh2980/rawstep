export type SystemOneInput = 'text' | 'image';
export type SystemOneCapabilities = { inputs: readonly SystemOneInput[]; maxChoices: number; maxImages: number };
export type SystemOneChoice = { id: string; label: string };
export type SystemOneImage = { pngBase64: string };
export type SystemOneRequest = {
  state: Record<string, unknown>;
  instructions: string;
  choices: readonly SystemOneChoice[];
  /** Inline PNG bytes only. State references are owned by the HTTP adapter. */
  images?: readonly SystemOneImage[];
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
  if (!capabilities.inputs.includes('text') || capabilities.inputs.some(v => !['text', 'image'].includes(v)) ||
      new Set(capabilities.inputs).size !== capabilities.inputs.length || !Number.isSafeInteger(capabilities.maxChoices) || capabilities.maxChoices < 1 ||
      !Number.isSafeInteger(capabilities.maxImages) || capabilities.maxImages < 0 ||
      (!capabilities.inputs.includes('image') && capabilities.maxImages !== 0)) throw new Error('Invalid SystemOne capabilities.');
}
export function assertSystemOneInputs(client: SystemOneClient, inputs: readonly SystemOneInput[], choices = 1, images = 0): void {
  validateCapabilities(client.capabilities);
  if (inputs.some(input => !client.capabilities.inputs.includes(input)) || images > client.capabilities.maxImages)
    throw new Error('SystemOne model does not support the required input modalities or image count.');
  if (choices > client.capabilities.maxChoices) throw new Error('SystemOne candidate count exceeds model capabilities.');
}
export function validateSystemOneRequest(request: SystemOneRequest, client: SystemOneClient): void {
  assertSystemOneInputs(client, request.images?.length ? ['text', 'image'] : ['text'], request.choices.length, request.images?.length ?? 0);
  if (!request.choices.length || request.choices.some(c => !c.id.trim() || !c.label.trim()) || new Set(request.choices.map(c => c.id)).size !== request.choices.length)
    throw new Error('SystemOne choices must have unique nonempty IDs and labels.');
  for (const image of request.images ?? []) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.pngBase64) || Buffer.from(image.pngBase64, 'base64').subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('SystemOne images must contain inline PNG bytes.');
  }
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
  constructor(private readonly choices: readonly string[] | ((request: SystemOneRequest) => string), capabilities: SystemOneCapabilities = { inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 }) {
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
