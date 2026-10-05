import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Search } from 'lucide-react';
import type { Connection, Model } from '../../shared/config';
import { api } from '../api';
import { Field, Choice, MultiChoice, SectionHeader } from '../components/forms';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import type { PageProps } from './types';

export function ModelsPage(props: PageProps) {
  const { t } = useTranslation();
  const [connection, setConnection] = useState<Connection>(() => structuredClone(props.view.config.connections[0] ?? { id: crypto.randomUUID(), name: t('modelsPage.newConnection'), provider: 'openai', baseURL: 'http://127.0.0.1:1234/v1', timeoutMs: RAWSTEP_DEFAULTS.modelTimeoutMs }));
  const [apiKey, setApiKey] = useState('');
  const [revision, setRevision] = useState(props.view.revision);
  const [discovered, setDiscovered] = useState<Model[]>([]);
  const [model, setModel] = useState<Model>();
  const update = (p: Partial<Connection>) => setConnection({ ...connection, ...p });
  async function saveConnection() {
    const saved = await props.save({ ...props.view.config, connections: [...props.view.config.connections.filter(c => c.id !== connection.id), connection] }, undefined, revision); setRevision(saved.revision);
    if (apiKey) { await api('/credentials', { method: 'POST', body: { connectionId: connection.id, value: apiKey } }); setApiKey(''); }
  }
  const newConnection = () => { setRevision(props.view.revision); setConnection({ id: crypto.randomUUID(), name: t('modelsPage.newConnection'), provider: 'openai', baseURL: 'http://127.0.0.1:1234/v1', timeoutMs: RAWSTEP_DEFAULTS.modelTimeoutMs }); setApiKey(''); setDiscovered([]); };
  const manual = () => setModel({ id: crypto.randomUUID(), connectionId: connection.id, modelId: '', name: t('modelsPage.newModel'), family: connection.provider === 'openai' ? 'LLM' : 'SystemOne', inputs: ['text'], capabilitySource: 'manual', maxChoices: 255, maxImages: 0, roles: ['decision'], promptEditable: connection.provider !== 'screenshot' });
  return <>
    <SectionHeader title={t('modelsPage.title')} description={t('modelsPage.description')}><Button onClick={newConnection}><Plus aria-hidden="true" />{t('modelsPage.addConnection')}</Button></SectionHeader>
    <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="grid content-start gap-4"><Card><CardContent className="grid gap-2 pt-4">{props.view.config.connections.map(c => <Button key={c.id} variant={c.id === connection.id ? 'secondary' : 'ghost'} className="justify-start truncate" onClick={() => { setRevision(props.view.revision); setConnection(structuredClone(c)); setDiscovered([]); setApiKey(''); }}>{c.name}</Button>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>{t('modelsPage.registeredModels')}</CardTitle></CardHeader><CardContent className="grid gap-2">{props.view.config.models.map(m => <Button key={m.id} variant="ghost" className="h-auto justify-start whitespace-normal text-left" onClick={() => { setRevision(props.view.revision); setModel(structuredClone(m)); }}>{m.name}<Badge variant="outline">{m.family}</Badge></Button>)}{!props.view.config.models.length && <p className="text-sm text-muted-foreground">{t('modelsPage.noModels')}</p>}</CardContent></Card></aside>
      <div className="grid content-start gap-6">
        <Card><CardHeader><CardTitle>{t('modelsPage.serverConnection')}</CardTitle></CardHeader><CardContent className="grid gap-4"><div className="grid gap-4 md:grid-cols-2"><Field label={t('modelsPage.connectionName')} value={connection.name} onChange={name => update({ name })} /><Choice label="Provider" value={connection.provider} onChange={provider => update({ provider: provider as Connection['provider'] })} options={[{ id: 'openai', name: t('modelsPage.providerOpenai') }, { id: 'systemone', name: 'SystemOne HTTP' }, { id: 'openrouter', name: 'OpenRouter' }, { id: 'vercel', name: 'Vercel Evaluation' }, { id: 'screenshot', name: t('modelsPage.providerScreenshot') }]} /></div><Field label={t('modelsPage.baseUrl')} value={connection.baseURL} onChange={baseURL => update({ baseURL })} hint={t('modelsPage.baseUrlHint')} />
          <div className="grid gap-4 md:grid-cols-2"><Field label={t('modelsPage.apiKeyEnv')} value={connection.apiKeyEnv ?? ''} onChange={apiKeyEnv => { const copy = { ...connection }; if (apiKeyEnv) copy.apiKeyEnv = apiKeyEnv; else delete copy.apiKeyEnv; setConnection(copy); }} hint={t('modelsPage.apiKeyEnvHint')} /><Field label={t('modelsPage.apiKey')} type="password" value={apiKey} onChange={setApiKey} hint={props.view.credentialStatus[connection.id] ? t('modelsPage.keyIsSet') : t('modelsPage.keyNotSet')} /></div>
          <Field label={t('modelsPage.requestTimeout')} type="number" value={String(connection.timeoutMs)} onChange={s => update({ timeoutMs: Number(s) })} />
          <div className="flex flex-wrap gap-2"><Button disabled={props.busy || (!!apiKey && !connection.apiKeyEnv)} onClick={() => void props.act(saveConnection)}><Save aria-hidden="true" />{t('modelsPage.saveConnection')}</Button><Button variant="outline" disabled={props.busy} onClick={() => void props.act(async () => { await saveConnection(); setDiscovered(await api<Model[]>('/discover', { method: 'POST', body: { connection } })); })}><Search aria-hidden="true" />{t('modelsPage.checkAndDiscover')}</Button><Button variant="outline" disabled={!props.view.config.connections.some(c => c.id === connection.id)} onClick={manual}>{t('modelsPage.registerManually')}</Button></div>
        </CardContent></Card>
        {discovered.length > 0 && <Card><CardHeader><CardTitle>{t('modelsPage.discoveredTitle', { count: discovered.length })}</CardTitle></CardHeader><CardContent className="grid max-h-96 gap-3 overflow-auto">{discovered.map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div className="min-w-0"><p className="break-all text-sm">{m.name}</p><p className="mt-1 text-xs text-muted-foreground">{m.family} · {m.inputs.join(' + ')} · {m.capabilitySource === 'discovery' ? t('modelsPage.discoveryKnown') : t('modelsPage.discoveryUnknown')}</p></div><Button variant="outline" size="sm" onClick={() => setModel({ ...m, id: crypto.randomUUID() })}>{t('modelsPage.registerAfterConfig')}</Button></div>)}</CardContent></Card>}
        {model && <Card><CardHeader><CardTitle>{t('modelsPage.modelSettings')}</CardTitle></CardHeader><CardContent className="grid gap-4"><Field label={t('modelsPage.modelDisplayName')} value={model.name} onChange={name => setModel({ ...model, name })} /><Field label={t('modelsPage.modelId')} value={model.modelId} onChange={modelId => setModel({ ...model, modelId })} /><Choice label={t('modelsPage.useConnection')} value={model.connectionId} onChange={connectionId => setModel({ ...model, connectionId })} options={props.view.config.connections.map(c => ({ id: c.id, name: c.name }))} /><Choice label={t('modelsPage.modelFamily')} value={model.family} onChange={family => setModel({ ...model, family: family as Model['family'], roles: family === 'SystemOne' ? ['decision'] : model.roles })} options={[{ id: 'SystemOne', name: t('modelsPage.familySystemOne') }, { id: 'LLM', name: t('modelsPage.familyLlm') }]} />
          <div className="grid gap-4 md:grid-cols-2"><MultiChoice label={t('modelsPage.inputSupport')} selected={model.inputs} onChange={inputs => setModel({ ...model, inputs: inputs as Model['inputs'], maxImages: inputs.includes('image') ? Math.max(2, model.maxImages) : 0, capabilitySource: 'manual' })} items={[{ id: 'text', name: t('modelsPage.inputText') }, { id: 'image', name: t('modelsPage.inputImage') }]} /><MultiChoice label={t('modelsPage.roles')} selected={model.roles} onChange={roles => setModel({ ...model, roles: roles as Model['roles'] })} items={model.family === 'LLM' ? [{ id: 'decision', name: t('modelsPage.roleDecision') }, { id: 'analysis', name: t('modelsPage.roleAnalysis') }] : [{ id: 'decision', name: t('modelsPage.roleDecision') }]} /></div>
          <div className="grid gap-4 md:grid-cols-2"><Field label={t('modelsPage.maxChoices')} type="number" value={String(model.maxChoices)} onChange={s => setModel({ ...model, maxChoices: Number(s) })} /><Field label={t('modelsPage.maxImages')} type="number" value={String(model.maxImages)} onChange={s => setModel({ ...model, maxImages: Number(s) })} /></div>
          <p className="text-xs leading-5 text-muted-foreground">{model.capabilitySource === 'discovery' ? t('modelsPage.metaFromServer') : t('modelsPage.metaManual')} {!model.promptEditable && t('modelsPage.promptNotEditable')}</p>
          <Button disabled={props.busy} onClick={() => void props.act(async () => { const saved = await props.save({ ...props.view.config, models: [...props.view.config.models.filter(m => m.id !== model.id), model] }, undefined, revision); setRevision(saved.revision); setModel(undefined); })}>{t('modelsPage.saveModel')}</Button>
        </CardContent></Card>}
      </div>
    </div>
  </>;
}
