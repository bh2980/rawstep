import { modelBaseURL } from '@rawstep/policies/systemone';
import { connectionSchema, type Connection, type Model } from './config.js';
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
export async function discover(connection: Connection, apiKey?: string): Promise<Model[]> {
  connection = connectionSchema.parse(connection);
  const base = modelBaseURL(connection.baseURL);
  async function get(path: string) {
    try { return await boundedJson(await fetch(new URL(path, base), {
      headers: apiKey ? { authorization: 'Bearer ' + apiKey } : {}, redirect: 'error', signal: AbortSignal.timeout(Math.min(connection.timeoutMs, 30000)),
    })); } catch (e) { if (e instanceof ProjectError) throw e; throw new ProjectError('model-unreachable', 'Cannot reach the model server. Check the address and that the server is running.', 502); }
  }
  if (connection.provider === 'screenshot') {
    const info = record(await get('health')), model = record(info.model);
    const modelId = String(model.id ?? model.model ?? info.modelId ?? '');
    if (!modelId) throw new ProjectError('model-health-id', '/health has no model ID. Register the model ID by hand.', 502);
    return [{ id: 'discovered-0', connectionId: connection.id, modelId, name: modelId, family: 'SystemOne', protocol: 'choose', inputs: ['text', 'image'], capabilitySource: 'discovery', maxChoices: typeof info.maxChoices === 'number' ? info.maxChoices : 26, maxImages: typeof info.maxImages === 'number' ? info.maxImages : 2, roles: ['decision'], promptEditable: info.promptControl === 'client-v1' }];
  }
  const rows = record(await get('models')).data;
  if (!Array.isArray(rows)) throw new ProjectError('model-list-missing', 'The server has no model list API. Register the model ID and its input support by hand.', 502);
  let all: unknown[] = rows;
  if (connection.provider === 'openai') {
    // OpenRouter lists SystemOne decision models separately; other OpenAI-compatible servers just do not have this route.
    const decisions = record(await get('models?output_modalities=decisions').catch(() => undefined)).data;
    if (Array.isArray(decisions)) all = [...rows, ...decisions];
  }
  const result: Model[] = [];
  for (const raw of all) {
    const m = record(raw), arch = record(m.architecture), modalities = record(m.modalities);
    const modelId = typeof m.canonical_slug === 'string' ? m.canonical_slug : m.id;
    if (typeof modelId !== 'string' || !modelId || (apiKey && JSON.stringify(m).includes(apiKey))) continue;
    const output = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
    const protocol: Model['protocol'] = connection.provider === 'systemone' ? 'systemone-http' : output.includes('decisions') ? 'openrouter-decisions' : m.type === 'evaluation' ? 'vercel-evaluation' : 'chat';
    const family = protocol === 'chat' ? 'LLM' : 'SystemOne';
    const reported = arch.input_modalities ?? modalities.input ?? m.inputs;
    const confirmed = Array.isArray(reported) && reported.includes('text');
    const inputs: ('text' | 'image')[] = ['text'];
    if (confirmed && reported.includes('image')) inputs.push('image');
    if (result.some(v => v.modelId === modelId && v.family === family)) continue;
    result.push({
      id: 'discovered-' + result.length, connectionId: connection.id, modelId, name: typeof m.name === 'string' ? m.name : modelId, family, protocol, inputs,
      capabilitySource: confirmed ? 'discovery' : 'manual',
      maxChoices: typeof m.maxChoices === 'number' ? m.maxChoices : 255,
      maxImages: inputs.includes('image') ? 2 : 0, roles: family === 'LLM' ? ['decision', 'analysis'] : ['decision'], promptEditable: true,
    });
  }
  return result;
}
