import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { modelBaseURL } from '@rawstep/policies/llm';
import { AcpAgent, AcpError } from '@rawstep/policies/acp';
import { providerPreset, resolveBaseURL, type DiscoverRequest } from './config.js';
import { commandOnPath } from './demo.js';
import { ProjectError } from './errors.js';

export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new ProjectError('model-http', 'The model server answered HTTP ' + response.status + '. The response body is not shown.', 502), { httpStatus: response.status }); }
  const reader = response.body?.getReader(); if (!reader) throw new ProjectError('model-empty', 'The model server sent no response.', 502);
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > 2000000) throw new ProjectError('model-too-large', 'The model response is too large.', 502); chunks.push(r.value); } }
  finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectError('model-json', 'The model server did not send valid JSON.', 502); }
}
/** A plain object view of untrusted JSON; anything else becomes `{}`. */
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export type DiscoverOptions = { timeoutMs?: number; fetch?: typeof fetch };
/**
 * A model a connection offers. `efforts`: the reasoning levels a coding-agent CLI offers (the same for each of its models), with its
 * own default as `defaultEffort`.
 */
export type DiscoveredModel = { modelId: string; name: string; efforts?: string[]; defaultEffort?: string };

/**
 * The models a connection offers, for a run profile to pick from.
 * - Coding-agent CLIs: the models the CLI offers the person's sign-in.
 * - LLM providers: the OpenAI-style `GET {base}/models` list, without models that do not produce text.
 * - Agent CLIs (Claude Code, Codex, ...): the agent is started, asked for its model list, and closed again. `default` leaves
 *   the choice to the agent's own setting.
 * A failure means the list is unavailable: registering the model ID by hand always works.
 */
export async function discover(target: Pick<DiscoverRequest, 'provider' | 'baseURL'>, apiKey?: string, options: DiscoverOptions = {}): Promise<DiscoveredModel[]> {
  const { provider } = target, preset = (providerPreset({ provider }) as ReturnType<typeof providerPreset> | undefined);
  if (!preset) throw new ProjectError('invalid-provider', `${provider} is not a provider Rawstep knows.`);
  if (provider === 'custom' && !target.baseURL) throw new ProjectError('invalid-base-url', 'A custom provider needs a server address.');
  const timeoutMs = options.timeoutMs ?? Math.min(RAWSTEP_DEFAULTS.modelTimeoutMs, 30000);
  if (preset.agent) {
    const agent = new AcpAgent(preset.agent);
    try {
      // Starting may download the adapter first: without an explicit limit it gets the agent start limit, not the list default.
      const info = await agent.start(options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
      const levels = info.efforts.length ? { efforts: info.efforts, ...(info.currentEffort ? { defaultEffort: info.currentEffort } : {}) } : {};
      return [{ modelId: 'default', name: info.currentModel && info.currentModel !== 'default' ? `Default (${info.currentModel})` : 'Default', ...levels },
        ...info.models.filter(m => m.value !== 'default').map(m => ({ modelId: m.value, name: m.name, ...levels }))];
    } catch (error) {
      const reason = error instanceof AcpError ? error.reason : undefined;
      if (reason === 'sign-in') throw new ProjectError('agent-signed-out', `${preset.label} needs a sign-in. ${preset.agent.signInHint}`, 502);
      if (reason === 'start-failed') {
        // `start-failed` is both "the program does not exist" and "it started but did not answer"; only the first is a missing install.
        if (!await commandOnPath(preset.agent.command)) throw new ProjectError('agent-missing', `${preset.agent.command} was not found on PATH. ${preset.agent.missingHint ?? `Install ${preset.label} first.`}`, 502);
        throw new ProjectError('agent-start-failed', `${preset.label} (${preset.agent.command}) started but did not answer in time, or failed while starting. Run \`${[preset.agent.command, ...preset.agent.args].join(' ')}\` by hand to see why; a first start can take a while when it downloads the adapter.`, 502);
      }
      throw new ProjectError('model-unreachable', `Cannot use ${preset.label}: ${(error instanceof Error ? error.message : String(error)).replace(/\.?$/, '.')} Check that it is installed and signed in.`, 502);
    }
    finally { await agent.close(); }
  }
  let base: URL;
  try { base = modelBaseURL(resolveBaseURL({ provider, baseURL: target.baseURL })); }
  catch { throw new ProjectError('invalid-base-url', 'The server address must be an https:// URL (http:// only for a server on this computer) without credentials.'); }
  const fetcher = options.fetch ?? fetch;
  async function get(path: string) {
    try { return await boundedJson(await fetcher(new URL(path, base), {
      // Anthropic's model list is its native endpoint, which takes the key in x-api-key.
      headers: apiKey ? { authorization: 'Bearer ' + apiKey, ...(provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {}) } : {},
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    })); } catch (e) {
      if (e instanceof ProjectError) throw e;
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new ProjectError('model-timeout', `The model server did not answer within ${Math.round(timeoutMs / 1000)} s.`, 502);
      throw new ProjectError('model-unreachable', 'Cannot reach the model server. Check the address and that the server is running.', 502);
    }
  }
  const path = provider === 'anthropic' ? 'models?limit=1000' : 'models';
  const rows = record(await get(path)).data;
  if (!Array.isArray(rows)) throw new ProjectError('model-list-missing', 'The server has no model list API. Register the model ID by hand.', 502);
  const result: DiscoveredModel[] = [];
  for (const raw of rows) {
    const m = record(raw), arch = record(m.architecture);
    const listed = m.id;
    if (typeof listed !== 'string' || !listed || (apiKey && JSON.stringify(m).includes(apiKey))) continue;
    const modelId = provider === 'google' ? listed.replace(/^models\//, '') : listed;
    // OpenRouter's chat catalog also lists models that make images or audio; only text-producing models can plan.
    const output = Array.isArray(arch.output_modalities) ? arch.output_modalities : undefined;
    if (output && (!output.includes('text') || output.includes('decisions'))) continue;
    if (result.some(v => v.modelId === modelId)) continue;
    const name = [m.name, m.display_name].find((v): v is string => typeof v === 'string' && !!v) ?? modelId;
    result.push({ modelId, name });
  }
  return result;
}
