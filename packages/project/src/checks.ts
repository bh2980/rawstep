import { providerPreset, type Connection, type Model } from './config.js';
import { discover } from './discover.js';
import { ProjectError } from './errors.js';

/**
 * Why a connection check did not end in `ready`. The words are the caller's own (the dashboard's, `rawstep doctor`'s); nothing a
 * provider sent is ever shown. `unverified` is not a failure: the server answered but gave no model list to confirm the model against.
 * `cli-missing` / `cli-signed-out`: a coding-agent CLI connection whose program is not installed, or that needs the person to sign in first.
 */
export type CheckKind = 'ready' | 'missing-key' | 'invalid-address' | 'unreachable' | 'rejected' | 'model-not-listed' | 'unverified' | 'failed' | 'cli-missing' | 'cli-signed-out';
export type ModelCheck = { ok: boolean; kind: CheckKind; /** What was asked: the model list, or a coding-agent CLI started over ACP. */ via: 'model-list' | 'agent' | 'none'; checkedAt: string };
/** A check with the failure behind it, for callers that say more than the kind (`rawstep doctor`: the HTTP status, a timeout). */
export type ModelInspection = { check: ModelCheck; cause?: ProjectError };
export type CheckedModel = Pick<Model, 'provider' | 'baseURL'> & { modelId?: string };
export type CheckOptions = { timeoutMs?: number; fetch?: typeof fetch };

/** Starting an agent CLI takes seconds, and a first npx download longer. */
const AGENT_TIMEOUT_MS = 120_000;

const KINDS: Record<string, CheckKind> = {
  'model-unreachable': 'unreachable', 'model-timeout': 'unreachable', 'model-http': 'rejected', 'invalid-base-url': 'invalid-address',
  'model-list-missing': 'unverified', 'missing-credential': 'missing-key', 'agent-missing': 'cli-missing', 'agent-signed-out': 'cli-signed-out',
};

/** A finished check of the given kind, stamped now. */
export const checkResult = (kind: CheckKind, via: ModelCheck['via']): ModelCheck => ({ ok: kind === 'ready' || kind === 'unverified', kind, via, checkedAt: new Date().toISOString() });

/**
 * Asks the provider one cheap question and says whether the key works and, when a model ID is given, whether that model can be used.
 * No text the provider sent is kept or shown.
 * - Every provider with a model list: the model list, which costs nothing. Ready means the server answered, the key was
 *   accepted and the model is in the list.
 * - Coding-agent CLIs: the agent is started over ACP and asked for its models (no prompt, nothing billed); a missing program
 *   and a missing sign-in are told apart. Rawstep never signs an agent in during a check.
 * Without a model ID a server that has no model list is `ready` (nothing to check against); with one it is `unverified`.
 */
export async function inspectModel(model: CheckedModel, apiKey: string | undefined, options: CheckOptions = {}): Promise<ModelInspection> {
  const preset = providerPreset(model), key = apiKey?.trim() || undefined;
  if (preset.keyRequired && !key) return { check: checkResult('missing-key', 'none') };
  const timeoutMs = options.timeoutMs ?? (preset.agent ? AGENT_TIMEOUT_MS : 15000);
  const via = preset.agent ? 'agent' : 'model-list';
  try {
    const listed = await discover({ provider: model.provider, ...(model.baseURL ? { baseURL: model.baseURL } : {}) }, key, { timeoutMs, ...(options.fetch ? { fetch: options.fetch } : {}) });
    if (model.modelId === undefined) return { check: checkResult('ready', via) };
    if (listed.length === 0) return { check: checkResult('unverified', via) };
    return { check: checkResult(listed.some(candidate => candidate.modelId === model.modelId) ? 'ready' : 'model-not-listed', via) };
  } catch (error) {
    const cause = error instanceof ProjectError ? error : undefined;
    return { check: checkResult(cause ? KINDS[cause.code] ?? 'failed' : 'failed', via), ...(cause ? { cause } : {}) };
  }
}

/** `inspectModel` for a model that must be listed, without the failure behind it. */
export async function checkModel(model: CheckedModel & { modelId: string }, apiKey: string | undefined, options: CheckOptions = {}): Promise<ModelCheck> {
  return (await inspectModel(model, apiKey, options)).check;
}

/** Whether a connection answers with its key, without a model: its model list. A list-less server is `unverified` until a model is checked. */
export async function checkConnection(connection: Pick<Connection, 'provider' | 'baseURL'>, apiKey: string | undefined, options: CheckOptions = {}): Promise<ModelCheck> {
  return (await inspectModel(connection, apiKey, options)).check;
}
