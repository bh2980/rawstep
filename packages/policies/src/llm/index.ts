import { createHash } from 'node:crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, generateText, Output, RetryError, type LanguageModel } from 'ai';
import { z } from 'zod';
import { isLoopbackHostname, RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { RawstepError } from '@rawstep/core/errors';
import type { ModelFailure } from '../policy/choice.js';
import type { CueRequest, CueResult, Planner, PlanRequest, PlanResult } from '../policy/orchestration.js';
import { plannerDraftSchema } from '../policy/fixed-plan.js';
import { AcpAgent, parseAgentJson } from '../acp/index.js';
import { SPEECH_PLANNER_INSTRUCTIONS } from './rules.js';

export { SPEECH_PLANNER_INSTRUCTIONS } from './rules.js';

/** A model server address: HTTPS (or HTTP on loopback) without credentials, query or fragment. Returned with a trailing slash so relative paths resolve under it. */
export function modelBaseURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Model base URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)))
    throw new Error('Model base URL requires HTTPS, or loopback HTTP, without credentials/query/fragment.');
  url.pathname = url.pathname.replace(/\/$/, '') + '/'; return url;
}

/**
 * Every Rawstep LLM call goes through the Vercel AI SDK with an OpenAI-compatible chat endpoint
 * (OpenAI, OpenRouter, LM Studio, Ollama, ...), or through a coding-agent CLI spoken to over ACP
 * (`createAgentModel`) with the person's own sign-in. Provider error text can carry credentials or page content, so errors
 * are never forwarded: callers only see a RawstepError with a message Rawstep wrote and one of `llm-cancelled`, `llm-timeout` or
 * `llm-failed`. A failed call's `detail.modelFailure` says why (see `ModelFailure`): a reply that could not be used, or how the
 * provider failed. A timeout ends a run as not measured (`planner-timeout`), since a slow model says nothing about the page.
 */
export type LlmModel = ({ readonly model: LanguageModel } | { readonly agent: AcpAgent; readonly reasoningEffort?: string }) & {
  /** The model ID that was requested; a response that names another model is rejected. An agent's `default` keeps its own choice. */
  readonly modelId: string;
  readonly timeoutMs: number;
  /** Kept only to reject responses that echo the credential. */
  readonly apiKey?: string;
};
export type LlmModelOptions = {
  baseURL: string; modelId: string; apiKey?: string; timeoutMs?: number;
  /** Provider label for AI SDK metadata. */
  name?: string;
  /** Test seam; the default is global fetch. Redirects always fail so credentials never follow them. */
  fetch?: typeof fetch;
};
export type LlmCallOptions = { signal?: AbortSignal; timeoutMs?: number };

const MESSAGES = {
  'llm-cancelled': 'LLM call was cancelled.',
  'llm-timeout': 'The model did not answer within the connection\'s time limit. A slow model can need a longer limit (the connection\'s timeoutMs).',
  'llm-failed': 'The model call failed.',
} as const;
/** What went wrong and what to do, in Rawstep's words; the provider's own error text is never shown. */
const FAILURE_MESSAGES: Record<ModelFailure['kind'], string> = {
  'key-refused': 'The provider refused the API key. Check the key for this connection (rawstep doctor checks it).',
  'model-not-found': 'The provider does not know this model ID. Check the model ID (rawstep doctor lists what the provider offers).',
  'rate-limited': 'The provider kept refusing requests as too many (rate limit or quota), also after retrying. Wait and run again, or use another model.',
  'provider-error': 'The provider failed on its side, also after retrying. Run again later.',
  'unreachable': 'The provider could not be reached. Check the network and the connection\'s address.',
  'agent-failed': 'The agent CLI did not start or answer. Check that it is installed and signed in (rawstep doctor).',
  'no-reply': 'The model gave no usable reply.',
  'not-json': 'The model\'s reply held no JSON object, also after asking again.',
  'schema': 'The model\'s reply did not have the required shape, also after asking again.',
  'incomplete': 'The model\'s reply was cut off.',
  'model-changed': 'The reply came from another model than the one requested.',
  'credential-echoed': 'The model\'s reply contained the API key, so it was not used.',
};
const TIMEOUT_OUTCOME = { status: 'inconclusive', reason: 'planner-timeout' } as const;
export const llmError = (code: keyof typeof MESSAGES, failure?: ModelFailure) => new RawstepError(code,
  code === 'llm-failed' && failure ? `${MESSAGES[code]} ${FAILURE_MESSAGES[failure.kind]}${failure.status ? ` (HTTP ${failure.status})` : ''}${UNANSWERED.has(failure.kind) ? ' Set RAWSTEP_DEBUG=1 to print the provider\'s own error on this computer.' : ''}` : MESSAGES[code],
  { ...(failure ? { detail: { modelFailure: failure } } : {}), ...(code === 'llm-timeout' ? { outcome: TIMEOUT_OUTCOME } : {}) });
