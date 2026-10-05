import { modelBaseURL } from '@rawstep/policies/systemone';
import { connectionSchema, type Connection, type Model } from '../shared/config.js';
import { HttpError } from './store.js';

export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, '모델 서버 HTTP ' + response.status + '. 응답 본문은 표시하지 않습니다.'); }
  const reader = response.body?.getReader(); if (!reader) throw new HttpError(502, '응답이 없습니다.');
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > 2000000) throw new HttpError(502, '모델 응답 크기 제한 초과'); chunks.push(r.value); } }
  finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(502, '모델 서버 JSON 형식 오류'); }
}
export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export async function discover(connection: Connection, apiKey?: string): Promise<Model[]> {
  connection = connectionSchema.parse(connection);
  const base = modelBaseURL(connection.baseURL);
  async function get(path: string) {
    try { return await boundedJson(await fetch(new URL(path, base), {
      headers: apiKey ? { authorization: 'Bearer ' + apiKey } : {}, redirect: 'error', signal: AbortSignal.timeout(Math.min(connection.timeoutMs, 30000)),
    })); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, '모델 서버에 연결할 수 없습니다. 주소와 서버 상태를 확인하세요.'); }
  }
  if (connection.provider === 'screenshot') {
    const info = record(await get('health')), model = record(info.model);
    const modelId = String(model.id ?? model.model ?? info.modelId ?? '');
    if (!modelId) throw new HttpError(502, '/health에 모델 ID가 없습니다. 모델 ID를 수동으로 등록하세요.');
    return [{ id: 'discovered-0', connectionId: connection.id, modelId, name: modelId, family: 'SystemOne', protocol: 'choose', inputs: ['text', 'image'], capabilitySource: 'discovery', maxChoices: typeof info.maxChoices === 'number' ? info.maxChoices : 26, maxImages: typeof info.maxImages === 'number' ? info.maxImages : 2, roles: ['decision'], promptEditable: info.promptControl === 'client-v1' }];
  }
  const rows = record(await get('models')).data;
  if (!Array.isArray(rows)) throw new HttpError(502, '모델 목록 API가 없습니다. 명시적인 모델 ID와 입력 지원을 수동으로 등록하세요.');
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
