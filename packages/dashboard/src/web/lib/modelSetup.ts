import type { Model, ModelKind, ProviderId } from '@rawstep/project/config';

export const ENV_NAME = /^[A-Z][A-Z0-9_]{0,100}$/;

/** Env var name for the key of a custom server: RAWSTEP_CUSTOM_API_KEY, suffixed when another model already uses it. */
export function generateEnvName(models: readonly Model[], selfId?: string): string {
  const base = 'RAWSTEP_CUSTOM_API_KEY';
  const taken = (name: string) => models.some(m => m.id !== selfId && m.apiKeyEnv === name);
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

/** Which Rawstep modes the model's inputs allow: keyboard mode sends screenshots, screenreader mode sends text. */
export const usageKey = (inputs: Model['inputs']): 'both' | 'textOnly' | 'imageOnly' => inputs.includes('image') ? (inputs.includes('text') ? 'both' : 'imageOnly') : 'textOnly';

/** Adds or removes the post-run analysis role, always keeping at least the decision role. */
export function withAnalysis(roles: Model['roles'], on: boolean): Model['roles'] {
  const next = on ? [...new Set([...roles, 'analysis' as const])] : roles.filter(r => r !== 'analysis');
  return next.length ? next : ['decision'];
}

/** The same model with image input switched on or off (two images for keyboard mode, none otherwise). */
export function withImages(model: Model, images: boolean): Model {
  return { ...model, inputs: images ? ['text', 'image'] : ['text'], maxImages: images ? Math.max(2, model.maxImages) : 0 };
}

/** The i18n key group of one kind and provider (`modelSetup.providers.<key>.name` / `.description`). */
export type ProviderTextKey = 'llmOpenai' | 'llmAnthropic' | 'llmGoogle' | 'llmOpenrouter' | 'llmCustom' | 'decisionTypesafe' | 'decisionGateway' | 'decisionOpenrouter' | 'decisionCustom';
export const providerTextKey = (kind: ModelKind, provider: ProviderId): ProviderTextKey => (kind + provider[0]!.toUpperCase() + provider.slice(1)) as ProviderTextKey;