/**
 * Sorts a provider error into a `ModelFailure` by its HTTP status or its being a network error; nothing of its text is kept. With
 * RAWSTEP_DEBUG set, the raw error goes to this computer's stderr only, never into a record.
 */
function providerFailure(error: unknown): ModelFailure {
  if (process.env.RAWSTEP_DEBUG) console.error('[rawstep debug] model call failed:', error);
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(last)) {
    const status = last.statusCode;
    const kind = status === 401 || status === 403 ? 'key-refused' : status === 404 ? 'model-not-found' : status === 429 || status === 402 ? 'rate-limited'
      : status !== undefined && status >= 500 ? 'provider-error' : status === undefined ? 'unreachable' : 'no-reply';
    return { kind, ...(status ? { status } : {}) };
  }
  return { kind: last instanceof TypeError ? 'unreachable' : 'no-reply' };
}
function agentFailure(error: unknown): ModelFailure {
  if (process.env.RAWSTEP_DEBUG) console.error('[rawstep debug] agent call failed:', error);
  return { kind: 'agent-failed' };
}
/** Failures that come from the provider or the agent, not from a reply: the raw error may say more. */
const UNANSWERED = new Set<ModelFailure['kind']>(['key-refused', 'model-not-found', 'rate-limited', 'provider-error', 'unreachable', 'agent-failed', 'no-reply']);
/** Retries the SDK makes on its own for a rate limit, a server error or a dropped connection, with growing waits (it honours retry-after). */
const PROVIDER_RETRIES = 2;
/** Characters of a rejected reply kept for the run's record. */
const REPLY_LIMIT = 4000;
/** A reply the model gave that could not be used. Only this, never a provider error, reaches the record. */
class ReplyRejected extends Error {
  constructor(readonly failure: ModelFailure) { super(failure.kind); }
}
function rejected(kind: ModelFailure['kind'], reply: string | undefined, apiKey?: string, issues?: ModelFailure['issues']): ReplyRejected {
  const echoed = !!apiKey && !!reply?.includes(apiKey);
  return new ReplyRejected({ kind: echoed ? 'credential-echoed' : kind, ...(issues?.length ? { issues } : {}), ...(reply && !echoed ? { reply: reply.slice(0, REPLY_LIMIT) } : {}) });
}
/** Validates a parsed reply; the schema's complaints (paths and messages, no values) explain a rejection. */
function validated<T>(schema: z.ZodType<T>, value: unknown, reply: string, apiKey?: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw rejected('schema', reply, apiKey, parsed.error.issues.slice(0, 10).map(issue => ({ path: issue.path.join('.'), message: issue.message.slice(0, 200) })));
}
/**
 * One call, and once more when the reply was not JSON or had the wrong shape: the second request says what was wrong. Anything
 * else (timeout, cancellation, no reply) is not retried. Either way a rejected reply ends as `llm-failed` with its `ModelFailure`.
 */
