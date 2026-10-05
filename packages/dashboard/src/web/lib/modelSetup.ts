import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { manualProtocol, type Connection, type Model } from '../../shared/config';

type Provider = Connection['provider'];

/** Where a model can run. Technical details (provider id, default URL) stay out of the UI. An API key is always optional: local servers need none. */
export const PRESETS: readonly { provider: Provider; baseURL: string }[] = [
  { provider: 'openai', baseURL: 'https://openrouter.ai/api/v1' },
  { provider: 'systemone', baseURL: 'http://127.0.0.1:8000/v1' },
  { provider: 'screenshot', baseURL: 'http://127.0.0.1:8766' },
];
export const preset = (provider: Provider) => PRESETS.find(p => p.provider === provider)!;
/** Quick-fill addresses for OpenAI-compatible servers; any other compatible address can be typed. */
export const OPENAI_URLS: readonly { name: string; baseURL: string }[] = [
  { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { name: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1' },
  { name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' },
];

export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,100}$/;
const sameURL = (a: string, b: string) => a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');

/** An existing connection to the same server, so the user never sees duplicate connections. */
export const findConnection = (connections: Connection[], provider: Provider, baseURL: string) => connections.find(c => c.provider === provider && sameURL(c.baseURL, baseURL));

/** Env var name for a connection's key: RAWSTEP_<PROVIDER>_KEY, suffixed when another server already uses it. */
export function generateEnvName(connections: Connection[], provider: Provider, baseURL: string, selfId?: string): string {
  const base = `RAWSTEP_${provider.toUpperCase()}_KEY`;
  const taken = (name: string) => connections.some(c => c.id !== selfId && c.apiKeyEnv === name && !sameURL(c.baseURL, baseURL));
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

export function newConnection(connections: Connection[], provider: Provider, baseURL: string, label: string, apiKeyEnv?: string): Connection {
  const others = connections.filter(c => c.provider === provider);
  let name = label;
  if (others.length) { try { name = `${label} (${new URL(baseURL).host})`; } catch { /* keep the plain label */ } }
  return { id: crypto.randomUUID(), name, provider, baseURL: baseURL.trim(), ...(apiKeyEnv ? { apiKeyEnv } : {}), timeoutMs: RAWSTEP_DEFAULTS.modelTimeoutMs };
}

/** Model with plain defaults for when the server cannot list models: LLM text-only decision model (screenshot servers take images). */
export function manualModel(connection: Connection, modelId: string, name: string): Model {
  const screenshot = connection.provider === 'screenshot', family = connection.provider === 'openai' ? 'LLM' : 'SystemOne';
  return {
    id: crypto.randomUUID(), connectionId: connection.id, modelId, name, family, protocol: manualProtocol(connection, family),
    inputs: screenshot ? ['text', 'image'] : ['text'], capabilitySource: 'manual', maxChoices: screenshot ? 26 : 255, maxImages: screenshot ? 2 : 0,
    roles: ['decision'], promptEditable: !screenshot,
  };
}

/** Which Rawstep modes the model's inputs allow: keyboard mode sends screenshots, screenreader mode sends text. */
export const usageKey = (inputs: Model['inputs']): 'both' | 'textOnly' | 'imageOnly' => inputs.includes('image') ? (inputs.includes('text') ? 'both' : 'imageOnly') : 'textOnly';

/** Adds or removes the post-run analysis role, always keeping at least the decision role. */
export function withAnalysis(roles: Model['roles'], on: boolean): Model['roles'] {
  const next = on ? [...new Set([...roles, 'analysis' as const])] : roles.filter(r => r !== 'analysis');
  return next.length ? next : ['decision'];
}
