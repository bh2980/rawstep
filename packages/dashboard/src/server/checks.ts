import { RawstepError } from '@rawstep/core/errors';
import { createBrowserSession } from '@rawstep/browser/browser';
import { DecisionClient, type DecisionProviderName } from '@rawstep/policies/systemone';
import { providerPreset, resolveBaseURL, type MachineSettings, type Model } from '@rawstep/project/config';
import { discover } from '@rawstep/project/discover';
import { ProjectError } from '@rawstep/project/errors';
import type { BrowserCheck, CheckKind, ModelCheck } from '../shared/api.js';

type CheckedModel = Pick<Model, 'kind' | 'provider' | 'modelId' | 'baseURL' | 'inputs' | 'maxChoices' | 'maxImages'>;
type CheckOptions = { timeoutMs?: number; fetch?: typeof fetch };

const KINDS: Record<string, CheckKind> = {
  'model-unreachable': 'unreachable', 'model-http': 'rejected', 'invalid-base-url': 'invalid-address',
  'model-list-missing': 'unverified', 'missing-credential': 'missing-key',
};

const result = (kind: CheckKind, via: ModelCheck['via']): ModelCheck => ({ ok: kind === 'ready' || kind === 'unverified', kind, via, checkedAt: new Date().toISOString() });

/**
 * Asks the provider one cheap question and says whether the model can be used. The answer is a `CheckKind`; no text the provider
 * sent is kept or shown.
 * - LLMs and every provider with a model list (TypeSafe, OpenRouter and Gateway decision models too): the model list, which
 *   costs nothing. Ready means the server answered, the key was accepted and the model is in the list.
 * - A custom decision server has no list, so it gets one minimal two-choice decision through the same client a run uses.
 */
export async function checkModel(model: CheckedModel, apiKey: string | undefined, options: CheckOptions = {}): Promise<ModelCheck> {
  const preset = providerPreset(model), key = apiKey?.trim() || undefined;
  if (preset.keyRequired && !key) return result('missing-key', 'none');
  const timeoutMs = options.timeoutMs ?? 15000;
  if (model.kind === 'decision' && model.provider === 'custom') return checkDecisionServer(model, key, timeoutMs, options.fetch);
  const via = model.kind === 'decision' ? 'decision-catalog' : 'model-list';
  try {
    const listed = await discover({ kind: model.kind, provider: model.provider, ...(model.baseURL ? { baseURL: model.baseURL } : {}) }, key, { timeoutMs, ...(options.fetch ? { fetch: options.fetch } : {}) });
    if (listed.length === 0) return result('unverified', via);
    return result(listed.some(candidate => candidate.modelId === model.modelId) ? 'ready' : 'model-not-listed', via);
  } catch (error) {
    return result(error instanceof ProjectError ? KINDS[error.code] ?? 'failed' : 'failed', via);
  }
}

async function checkDecisionServer(model: CheckedModel, apiKey: string | undefined, timeoutMs: number, fetcher: typeof fetch | undefined): Promise<ModelCheck> {
  let client: DecisionClient;
  try {
    client = new DecisionClient({ provider: model.provider as DecisionProviderName, baseURL: resolveBaseURL(model), modelId: model.modelId, ...(apiKey ? { apiKey } : {}), timeoutMs,
      capabilities: { inputs: model.inputs, maxChoices: model.maxChoices, maxImages: model.maxImages }, ...(fetcher ? { fetch: fetcher } : {}) });
  } catch { return result('invalid-address', 'decision-call'); }
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    await client.prepare({ signal });
    await client.evaluate({ state: { check: 'connection' }, instructions: 'Choose option a.', choices: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] }, { signal });
    return result('ready', 'decision-call');
  } catch (error) {
    return result(error instanceof RawstepError && error.code === 'decision-timeout' ? 'timeout' : 'failed', 'decision-call');
  }
}

/**
 * Starts the browser a run would use (the configured executable, otherwise Playwright's Chromium, otherwise installed Chrome),
 * reads its version and closes it again. Always headless: checking never opens a window.
 */
export async function checkBrowser(machine: Pick<MachineSettings, 'browserExecutablePath'>): Promise<BrowserCheck> {
  const source = machine.browserExecutablePath.trim() ? 'custom' : 'auto';
  let session: Awaited<ReturnType<typeof createBrowserSession>> | undefined;
  try {
    session = await createBrowserSession('about:blank', { headless: true, observe: false, ...(source === 'custom' ? { executablePath: machine.browserExecutablePath.trim() } : {}) });
    return { ok: true, name: 'Chromium', version: session.browser.version(), source };
  } catch (error) {
    return { ok: false, kind: source === 'auto' && error instanceof RawstepError && error.code === 'browser-setup' ? 'not-found' : 'launch-failed', source };
  } finally { await session?.close().catch(() => undefined); }
}
