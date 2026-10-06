import { credentialId, modelKeyEnv, modelKeyRequired, type Connection, type ModelKind, type ProviderId } from '@rawstep/project/config';

export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,100}$/;

/** Env var name for the key of a custom server: RAWSTEP_CUSTOM_API_KEY, suffixed when another connection already uses it. */
export function generateEnvName(connections: readonly Connection[], selfId?: string): string {
  const base = 'RAWSTEP_CUSTOM_API_KEY';
  const taken = (name: string) => connections.some(c => c.id !== selfId && c.apiKeyEnv === name);
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

/** The i18n key group of one kind and provider (`connections.providers.<key>.name` / `.description`). */
export type ProviderTextKey = 'llmOpenai' | 'llmAnthropic' | 'llmGoogle' | 'llmOpenrouter' | 'llmCustom' | 'decisionTypesafe' | 'decisionGateway' | 'decisionOpenrouter' | 'decisionCustom';
export const providerTextKey = (kind: ModelKind, provider: ProviderId): ProviderTextKey => (kind + provider[0]!.toUpperCase() + provider.slice(1)) as ProviderTextKey;

/** What the list says of a connection's key without asking anyone: needed and missing, set, or nothing to check (a local server that takes no key). */
export type KeyStatus = 'missing' | 'set' | 'unchecked';
export function keyStatus(connection: Pick<Connection, 'id' | 'kind' | 'provider' | 'apiKeyEnv'>, credentialStatus: Record<string, boolean>): KeyStatus {
  const required = modelKeyRequired(connection), used = required || !!modelKeyEnv(connection);
  if (!used) return 'unchecked';
  if (credentialStatus[credentialId(connection)]) return 'set';
  return required ? 'missing' : 'unchecked';
}