async function withOneRetry<T>(request: StructuredRequest<T>, call: (user: string) => Promise<StructuredResult<T>>, fail: (error: unknown) => RawstepError): Promise<StructuredResult<T>> {
  let first: ModelFailure;
  try { return await call(request.user); } catch (error) {
    if (!(error instanceof ReplyRejected) || (error.failure.kind !== 'not-json' && error.failure.kind !== 'schema')) throw fail(error);
    first = error.failure;
  }
  const why = first.kind === 'not-json' ? 'it held no JSON object' : `it did not match the required shape: ${(first.issues ?? []).map(i => `${i.path || '(root)'}: ${i.message}`).join('; ')}`;
  try { return { ...await call(`${request.user}\n\nYour previous reply could not be used because ${why}. Reply again with only the JSON object in the required shape.`), retried: first }; }
  catch (error) { throw fail(error); }
}

export function createLlmModel(options: LlmModelOptions): LlmModel {
  if (!options.modelId?.trim()) throw new Error('An explicit model ID is required.');
  const timeoutMs = options.timeoutMs ?? RAWSTEP_DEFAULTS.modelTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error('Invalid LLM timeout.');
  const base = modelBaseURL(options.baseURL);
  const fetcher = options.fetch ?? fetch;
  const provider = createOpenAICompatible({
    name: options.name ?? 'openai-compatible', baseURL: base.href.replace(/\/$/, ''), ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    fetch: (input, init) => fetcher(input, { ...init, redirect: 'error' }),
  });
  return { model: provider.chatModel(options.modelId), modelId: options.modelId, timeoutMs, ...(options.apiKey ? { apiKey: options.apiKey } : {}) };
}

/** A coding-agent CLI as a model. The agent process starts on the first call; `close()` ends it. */
export function createAgentModel(options: { agent: AcpAgent; modelId: string; timeoutMs?: number; reasoningEffort?: string }): LlmModel & { close(): Promise<void> } {
  if (!options.modelId?.trim()) throw new Error('An explicit model ID is required.');
  const timeoutMs = options.timeoutMs ?? RAWSTEP_DEFAULTS.modelTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error('Invalid LLM timeout.');
  return { agent: options.agent, modelId: options.modelId, timeoutMs, ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}), close: () => options.agent.close() };
}
/** Ends an agent model's process; nothing to do for an HTTP model. */
export const closeLlmModel = async (model: LlmModel): Promise<void> => { if ('agent' in model) await model.agent.close(); };

export type StructuredRequest<T> = LlmCallOptions & {
  model: LlmModel; system: string; user: string; schema: z.ZodType<T>;
  /** Reject a response whose model differs from the requested one. */
  strictModel?: boolean;
};
export type StructuredResult<T> = { object: T; modelId: string; retried?: ModelFailure };

/**
 * One JSON-object completion validated by a zod schema. OpenAI-compatible servers only guarantee
 * "a JSON object", so `system` must describe the expected shape; the schema then verifies it.
 */
export async function generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const { model, signal } = request;
  if (signal?.aborted) throw llmError('llm-cancelled');
  if ('agent' in model) return generateWithAgent(model, model.agent, request);
  const timeout = AbortSignal.timeout(request.timeoutMs ?? model.timeoutMs);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return withOneRetry(request, async user => {
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: model.model, instructions: request.system, messages: [{ role: 'user', content: user }],
        output: Output.json(), maxRetries: PROVIDER_RETRIES, abortSignal,
      });
    } catch (error) {
      // The SDK keeps the text of a reply it could not parse; other errors are the provider's and are not kept.
      const text = (error as { text?: unknown }).text;
      throw typeof text === 'string' && !abortSignal.aborted ? rejected('not-json', text, model.apiKey) : error;
    }
    if (result.finishReason !== 'stop') throw rejected('incomplete', result.text, model.apiKey);
    if (model.apiKey && result.text.includes(model.apiKey)) throw rejected('credential-echoed', undefined);
    if (request.strictModel && result.response.modelId !== model.modelId) throw rejected('model-changed', undefined);
    return { object: validated(request.schema, result.output, result.text, model.apiKey), modelId: result.response.modelId };
  }, error => {
    if (signal?.aborted) return llmError('llm-cancelled');
    if (timeout.aborted) return llmError('llm-timeout');
    return llmError('llm-failed', error instanceof ReplyRejected ? error.failure : providerFailure(error));
  });
}

