import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { Connection, Model } from '../../shared/config';
import { api } from '../api';
import { ENV_NAME, generateEnvName, withAnalysis } from '../lib/modelSetup';
import { useGuardedAct } from '../lib/useGuardedAct';
import type { PageProps } from '../pages/types';
import { Choice, Field, MultiChoice, Section } from './forms';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';

/** Edit a registered model: name and analysis use on top, everything technical inside a collapsed "advanced" section. */
export function ModelEditDialog({ model, onClose, pageProps }: { model?: Model; onClose: () => void; pageProps: PageProps }) {
  return <Dialog open={!!model} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{model && <EditFlow key={model.id} initial={model} pageProps={pageProps} close={onClose} />}</DialogContent>
  </Dialog>;
}

function EditFlow({ initial, pageProps: props, close }: { initial: Model; pageProps: PageProps; close: () => void }) {
  const { t } = useTranslation();
  const { error, run } = useGuardedAct(props.act);
  const connections = props.view.config.connections;
  const [model, setModel] = useState<Model>(() => structuredClone(initial));
  const [connection, setConnection] = useState<Connection | undefined>(() => structuredClone(connections.find(c => c.id === initial.connectionId)));
  const [revision] = useState(props.view.revision);
  const [apiKey, setApiKey] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const patch = (part: Partial<Model>) => setModel({ ...model, ...part });
  const editConnection = (part: Partial<Connection>) => connection && setConnection({ ...connection, ...part });
  const sharedBy = props.view.config.models.filter(m => m.connectionId === connection?.id).length;
  const key = apiKey.trim();
  const envInvalid = !!connection?.apiKeyEnv && !ENV_NAME.test(connection.apiKeyEnv);
  const valid = !!model.name.trim() && !!model.modelId.trim() && !!connection && !envInvalid && model.roles.length > 0 && model.inputs.length > 0;

  async function save() {
    if (!connection) return;
    const next: Connection = { ...connection };
    if (key && !next.apiKeyEnv) next.apiKeyEnv = generateEnvName(connections, next.provider, next.baseURL, next.id);
    const config = props.view.config;
    const ok = await run(async () => {
      await props.save({ ...config, connections: config.connections.map(c => c.id === next.id ? next : c), models: config.models.map(m => m.id === model.id ? { ...model, name: model.name.trim(), modelId: model.modelId.trim() } : m) }, undefined, revision);
      if (key) await api('/credentials', { method: 'POST', body: { connectionId: next.id, value: key } });
    });
    if (ok) close();
  }

  return <>
    <DialogHeader><DialogTitle>{t('modelSetup.editTitle')}</DialogTitle><DialogDescription>{t('modelSetup.editDescription')}</DialogDescription></DialogHeader>
    {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
    <div className="grid gap-4">
      <Field label={t('modelSetup.displayName')} value={model.name} onChange={name => patch({ name })} />
      {model.family === 'LLM' && <div className="flex items-center gap-2"><Checkbox id="edit-analysis" checked={model.roles.includes('analysis')} onCheckedChange={v => patch({ roles: withAnalysis(model.roles, v === true) })} /><Label htmlFor="edit-analysis" className="font-normal">{t('modelSetup.analysis')}</Label></div>}
    </div>
    <Collapsible open={advanced} onOpenChange={setAdvanced} className="grid gap-4 border-t pt-4">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="h-auto w-full justify-between p-0 text-left font-normal hover:bg-transparent">
          <span className="grid gap-1"><span className="font-medium">{t('modelSetup.advanced')}</span><span className="text-xs leading-5 text-muted-foreground">{t('modelSetup.advancedDescription')}</span></span>
          <ChevronDown aria-hidden="true" className={'shrink-0 transition-transform' + (advanced ? ' rotate-180' : '')} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-6">
        <div className="grid gap-4">
          <Field label={t('modelSetup.modelId')} value={model.modelId} onChange={modelId => patch({ modelId })} />
          <Choice label={t('modelSetup.useConnection')} value={model.connectionId} onChange={id => { patch({ connectionId: id }); setConnection(structuredClone(connections.find(c => c.id === id))); }} options={connections.map(c => ({ id: c.id, name: c.name }))} />
          <Choice label={t('modelSetup.family')} value={model.family} onChange={family => patch({ family: family as Model['family'], roles: family === 'SystemOne' ? ['decision'] : model.roles })} options={[{ id: 'SystemOne', name: t('modelSetup.familySystemOne') }, { id: 'LLM', name: t('modelSetup.familyLlm') }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <MultiChoice label={t('modelSetup.inputSupport')} selected={model.inputs} onChange={inputs => patch({ inputs: inputs as Model['inputs'], maxImages: inputs.includes('image') ? Math.max(2, model.maxImages) : 0, capabilitySource: 'manual' })} items={[{ id: 'text', name: t('modelSetup.inputText') }, { id: 'image', name: t('modelSetup.inputImage') }]} />
            <MultiChoice label={t('modelSetup.roles')} selected={model.roles} onChange={roles => patch({ roles: roles as Model['roles'] })} items={model.family === 'LLM' ? [{ id: 'decision', name: t('modelSetup.roleDecision') }, { id: 'analysis', name: t('modelSetup.roleAnalysis') }] : [{ id: 'decision', name: t('modelSetup.roleDecision') }]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('modelSetup.maxChoices')} type="number" value={String(model.maxChoices)} onChange={s => patch({ maxChoices: Number(s) })} />
            <Field label={t('modelSetup.maxImages')} type="number" value={String(model.maxImages)} onChange={s => patch({ maxImages: Number(s) })} />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{model.capabilitySource === 'discovery' ? t('modelSetup.metaFromServer') : t('modelSetup.metaManual')} {!model.promptEditable && t('modelSetup.promptNotEditable')}</p>
        </div>
        {connection && <Section title={t('modelSetup.connectionTitle')} description={sharedBy > 1 ? t('modelSetup.connectionShared', { count: sharedBy }) : undefined}>
          <Field label={t('modelSetup.connectionName')} value={connection.name} onChange={name => editConnection({ name })} />
          <Field label={t('modelSetup.baseUrl')} value={connection.baseURL} onChange={baseURL => editConnection({ baseURL })} />
          <Field label={t('modelSetup.apiKeyReenter')} type="password" value={apiKey} onChange={setApiKey} hint={(props.view.credentialStatus[connection.id] ? t('modelSetup.keySet') : t('modelSetup.keyMissing'))} />
          <Field label={t('modelSetup.envName')} value={connection.apiKeyEnv ?? ''} onChange={v => { const next = { ...connection }; if (v) next.apiKeyEnv = v; else delete next.apiKeyEnv; setConnection(next); }} hint={envInvalid ? t('modelSetup.envNameInvalid') : t('modelSetup.envNameHint')} />
          <Field label={t('modelSetup.timeout')} type="number" value={String(connection.timeoutMs)} onChange={s => editConnection({ timeoutMs: Number(s) })} />
        </Section>}
      </CollapsibleContent>
    </Collapsible>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={close}>{t('modelSetup.cancel')}</Button>
      <Button type="button" disabled={props.busy || !valid} onClick={() => void save()}>{props.busy ? t('modelSetup.working') : t('modelSetup.save')}</Button>
    </DialogFooter>
  </>;
}
