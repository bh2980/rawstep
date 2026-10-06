import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { credentialId, modelKeyEnv, providerPreset, type Model } from '@rawstep/project/config';
import { api } from '../api';
import { ENV_NAME, generateEnvName, providerTextKey, withAnalysis } from '../lib/modelSetup';
import { useGuardedAct } from '../lib/useGuardedAct';
import type { PageProps } from '../pages/types';
import { Field, MultiChoice, Panel, ReadonlyField, SecretField } from './forms';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';

/** Edit a registered model: name, model ID, endpoint and API key up front; rarely changed limits in a collapsed "advanced" section. The kind and provider are fixed; add the model again to change them. */
export function ModelEditDialog({ model, onClose, pageProps }: { model?: Model; onClose: () => void; pageProps: PageProps }) {
  return <Dialog open={!!model} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{model && <EditFlow key={model.id} initial={model} pageProps={pageProps} close={onClose} />}</DialogContent>
  </Dialog>;
}

function EditFlow({ initial, pageProps: props, close }: { initial: Model; pageProps: PageProps; close: () => void }) {
  const { t } = useTranslation();
  const { error, run } = useGuardedAct(props.act);
  const [model, setModel] = useState<Model>(() => structuredClone(initial));
  const [revision] = useState(props.view.revision);
  const [apiKey, setApiKey] = useState('');
  const patch = (part: Partial<Model>) => setModel({ ...model, ...part });
  const custom = model.provider === 'custom', preset = providerPreset(model), key = apiKey.trim();
  const envInvalid = custom && !!model.apiKeyEnv && !ENV_NAME.test(model.apiKeyEnv);
  const valid = !!model.name.trim() && !!model.modelId.trim() && !envInvalid && (!custom || !!model.baseURL?.trim()) && model.roles.length > 0 && model.inputs.length > 0;
  const keySet = !!props.view.credentialStatus[credentialId(model)] && !!modelKeyEnv(model);

  async function save() {
    const next: Model = { ...model, name: model.name.trim(), modelId: model.modelId.trim() };
    if (custom && key && !next.apiKeyEnv) next.apiKeyEnv = generateEnvName(props.view.config.models, next.id);
    const ok = await run(async () => {
      await props.save({ ...props.view.config, models: props.view.config.models.map(m => m.id === next.id ? next : m) }, undefined, revision);
      if (key) await api('/credentials', { method: 'POST', body: custom ? { modelId: next.id, value: key } : { provider: next.provider, value: key } });
    });
    if (ok) close();
  }

  const providerName = t(`modelSetup.providers.${providerTextKey(model.kind, model.provider)}.name`);
  const keyHint = [keySet ? t('modelSetup.keySavedHint') : t('modelSetup.keyEmptyHint'), !custom ? t('modelSetup.keySharedHint', { provider: providerName }) : undefined].filter(Boolean).join(' ');
  const reveal = async () => (await api<{ value: string | null }>('/credentials/reveal', { method: 'POST', body: custom ? { modelId: model.id } : { provider: model.provider } })).value ?? undefined;
  return <>
    <DialogHeader>
      <DialogTitle>{t('modelSetup.editTitle')}</DialogTitle>
      <DialogDescription>{t('modelSetup.editDescription')}</DialogDescription>
    </DialogHeader>
    {error && <ErrorState alert view={error} />}
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('modelSetup.typeLine', { kind: t(`modelSetup.kinds.${model.kind}.name`), provider: providerName })}</p>
      <Field label={t('modelSetup.displayName')} value={model.name} onChange={name => patch({ name })} />
      <Field label={t('modelSetup.modelId')} value={model.modelId} onChange={modelId => patch({ modelId })} />
      {custom
        ? <Field label={t('modelSetup.endpoint')} value={model.baseURL ?? ''} onChange={baseURL => patch({ baseURL })} />
        : <ReadonlyField label={t('modelSetup.endpoint')} value={preset.baseURL ?? t('modelSetup.endpointManaged')} hint={t('modelSetup.endpointPresetHint', { provider: providerName })} />}
      <SecretField label={t('modelSetup.apiKey')} value={apiKey} onChange={setApiKey} saved={keySet} onReveal={reveal} hint={keyHint} />
      {model.kind === 'llm' && <div className="flex items-center gap-2"><Checkbox id="edit-analysis" checked={model.roles.includes('analysis')} onCheckedChange={v => patch({ roles: withAnalysis(model.roles, v === true) })} /><Label htmlFor="edit-analysis" className="font-normal">{t('modelSetup.analysis')}</Label></div>}
    </div>
    <Panel title={t('modelSetup.advanced')} description={t('modelSetup.advancedDescription')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <MultiChoice label={t('modelSetup.inputSupport')} selected={model.inputs} onChange={inputs => patch({ inputs: inputs as Model['inputs'], maxImages: inputs.includes('image') ? Math.max(2, model.maxImages) : 0, capabilitySource: 'manual' })} items={[{ id: 'text', name: t('modelSetup.inputText') }, ...(preset.images ? [{ id: 'image', name: t('modelSetup.inputImage') }] : [])]} />
        <MultiChoice label={t('modelSetup.roles')} selected={model.roles} onChange={roles => patch({ roles: roles as Model['roles'] })} items={model.kind === 'llm' ? [{ id: 'decision', name: t('modelSetup.roleDecision') }, { id: 'analysis', name: t('modelSetup.roleAnalysis') }] : [{ id: 'decision', name: t('modelSetup.roleDecision') }]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('modelSetup.maxChoices')} type="number" value={String(model.maxChoices)} onChange={s => patch({ maxChoices: Number(s) })} />
        <Field label={t('modelSetup.maxImages')} type="number" value={String(model.maxImages)} onChange={s => patch({ maxImages: Number(s) })} />
        <Field label={t('modelSetup.timeout')} type="number" value={String(model.timeoutMs)} onChange={s => patch({ timeoutMs: Number(s) })} />
      </div>
      {custom && <Field label={t('modelSetup.envName')} value={model.apiKeyEnv ?? ''} onChange={v => { const { apiKeyEnv: _removed, ...rest } = model; setModel(v ? { ...rest, apiKeyEnv: v } : rest); }} hint={envInvalid ? t('modelSetup.envNameInvalid') : t('modelSetup.envNameHint')} />}
      <p className="text-xs leading-5 text-muted-foreground">{model.capabilitySource === 'discovery' ? t('modelSetup.metaFromServer') : t('modelSetup.metaManual')}</p>
    </Panel>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={close}>{t('modelSetup.cancel')}</Button>
      <Button type="button" disabled={props.busy || !valid} onClick={() => void save()}>{props.busy ? t('modelSetup.working') : t('modelSetup.save')}</Button>
    </DialogFooter>
  </>;
}
