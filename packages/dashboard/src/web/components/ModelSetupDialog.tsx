import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Search } from 'lucide-react';
import type { Connection, Model } from '../../shared/config';
import { api } from '../api';
import { findConnection, generateEnvName, manualModel, newConnection, preset, PRESETS, usageKey, withAnalysis } from '../lib/modelSetup';
import { useGuardedAct } from '../lib/useGuardedAct';
import type { PageProps } from '../pages/types';
import { Field } from './forms';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';

type Step = 'provider' | 'connect' | 'model';
const STEPS: Step[] = ['provider', 'connect', 'model'];
const VISIBLE_LIMIT = 100;

/** Step-by-step "add a model" dialog: where it runs, connection details, then pick a model. */
export function ModelSetupDialog({ open, onOpenChange, pageProps }: { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{open && <SetupFlow pageProps={pageProps} close={() => onOpenChange(false)} />}</DialogContent>
  </Dialog>;
}

function SetupFlow({ pageProps: props, close }: { pageProps: PageProps; close: () => void }) {
  const { t } = useTranslation();
  const { error, setError, run } = useGuardedAct(props.act);
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<Connection['provider']>('openrouter');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [revision, setRevision] = useState(props.view.revision);
  const [createdId, setCreatedId] = useState<string>();
  const [connectionId, setConnectionId] = useState<string>();
  const [discovered, setDiscovered] = useState<Model[]>([]);
  const [discoverFailed, setDiscoverFailed] = useState(false);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<Model>();
  const [filter, setFilter] = useState('');
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [analysis, setAnalysis] = useState(false);
  const heading = useRef<HTMLDivElement>(null), mounted = useRef(false);
  useEffect(() => { if (mounted.current) heading.current?.focus(); mounted.current = true; }, [step, manual]);

  const config = props.view.config, connections = config.connections, current = preset(provider);
  const target = connections.find(c => c.id === createdId) ?? findConnection(connections, provider, baseURL);
  const keySet = !!target && !!props.view.credentialStatus[target.id];
  const key = apiKey.trim();
  const canConnect = !!baseURL.trim() && (!current.keyRequired || !!key || keySet);
  const stepNo = STEPS.indexOf(step) + 1;
  const providerLabel = t(`modelSetup.presets.${provider}.name`);

  const choose = (p: Connection['provider']) => { setProvider(p); setBaseURL(preset(p).baseURL); setApiKey(''); setDiscoverFailed(false); setError(''); setStep('connect'); };

  async function connect() {
    await run(async () => {
      const url = baseURL.trim();
      const created = connections.find(c => c.id === createdId);
      const base = created ?? findConnection(connections, provider, url);
      let next: Connection;
      if (base) next = { ...base, ...(created ? { baseURL: url } : {}) };
      else next = newConnection(connections, provider, url, t(`modelSetup.where.${provider}`));
      if ((current.keyRequired || key) && !next.apiKeyEnv) next.apiKeyEnv = generateEnvName(connections, provider, url, next.id);
      if (!base || JSON.stringify(next) !== JSON.stringify(base)) {
        const saved = await props.save({ ...config, connections: [...config.connections.filter(c => c.id !== next.id), next] }, undefined, revision);
        setRevision(saved.revision);
      }
      if (!base || created) setCreatedId(next.id);
      setConnectionId(next.id);
      if (key) { await api('/credentials', { method: 'POST', body: { connectionId: next.id, value: key } }); setApiKey(''); }
      setDiscoverFailed(false);
      try {
        const found = await api<Model[]>('/discover', { method: 'POST', body: { connection: next } });
        setDiscovered(found); setManual(!found.length); setSelected(undefined); setFilter(''); setStep('model');
      } catch (e) { setDiscoverFailed(true); throw e; }
    });
  }
  const startManual = () => { setError(''); setDiscovered([]); setSelected(undefined); setManual(true); setStep('model'); };
  const pick = (m: Model) => { setSelected(m); setName(m.name); setNameEdited(true); setAnalysis(false); };

  const connection = connections.find(c => c.id === connectionId);
  const family = manual ? (connection?.provider === 'openai' ? 'LLM' : 'SystemOne') : selected?.family;
  const displayName = (manual && !nameEdited ? modelId : name).trim();
  const canAdd = !!connection && (manual ? !!modelId.trim() : !!selected) && !!displayName;
  async function add() {
    if (!connection) return;
    const base = manual ? manualModel(connection, modelId.trim(), displayName) : { ...selected!, id: crypto.randomUUID(), connectionId: connection.id, name: displayName };
    const model: Model = { ...base, name: displayName, roles: base.family === 'LLM' ? withAnalysis(['decision'], analysis) : ['decision'] };
    if (await run(async () => { const saved = await props.save({ ...props.view.config, models: [...props.view.config.models, model] }, undefined, revision); setRevision(saved.revision); })) close();
  }

  const lower = filter.trim().toLowerCase();
  const matches = discovered.filter(m => !lower || m.name.toLowerCase().includes(lower) || m.modelId.toLowerCase().includes(lower));
  const shown = matches.slice(0, VISIBLE_LIMIT);
  const alreadyAdded = (m: Model) => config.models.some(x => x.connectionId === connectionId && x.modelId === m.modelId && x.family === m.family);
  const capability = (m: Pick<Model, 'inputs' | 'capabilitySource'>) => t(`modelSetup.usage.${usageKey(m.inputs)}`) + (m.capabilitySource === 'manual' ? ` · ${t('modelSetup.pick.unknownInputs')}` : '');

  return <>
    <DialogHeader ref={heading} tabIndex={-1} className="outline-none">
      <DialogTitle>{manual && step === 'model' ? t('modelSetup.pick.manualTitle') : t(`modelSetup.steps.${step}.title`)}</DialogTitle>
      <DialogDescription>{t('modelSetup.addTitle')} · {t('modelSetup.step', { current: stepNo, total: STEPS.length })} · {t(`modelSetup.steps.${step}.description`)}</DialogDescription>
    </DialogHeader>
    {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}

    {step === 'provider' && <div className="grid gap-3" role="group" aria-label={t('modelSetup.steps.provider.title')}>
      {PRESETS.map(p => <Button key={p.provider} type="button" variant="outline" className="h-auto justify-start whitespace-normal px-4 py-3 text-left" onClick={() => choose(p.provider)}>
        <span className="grid gap-1"><span className="font-medium">{t(`modelSetup.presets.${p.provider}.name`)}</span><span className="text-xs font-normal leading-5 text-muted-foreground">{t(`modelSetup.presets.${p.provider}.description`)}</span></span>
      </Button>)}
    </div>}

    {step === 'connect' && <>
      <div className="grid gap-4">
        <p className="text-sm font-medium">{providerLabel}</p>
        <Field label={t('modelSetup.connect.baseUrl')} value={baseURL} onChange={setBaseURL} hint={provider === 'screenshot' ? t('modelSetup.connect.baseUrlHintScreenshot') : t('modelSetup.connect.baseUrlHint')} />
        <Field label={current.keyRequired ? t('modelSetup.connect.apiKeyRequired') : t('modelSetup.connect.apiKeyOptional')} type="password" value={apiKey} onChange={setApiKey}
          hint={(keySet ? t('modelSetup.connect.keyAlreadySet') + ' ' : '') + (current.keyRequired || key ? t('modelSetup.connect.keyStoredHint') : t('modelSetup.connect.keyOptionalHint'))} />
        {target && !createdId && <p className="text-xs leading-5 text-muted-foreground">{t('modelSetup.connect.reused')}</p>}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(''); setStep('provider'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {discoverFailed && <Button type="button" variant="outline" disabled={props.busy} onClick={startManual}>{t('modelSetup.connect.manual')}</Button>}
          <Button type="button" disabled={props.busy || !canConnect} onClick={() => void connect()}><Search aria-hidden="true" />{props.busy ? t('modelSetup.working') : t('modelSetup.connect.submit')}</Button>
        </div>
      </DialogFooter>
    </>}

    {step === 'model' && <>
      <div className="grid gap-4">
        {manual ? <>
          {!discovered.length && !discoverFailed && <p className="text-sm text-muted-foreground">{t('modelSetup.pick.empty')}</p>}
          <Field label={t('modelSetup.pick.manualModelId')} value={modelId} onChange={setModelId} hint={t('modelSetup.pick.manualHint')} />
        </> : <>
          <Field label={t('modelSetup.pick.filter')} value={filter} onChange={setFilter} placeholder={t('modelSetup.pick.filterPlaceholder')} hint={t('modelSetup.pick.summary', { total: discovered.length, shown: shown.length })} />
          <div role="group" aria-label={t('modelSetup.pick.listLabel')} className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-1">
            {shown.map(m => <Button key={m.id} type="button" variant={selected?.id === m.id ? 'secondary' : 'ghost'} aria-pressed={selected?.id === m.id} className="h-auto justify-start whitespace-normal px-3 py-2 text-left" onClick={() => pick(m)}>
              <span className="grid min-w-0 gap-0.5"><span className="break-all font-medium">{m.name}{alreadyAdded(m) && <Badge variant="outline" className="ml-2 align-middle">{t('modelSetup.pick.added')}</Badge>}</span><span className="text-xs font-normal text-muted-foreground">{capability(m)}</span></span>
            </Button>)}
            {!shown.length && <p className="p-3 text-sm text-muted-foreground">{t('modelSetup.pick.noMatch')}</p>}
          </div>
          {matches.length > shown.length && <p className="text-xs text-muted-foreground">{t('modelSetup.pick.truncated')}</p>}
        </>}
        {(manual || selected) && <>
          <Field label={t('modelSetup.pick.displayName')} value={manual && !nameEdited ? modelId : name} onChange={v => { setName(v); setNameEdited(true); }} />
          {family === 'LLM' && <div className="grid gap-1"><div className="flex items-center gap-2"><Checkbox id="setup-analysis" checked={analysis} onCheckedChange={v => setAnalysis(v === true)} aria-describedby="setup-analysis-hint" /><Label htmlFor="setup-analysis" className="font-normal">{t('modelSetup.pick.analysis')}</Label></div><p id="setup-analysis-hint" className="pl-6 text-xs leading-5 text-muted-foreground">{t('modelSetup.pick.analysisHint')}</p></div>}
        </>}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(''); setStep('connect'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {manual ? !!discovered.length && <Button type="button" variant="outline" onClick={() => setManual(false)}>{t('modelSetup.pick.toList')}</Button>
            : <Button type="button" variant="outline" onClick={() => { setManual(true); setError(''); }}>{t('modelSetup.connect.manual')}</Button>}
          <Button type="button" disabled={props.busy || !canAdd} onClick={() => void add()}>{t('modelSetup.pick.submit')}</Button>
        </div>
      </DialogFooter>
    </>}
  </>;
}
