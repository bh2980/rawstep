import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Search } from 'lucide-react';
import { buildModel, providersOf, type Model, type ModelKind, type ProviderId } from '@rawstep/project/config';
import type { ModelCheck } from '../../shared/api';
import { ApiError, api } from '../api';
import { generateEnvName, providerTextKey, usageKey, withAnalysis, withImages } from '../lib/modelSetup';
import { useGuardedAct } from '../lib/useGuardedAct';
import { cn } from '../lib/utils';
import type { PageProps } from '../pages/types';
import { Field, SecretField } from './forms';
import { ConceptNote } from './layout/ConceptNote';
import { ErrorState } from './layout/ErrorState';
import { RadioRows } from './layout/RadioRows';
import { ModelStatus, type CheckState } from './ModelStatus';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';

type Step = 'kind' | 'provider' | 'model' | 'check';
const STEPS: Step[] = ['kind', 'provider', 'model', 'check'];
const KINDS: ModelKind[] = ['llm', 'decision'];
const VISIBLE_LIMIT = 100;

/** Add a model in four steps: 1 종류, 2 제공자, 3 모델, 4 연결 확인. The last one asks the provider before anything is saved. */
export function ModelSetupDialog({ open, onOpenChange, pageProps }: { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{open && <SetupFlow pageProps={pageProps} close={() => onOpenChange(false)} />}</DialogContent>
  </Dialog>;
}

/** The four steps as a numbered line; the current one is bold and marked as the current step, finished ones are ticked. */
function Stepper({ step }: { step: Step }) {
  const { t } = useTranslation();
  const at = STEPS.indexOf(step);
  return <ol aria-label={t('modelSetup.stepsLabel')} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-edge pb-2.5 text-[13px]">
    {STEPS.map((id, index) => <li key={id} aria-current={id === step ? 'step' : undefined} className={cn('flex items-center gap-1.5', id === step ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
      {index < at ? <Check aria-hidden="true" className="size-3.5" /> : <span aria-hidden="true" className="font-mono tabular-nums">{index + 1}</span>}{t(`modelSetup.steps.${id}.name`)}
    </li>)}
  </ol>;
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
  const [check, setCheck] = useState<CheckState>();
  const attempt = useRef(0);
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

  const chooseKind = (next: ModelKind) => { setKind(next); setProvider(undefined); setBaseURL(''); setApiKey(''); setError(undefined); };
  const chooseProvider = (next: ProviderId) => { setProvider(next); setBaseURL(''); setApiKey(''); setDiscoverFailed(false); setError(undefined); };

  const startManual = () => { setError(undefined); setDiscovered([]); setSelected(undefined); setImages(false); setManual(true); setStep('model'); };
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
  const chosenModelId = (manual ? modelId : selected?.modelId ?? '').trim();
  const canAdd = !!provider && (manual ? !!modelId.trim() : !!selected) && !!displayName;
  const chosenInputs: ('text' | 'image')[] = unknownInputs ? (images ? ['text', 'image'] : ['text']) : selected?.inputs ?? ['text'];

  /** Asks the provider about this model: the model list for most, one small decision for a custom decision server. Nothing is saved. */
  async function runCheck() {
    if (!provider) return;
    const mine = ++attempt.current;
    setCheck({ state: 'running' });
    try {
      const result = await api<ModelCheck>('/models/check', { method: 'POST', body: { kind, provider, modelId: chosenModelId, inputs: chosenInputs, ...(custom ? { baseURL: baseURL.trim(), ...(key ? { apiKey: key } : {}) } : {}) } });
      if (mine === attempt.current) setCheck({ state: 'done', result });
    } catch (failure) { if (mine === attempt.current) setCheck({ state: 'failed', connection: failure instanceof ApiError && failure.status === 0 }); }
  }
  useEffect(() => { if (step === 'check') void runCheck(); else attempt.current++; }, [step]);

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
  const verdict = check?.state === 'done' ? check.result.ok : false;

  return <>
    <DialogHeader ref={heading} tabIndex={-1} className="outline-none">
      <DialogTitle>{manual && step === 'model' ? t('modelSetup.pick.manualTitle') : t(`modelSetup.steps.${step}.title`)}</DialogTitle>
      <DialogDescription>{t('modelSetup.addTitle')} · {t('modelSetup.step', { current: stepNo, total: STEPS.length })} · {t(`modelSetup.steps.${step}.description`)}</DialogDescription>
    </DialogHeader>
    <Stepper step={step} />
    {error && <ErrorState alert view={error} />}

    {step === 'kind' && <>
      <ConceptNote concept="decisionModel" />
      <RadioRows legend={t('modelSetup.steps.kind.title')} value={kind} onChange={chooseKind}
        rows={KINDS.map(k => ({ id: k, label: t(`modelSetup.kinds.${k}.name`), hint: t(`modelSetup.kinds.${k}.description`), detail: t(`modelSetup.kinds.${k}.use`) }))} />
      <DialogFooter><Button type="button" onClick={() => { setError(undefined); setStep('provider'); }}>{t('modelSetup.next')}</Button></DialogFooter>
    </>}

    {step === 'provider' && <>
      <div className="grid gap-4">
        <RadioRows legend={t('modelSetup.steps.provider.title')} value={provider ?? ('' as ProviderId)} onChange={chooseProvider}
          rows={providers.map(p => ({ id: p.id, label: t(`modelSetup.providers.${providerTextKey(kind, p.id)}.name`), hint: t(`modelSetup.providers.${providerTextKey(kind, p.id)}.description`) }))} />
        {custom && <Field label={t('modelSetup.connect.baseUrl')} value={baseURL} onChange={setBaseURL} placeholder={kind === 'llm' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:8000/v1'} hint={kind === 'llm' ? t('modelSetup.connect.baseUrlHintLlm') : t('modelSetup.connect.baseUrlHintDecision')} />}
        {provider && <SecretField label={preset?.keyRequired ? t('modelSetup.connect.apiKey') : t('modelSetup.connect.apiKeyOptional')} value={apiKey} onChange={setApiKey} saved={keySet} onReveal={custom ? undefined : async () => (await api<{ value: string | null }>('/credentials/reveal', { method: 'POST', body: { provider } })).value ?? undefined}
          hint={[keySet ? t('modelSetup.connect.keyAlreadySet') : preset?.keyRequired ? t('modelSetup.connect.keyRequiredHint') : t('modelSetup.connect.keyOptionalHint'), key ? t('modelSetup.connect.keyStoredHint') : undefined, !custom ? t('modelSetup.connect.keyShared') : undefined].filter(Boolean).join(' ')} />}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(undefined); setStep('kind'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
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
          <div role="group" aria-label={t('modelSetup.pick.listLabel')} className="grid max-h-64 divide-y divide-edge overflow-y-auto border border-edge-strong">
            {shown.map(m => <button key={m.id} type="button" aria-pressed={selected?.id === m.id} data-selected={selected?.id === m.id} onClick={() => pick(m)}
              className={cn('row-rail rail-divider grid min-w-0 gap-0.5 py-2.5 pr-4 pl-5 text-left', selected?.id === m.id ? 'bg-trace-soft' : 'hover:bg-raised')}>
              <span className="font-medium break-all">{m.name}{alreadyAdded(m) && <Badge variant="outline" className="ml-2 align-middle">{t('modelSetup.pick.added')}</Badge>}</span>
              <span className="text-xs text-muted-foreground">{capability(m)}</span>
            </button>)}
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
        <Button type="button" variant="ghost" onClick={() => { setError(undefined); setStep('provider'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {manual ? !!discovered.length && <Button type="button" variant="outline" onClick={() => setManual(false)}>{t('modelSetup.pick.toList')}</Button>
            : <Button type="button" variant="outline" onClick={() => { setManual(true); setImages(false); setError(undefined); }}>{t('modelSetup.connect.manual')}</Button>}
          <Button type="button" disabled={props.busy || !canAdd} onClick={() => { setError(undefined); setStep('check'); }}>{t('modelSetup.pick.next')}</Button>
        </div>
      </DialogFooter>
    </>}

    {step === 'check' && <>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('modelSetup.kind')}</dt><dd>{t(`modelSetup.kinds.${kind}.name`)}</dd>
        <dt className="text-muted-foreground">{t('modelSetup.provider')}</dt><dd>{provider ? t(`modelSetup.providers.${providerTextKey(kind, provider)}.name`) : ''}</dd>
        <dt className="text-muted-foreground">{t('modelSetup.pick.displayName')}</dt><dd className="break-all">{displayName}</dd>
        <dt className="text-muted-foreground">{t('modelSetup.modelId')}</dt><dd className="font-mono text-[13px] break-all">{chosenModelId}</dd>
      </dl>
      <div className="grid gap-2 border-l-4 border-edge-strong bg-surface py-3 pl-4">
        {check && <ModelStatus check={check} />}
        <p className="text-xs leading-5 text-muted-foreground">{t(kind === 'llm' || provider !== 'custom' ? 'modelSetup.check.noteList' : 'modelSetup.check.noteDecision')}</p>
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(undefined); setStep('model'); }}><ArrowLeft aria-hidden="true" />{t('modelSetup.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" disabled={check?.state === 'running'} onClick={() => void runCheck()}>{t('modelSetup.check.again')}</Button>
          <Button type="button" variant={verdict ? 'default' : 'outline'} disabled={props.busy || check?.state === 'running' || !canAdd} onClick={() => void add()}>{verdict ? t('modelSetup.pick.submit') : t('modelSetup.check.addAnyway')}</Button>
        </div>
      </DialogFooter>
    </>}
  </>;
}
