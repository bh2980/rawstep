import { closeLlmModel, createAgentModel, createLlmModel, type LlmModel } from '@rawstep/policies/llm';
import { AcpAgent } from '@rawstep/policies/acp';
import { agentOf, resolveBaseURL, type Model } from './config.js';

/**
 * An LLM on its connection: a coding-agent CLI spoken to over ACP with the person's sign-in (started on first use; end it with
 * `closeLlmModel`), or an OpenAI-compatible endpoint.
 */
export function llmModelOf(model: Pick<Model, 'provider' | 'baseURL' | 'modelId' | 'timeoutMs' | 'reasoningEffort'>, name: string, apiKey?: string, fetcher?: typeof fetch): LlmModel {
  const agent = agentOf(model);
  if (agent) return createAgentModel({ agent: new AcpAgent(agent), modelId: model.modelId, timeoutMs: model.timeoutMs, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) });
  return createLlmModel({ baseURL: resolveBaseURL(model), modelId: model.modelId, apiKey, timeoutMs: model.timeoutMs, name, fetch: fetcher });
}
/** Starts an agent CLI ahead of its first call (its own time limit, not the task's); a no-op for an endpoint. */
export async function prepareLlmModel(llm: LlmModel, label: string, signal: AbortSignal): Promise<void> {
  if (!('agent' in llm)) return;
  try { await llm.agent.start(signal); }
  catch { signal.throwIfAborted(); throw new Error(`Could not start ${label}: check that the CLI is installed and signed in.`); }
}
export { closeLlmModel };
