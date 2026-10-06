import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { listGatewayDecisionModels, modelBaseURL } from '@rawstep/policies/systemone';
import { providerPreset, resolveBaseURL, type DiscoverRequest, type ModelChoice } from './config.js';
import { ProjectError } from './errors.js';

export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw new ProjectError('model-http', 'The model server answered HTTP ' + response.status + '. The response body is not shown.', 502); }
  const reader = response.body?.getReader(); if (!reader) throw new ProjectError('model-empty', 'The model server sent no response.', 502);
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > 2000000) throw new ProjectError('model-too-large', 'The model response is too large.', 502); chunks.push(r.value); } }
  finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectError('model-json', 'The model server did not send valid JSON.', 502); }
}
/** A plain object view of untrusted JSON; anything else becomes `{}`. */
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export type DiscoverOptions = { timeoutMs?: number; fetch?: typeof fetch };
/** A model a connection offers. `inputsKnown` is false when the provider does not say what the model takes. */
export type DiscoveredModel = { modelId: string; name: string; inputs: ModelChoice['inputs']; inputsKnown: boolean; maxChoices?: number };

/**
 * The models a connection offers, for a run profile to pick from.
 * - LLM providers: the OpenAI-style `GET {base}/models` list. Only OpenRouter says which models take images; for the
 *   others the inputs are unknown (`inputsKnown: false`) and the provider's default is assumed for a person to correct.
 * - Decision providers: OpenRouter's `models?output_modalities=decisions` (with input modalities); TypeSafe's `/models`
 *   when it has one; the Vercel AI Gateway's decision and evaluation models; custom servers are typed by hand (empty list).
 * A failure means the list is unavailable: registering the model ID by hand always works.
 */
export async function discover(target: Pick<DiscoverRequest, 'kind' | 'provider' | 'baseURL'>, apiKey?: string, options: DiscoverOptions = {}): Promise<DiscoveredModel[]> {
  const { kind, provider } = target, preset = (providerPreset({ kind, provider }) as ReturnType<typeof providerPreset> | undefined);
  if (!preset) throw new ProjectError('invalid-provider', `${provider} is not a provider of ${kind} models.`);
  if (provider === 'custom' && !target.baseURL) throw new ProjectError('invalid-base-url', 'A custom provider needs a server address.');
  const timeoutMs = options.timeoutMs ?? Math.min(RAWSTEP_DEFAULTS.modelTimeoutMs, 30000);
  if (kind === 'decision' && provider === 'custom') return [];
  if (kind === 'decision' && provider === 'gateway') {
    if (!apiKey) throw new ProjectError('missing-credential', 'Listing Vercel AI Gateway models needs its key. Enter the key first.');
    let models: { id: string; name: string }[];
    try { models = await listGatewayDecisionModels({ apiKey, signal: AbortSignal.timeout(timeoutMs), ...(options.fetch ? { fetch: options.fetch } : {}) }); }
    catch { throw new ProjectError('model-unreachable', 'Cannot read the Gateway model list. Check the key and the connection.', 502); }
    return models.map(m => ({ modelId: m.id, name: m.name, inputs: ['text'], inputsKnown: true }));
  }
  let base: URL;
  try { base = modelBaseURL(resolveBaseURL({ kind, provider, baseURL: target.baseURL })); }
  catch { throw new ProjectError('invalid-base-url', 'The server address must be an https:// URL (http:// only for a server on this computer) without credentials.'); }
  const fetcher = options.fetch ?? fetch;
  async function get(path: string) {
    try { return await boundedJson(await fetcher(new URL(path, base), {
      // Anthropic's model list is its native endpoint, which takes the key in x-api-key.
      headers: apiKey ? { authorization: 'Bearer ' + apiKey, ...(provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {}) } : {},
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    })); } catch (e) { if (e instanceof ProjectError) throw e; throw new ProjectError('model-unreachable', 'Cannot reach the model server. Check the address and that the server is running.', 502); }
  }
  const path = kind === 'decision' && provider === 'openrouter' ? 'models?output_modalities=decisions' : provider === 'anthropic' ? 'models?limit=1000' : 'models';
  const rows = record(await get(path)).data;
  if (!Array.isArray(rows)) throw new ProjectError('model-list-missing', 'The server has no model list API. Register the model ID and its input support by hand.', 502);
  const result: DiscoveredModel[] = [];
  for (const raw of rows) {
    const m = record(raw), arch = record(m.architecture), modalities = record(m.modalities);
    const listed = kind === 'decision' && typeof m.canonical_slug === 'string' ? m.canonical_slug : m.id;
    if (typeof listed !== 'string' || !listed || (apiKey && JSON.stringify(m).includes(apiKey))) continue;
    const modelId = provider === 'google' ? listed.replace(/^models\//, '') : listed;
    // OpenRouter's chat catalog also lists models that make images or audio; only text-producing models can choose.
    const output = Array.isArray(arch.output_modalities) ? arch.output_modalities : undefined;
    if (kind === 'llm' && output && (!output.includes('text') || output.includes('decisions'))) continue;
    const reported = arch.input_modalities ?? modalities.input ?? m.inputs;
    const confirmed = Array.isArray(reported) && reported.includes('text');
    const inputs: ModelChoice['inputs'] = ['text'];
    if (confirmed ? preset.images && reported.includes('image') : preset.images) inputs.push('image');
    if (result.some(v => v.modelId === modelId)) continue;
    const name = [m.name, m.display_name].find((v): v is string => typeof v === 'string' && !!v) ?? modelId;
    result.push({ modelId, name, inputs, inputsKnown: confirmed, ...(typeof m.maxChoices === 'number' ? { maxChoices: m.maxChoices } : {}) });
  }
  return result;
}
