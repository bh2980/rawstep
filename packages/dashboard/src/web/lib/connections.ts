import { agentOf, credentialId, modelKeyEnv, modelKeyRequired, type Connection } from '@rawstep/project/config';

export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,100}$/;

/** Env var name for the key of a custom server: RAWSTEP_CUSTOM_API_KEY, suffixed when another connection already uses it. */
export function generateEnvName(connections: readonly Connection[], selfId?: string): string {
  const base = 'RAWSTEP_CUSTOM_API_KEY';
  const taken = (name: string) => connections.some(c => c.id !== selfId && c.apiKeyEnv === name);
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

/** What the list says of a connection's key without asking anyone: needed and missing, set, or nothing to check (a local server that takes no key). */
export type KeyStatus = 'missing' | 'set' | 'unchecked';
export function keyStatus(connection: Pick<Connection, 'id' | 'provider' | 'apiKeyEnv'>, credentialStatus: Record<string, boolean>): KeyStatus {
  const required = modelKeyRequired(connection), used = required || !!modelKeyEnv(connection);
  if (!used) return 'unchecked';
  if (credentialStatus[credentialId(connection)]) return 'set';
  return required ? 'missing' : 'unchecked';
}

/** The i18n key of a connection's kind label under `connections.kinds`: an API LLM, or a coding-agent CLI. */
export const kindLabelKey = (connection: Pick<Connection, 'provider'>): 'agent' | 'llm' => agentOf(connection) ? 'agent' : 'llm';