/** ACP has no system role and no JSON mode: the instructions lead the one text block and the reply is parsed for its JSON object. */
async function generateWithAgent<T>(model: LlmModel & { reasoningEffort?: string }, agent: AcpAgent, request: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const { signal } = request;
  try { await agent.start(signal); }
  catch (error) {
    if (signal?.aborted) throw llmError('llm-cancelled');
    throw llmError('llm-failed', agentFailure(error));
  }
  // Starting (and an adapter download) is not part of the call's time.
  const timeout = AbortSignal.timeout(request.timeoutMs ?? model.timeoutMs);
  return withOneRetry(request, async user => {
    const text = await agent.prompt({
      text: request.system + '\nDo not use tools, files or the web; answer from this message only, with the JSON object and nothing else.\n\n' + user,
      modelId: model.modelId, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    let value: unknown;
    try { value = parseAgentJson(text); } catch { throw rejected('not-json', text); }
    return { object: validated(request.schema, value, text), modelId: model.modelId };
  }, error => {
    if (signal?.aborted) return llmError('llm-cancelled');
    if (timeout.aborted) return llmError('llm-timeout');
    return llmError('llm-failed', error instanceof ReplyRejected ? error.failure : agentFailure(error));
  });
}

/** An LLM as the orchestrated policy's planner. Its replies are validated; a malformed draft fails the call. */
/** For the planner's other call: is what the screen reader just said the item a task's cue describes? */
export const CUE_RECOGNITION_INSTRUCTIONS = [
  'You help a blind screen reader user carry out a plan on a web page. A task in the plan ends when the user hears a cue, but the cue',
  'was written before the page was heard, so its words are a guess at what the screen reader will say. You get the goal, the task,',
  'its cue and the one item the screen reader just spoke. Decide whether that item is what the task was looking for, as the user',
  'hearing it would: the same control or text under a different wording counts; a different control that shares a word (a group',
  'heading, a neighbouring checkbox, a link elsewhere) does not. The role in the cue is a guess too: the right name spoken as',
  'plain text where a heading was expected, or as a link where a button was expected, is the item. Use only the words given.',
  'Answer with JSON only:',
  '{"matches": boolean, "reason": string (one short sentence)}.',
].join(' ');
const cueAnswerSchema = z.object({ matches: z.boolean(), reason: z.string().max(300).optional() });

export class LlmPlanner implements Planner {
  readonly instructions: string;
  private readonly prompt: { id: string; version: string; sha256: string };
  constructor(readonly llm: LlmModel, extra = '') {
    const rules = SPEECH_PLANNER_INSTRUCTIONS;
    this.instructions = extra.trim() ? `${rules}\nAdditional instructions:\n${extra.trim()}` : rules;
    const sha256 = createHash('sha256').update(this.instructions).digest('hex');
    this.prompt = { id: 'rawstep-planner', version: sha256.slice(0, 12), sha256 };
  }
  async plan(request: PlanRequest, { signal }: { signal: AbortSignal }): Promise<PlanResult> {
    const { object, modelId, retried } = await generateStructured({ model: this.llm, signal, strictModel: true, system: this.instructions, user: JSON.stringify(request), schema: plannerDraftSchema });
    return { draft: object, model: { id: modelId, runtime: 'agent' in this.llm ? 'acp-agent-generative-plan' : 'openai-compatible-generative-plan' }, prompt: { ...this.prompt }, ...(retried ? { retried } : {}) };
  }
  async recognize(request: CueRequest, { signal }: { signal: AbortSignal }): Promise<CueResult> {
    const { object, modelId, retried } = await generateStructured({ model: this.llm, signal, strictModel: true, system: CUE_RECOGNITION_INSTRUCTIONS, user: JSON.stringify(request), schema: cueAnswerSchema });
    return { matches: object.matches, ...(object.reason ? { reason: object.reason } : {}), model: { id: modelId, runtime: 'agent' in this.llm ? 'acp-agent-cue-recognition' : 'openai-compatible-cue-recognition' }, ...(retried ? { retried } : {}) };
  }
}
