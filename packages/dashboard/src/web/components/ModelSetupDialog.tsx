import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Search } from 'lucide-react';
import { buildModel, providersOf, type Model, type ModelKind, type ProviderId } from '@rawstep/project/config';
import { api } from '../api';
import { generateEnvName, providerTextKey, usageKey, withAnalysis, withImages } from '../lib/modelSetup';
import { useGuardedAct } from '../lib/useGuardedAct';
import type { PageProps } from '../pages/types';
import { Field } from './forms';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';

type Step = 'kind' | 'provider' | 'model';
const STEPS: Step[] = ['kind', 'provider', 'model'];
const KINDS: ModelKind[] = ['llm', 'decision'];
const VISIBLE_LIMIT = 100;

/** Step-by-step "add a model" dialog: the kind of model, its provider with the key, then the model itself. */
export function ModelSetupDialog({ open, onOpenChange, pageProps }: { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{open && <SetupFlow pageProps={pageProps} close={() => onOpenChange(false)} />}</DialogContent>
  </Dialog>;
}

function SetupFlow({ pageProps: props, close }: { pageProps: PageProps; close: () => void }) {
  const { t } = useTranslation();
  const { error, setError, run } = useGuardedAct(props.act);
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<ModelKind>('llm');
  const [provider, setProvider] = useState<ProviderId>();
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [discovered, setDiscovered] = useState<Model[]>([]);
  const [discoverFailed, setDiscoverFailed] = useState(false);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<Model>();
  const [filter, setFilter] = useState('');
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [analysis, setAnalysis] = useState(false);
  const [images, setImages] = useState(false);
  const heading = useRef<HTMLDivElement>(null), mounted = useRef(false);
  useEffect(() => { if (mounted.current) heading.current?.focus(); mounted.current = true; }, [step, manual]);

  const config = props.view.config;
  const providers = providersOf(kind);
  const preset = provider ? providers.find(p => p.id === provider)?.preset : undefined;
  const custom = provider === 'custom';
  const keySet = !!provider && !custom && !!props.view.credentialStatus[`provider:${provider}`];
  const key = apiKey.trim();
  const stepNo = STEPS.indexOf(step) + 1;
  const canConnect = !!provider && (!custom || !!baseURL.trim()) && (!preset?.keyRequired || keySet || !!key);
  const listed = !!preset?.listsModels;

  const chooseKind = (next: ModelKind) => { setKind(next); setProvider(undefined); setBaseURL(''); setApiKey(''); setError(''); setStep('provider'); };
  const chooseProvider = (next: ProviderId) => { setProvider(next); setBaseURL(''); setApiKey(''); setDiscoverFailed(false); setError(''); };

  const startManual = () => { setError(''); setDiscovered([]); setSelected(undefined); setImages(false); setManual(true); setStep('model'); };
  async function connect() {
    if (!provider) return;
    if (!listed) { startManual(); return; }
    await run(async () => {
      // A preset provider's key is stored at once (the list needs it); a custom server's key is stored with its model.
      if (key && !custom) { await api('/credentials', { method: 'POST', body: { provider, value: key } }); setApiKey(''); }
      setDiscoverFailed(false);
      try {
        const found = await api<Model[]>('/discover', { method: 'POST', body: { kind, provider, ...(custom ? { baseURL: baseURL.trim(), ...(key ? { apiKey: key } : {}) } : {}) } });
        setDiscovered(found); setManual(!found.length); setSelected(undefined); setFilter(''); setImages(false); setStep('model');
      } catch (e) { setDiscoverFailed(true); throw e; }
    });
  }
  const pick = (m: Model) => { setSelected(m); setName(m.name); setNameEdited(true); setAnalysis(false); setImages(m.inputs.includes('image')); };

  const unknownInputs = !!preset?.images && (manual || selected?.capabilitySource === 'manual');
  const displayName = (manual && !nameEdited ? modelId : name).trim();
  const canAdd = !!provider && (manual ? !!modelId.trim() : !!selected) && !!displayName;
  async function add() {
    if (!provider) return;
    const id = crypto.randomUUID();
    const apiKeyEnv = custom && key ? generateEnvName(config.models) : undefined;
    const base: Model = manual
      ? buildModel({ id, name: displayName, kind, provider, modelId: modelId.trim(), ...(custom ? { baseURL: baseURL.trim() } : {}), ...(apiKeyEnv ? { apiKeyEnv } : {}) })
      : { ...selected!, id, name: displayName, ...(apiKeyEnv ? { apiKeyEnv } : {}) };
    const withInputs = unknownInputs ? withImages(base, images) : base;
    const model: Model = { ...withInputs, name: displayName, roles: kind === 'llm' ? withAnalysis(['decision'], analysis) : ['decision'] };
    const ok = await run(async () => {
      await props.save({ ...props.view.config, models: [...props.view.config.models, model] });
      if (apiKeyEnv && key) { await api('/credentials', { method: 'POST', body: { modelId: id, value: key } }); setApiKey(''); }
    });
    if (ok) close();
  }

  const lower = filter.trim().toLowerCase();
  const matches = discovered.filter(m => !lower || m.name.toLowerCase().includes(lower) || m.modelId.toLowerCase().includes(lower));
  const shown = matches.slice(0, VISIBLE_LIMIT);
  const alreadyAdded = (m: Model) => config.models.some(x => x.kind === kind && x.provider === provider && x.modelId === m.modelId && x.baseURL === m.baseURL);
  const capability = (m: Pick<Model, 'inputs' | 'capabilitySource'>) => t(`modelSetup.usage.${usageKey(m.inputs)}`) + (m.capabilitySource === 'manual' ? ` · ${t('modelSetup.pick.unknownInputs')}` : '');

  return <>
    <DialogHeader ref={heading} tabIndex={-1} className="outline-none">
      <DialogTitle>{manual && step === 'model' ? t('modelSetup.pick.manualTitle') : t(`modelSetup.steps.${step}.title`)}</DialogTitle>
      <DialogDescription>{t('modelSetup.addTitle')} · {t('modelSetup.step', { current: stepNo, total: STEPS.length })} · {t(`modelSetup.steps.${step}.description`)}</DialogDescription>
    </DialogHeader>
    {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}

    {step === 'kind' && <div className="grid gap-3" role="group" aria-label={t('modelSetup.steps.kind.title')}>
      {KINDS.map(k => <Button key={k} type="button" variant="outline" className="h-auto justify-start whitespace-normal px-4 py-3 text-left" onClick={() => chooseKind(k)}>
        <span className="grid gap-1"><span className="font-medium">{t(`modelSetup.kinds.${k}.name`)}</span><span className="text-xs font-normal leading-5 text-muted-foreground">{t(`modelSetup.kinds.${k}.description`)}</span></span>
      </Button>)}
    </div>}

    {step === 'provider' && <>
      <div className="grid gap-4">
        <div className="grid gap-2" role="group" aria-label={t('modelSetup.steps.provider.title')}>
          {providers.map(p => <Button key={p.id} type="button" variant={provider === p.id ? 'secondary' : 'outline'} aria-pressed={provider === p.id} className="h-auto justify-start whitespace-normal px-4 py-3 text-left" onClick={() => chooseProvider(p.id)}>
            <span className="grid gap-1"><span className="font-medium">{t(`modelSetup.providers.${providerTextKey(kind, p.id)}.name`)}</span><span className="text-xs font-normal leading-5 text-muted-foreground">{t(`modelSetup.providers.${providerTextKey(kind, p.id)}.description`)}</span></span>
          </Button>)}
        </div>
        {custom && <Field label={t('modelSetup.connect.baseUrl')} value={baseURL} onChange={setBaseURL} placeholder={kind === 'llm' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:8000/v1'} hint={kind === 'llm' ? t('modelSetup.connect.baseUrlHintLlm') : t('modelSetup.connect.baseUrlHintDecision')} />}
        {provider && <Field label={preset?.keyRequired ? t('modelSetup.connect.apiKey') : t('modelSetup.connect.apiKeyOptional')} type="password" value={apiKey} onChange={setApiKey}
          hint={[keySet ? t('modelSetup.connect.keyAlreadySet') : preset?.keyRequired ? t('modelSetup.connect.keyRequiredHint') : t('modelSetup.connect.keyOptionalHint'), key ? t('modelSetup.connect.keyStoredHint') : undefined, !custom ? t('modelSetup.connect.keyShared') : undefined].filter(Boolean).join(' ')} />}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(''); setStep('kind'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {listed && discoverFailed && <Button type="button" variant="outline" disabled={props.busy} onClick={startManual}>{t('modelSetup.connect.manual')}</Button>}
          <Button type="button" disabled={props.busy || !canConnect} onClick={() => void connect()}>{listed && <Search aria-hidden="true" />}{props.busy ? t('modelSetup.working') : listed ? t('modelSetup.connect.submit') : t('modelSetup.connect.submitManual')}</Button>
        </div>
      </DialogFooter>
    </>}

    {step === 'model' && <>
      <div className="grid gap-4">
        {manual ? <>
          {!discovered.length && !discoverFailed && listed && <p className="text-sm text-muted-foreground">{t('modelSetup.pick.empty')}</p>}
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
          {unknownInputs && <div className="grid gap-1"><div className="flex items-center gap-2"><Checkbox id="setup-images" checked={images} onCheckedChange={v => setImages(v === true)} aria-describedby="setup-images-hint" /><Label htmlFor="setup-images" className="font-normal">{t('modelSetup.pick.images')}</Label></div><p id="setup-images-hint" className="pl-6 text-xs leading-5 text-muted-foreground">{t('modelSetup.pick.imagesHint')}</p></div>}
          {kind === 'llm' && <div className="grid gap-1"><div className="flex items-center gap-2"><Checkbox id="setup-analysis" checked={analysis} onCheckedChange={v => setAnalysis(v === true)} aria-describedby="setup-analysis-hint" /><Label htmlFor="setup-analysis" className="font-normal">{t('modelSetup.pick.analysis')}</Label></div><p id="setup-analysis-hint" className="pl-6 text-xs leading-5 text-muted-foreground">{t('modelSetup.pick.analysisHint')}</p></div>}
        </>}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(''); setStep('provider'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {manual ? !!discovered.length && <Button type="button" variant="outline" onClick={() => setManual(false)}>{t('modelSetup.pick.toList')}</Button>
            : <Button type="button" variant="outline" onClick={() => { setManual(true); setImages(false); setError(''); }}>{t('modelSetup.connect.manual')}</Button>}
          <Button type="button" disabled={props.busy || !canAdd} onClick={() => void add()}>{t('modelSetup.pick.submit')}</Button>
        </div>
      </DialogFooter>
    </>}
  </>;
}
