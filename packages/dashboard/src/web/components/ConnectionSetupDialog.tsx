import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check } from 'lucide-react';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { providersOf, type Connection, type ModelKind, type ProviderId } from '@rawstep/project/config';
import type { ModelCheck } from '../../shared/api';
import { ApiError, api } from '../api';
import { generateEnvName, providerTextKey } from '../lib/connections';
import { useGuardedAct } from '../lib/useGuardedAct';
import { cn } from '../lib/utils';
import type { PageProps } from '../pages/types';
import { Field, SecretField } from './forms';
import { CheckStatus, type CheckState } from './CheckStatus';
import { ConceptNote } from './layout/ConceptNote';
import { ErrorState } from './layout/ErrorState';
import { RadioRows } from './layout/RadioRows';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Step = 'kind' | 'provider' | 'check';
const STEPS: Step[] = ['kind', 'provider', 'check'];
const KINDS: ModelKind[] = ['decision', 'llm'];

/**
 * Add a connection in three steps: 1 종류, 2 제공자 (address and key), 3 연결 확인 (and its name). No model is picked here:
 * run profiles pick the model ID on a connection.
 */
export function ConnectionSetupDialog({ open, onOpenChange, pageProps }: { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{open && <SetupFlow pageProps={pageProps} close={() => onOpenChange(false)} />}</DialogContent>
  </Dialog>;
}

/** The steps as a numbered line; the current one is bold and marked as the current step, finished ones are ticked. */
function Stepper({ step }: { step: Step }) {
  const { t } = useTranslation();
  const at = STEPS.indexOf(step);
  return <ol aria-label={t('connections.stepsLabel')} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-edge pb-2.5 text-[13px]">
    {STEPS.map((id, index) => <li key={id} aria-current={id === step ? 'step' : undefined} className={cn('flex items-center gap-1.5', id === step ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
      {index < at ? <Check aria-hidden="true" className="size-3.5" /> : <span aria-hidden="true" className="font-mono tabular-nums">{index + 1}</span>}{t(`connections.steps.${id}.name`)}
    </li>)}
  </ol>;
}

function SetupFlow({ pageProps: props, close }: { pageProps: PageProps; close: () => void }) {
  const { t } = useTranslation();
  const { error, setError, run } = useGuardedAct(props.act);
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<ModelKind>('decision');
  const [provider, setProvider] = useState<ProviderId>();
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [check, setCheck] = useState<CheckState>();
  const attempt = useRef(0);
  const heading = useRef<HTMLDivElement>(null), mounted = useRef(false);
  useEffect(() => { if (mounted.current) heading.current?.focus(); mounted.current = true; }, [step]);

  const config = props.view.config;
  const providers = providersOf(kind);
  const preset = provider ? providers.find(p => p.id === provider)?.preset : undefined;
  const custom = provider === 'custom';
  const keySet = !!provider && !custom && !!props.view.credentialStatus[`provider:${provider}`];
  const key = apiKey.trim();
  const canConnect = !!provider && (!custom || !!baseURL.trim()) && (!preset?.keyRequired || keySet || !!key);
  const providerName = provider ? t(`connections.providers.${providerTextKey(kind, provider)}.name`) : '';

  const chooseKind = (next: ModelKind) => { setKind(next); setProvider(undefined); setBaseURL(''); setApiKey(''); setError(undefined); };
  const chooseProvider = (next: ProviderId) => { setProvider(next); setBaseURL(''); setApiKey(''); setError(undefined); };
  const toCheck = () => {
    if (!provider) return;
    setName(custom ? `${providerName} (${hostOf(baseURL)})` : providerName);
    setError(undefined); setStep('check');
  };

  /** Asks the provider once whether this address and key answer (its model list; a custom decision server gets one tiny decision). Nothing is saved. */
  async function runCheck() {
    if (!provider) return;
    const mine = ++attempt.current;
    setCheck({ state: 'running' });
    try {
      const result = await api<ModelCheck>('/connections/check', { method: 'POST', body: { kind, provider, ...(custom ? { baseURL: baseURL.trim() } : {}), ...(key ? { apiKey: key } : {}) } });
      if (mine === attempt.current) setCheck({ state: 'done', result });
    } catch (failure) { if (mine === attempt.current) setCheck({ state: 'failed', connection: failure instanceof ApiError && failure.status === 0 }); }
  }
  useEffect(() => { if (step === 'check') void runCheck(); else attempt.current++; }, [step]);

  async function add() {
    if (!provider || !name.trim()) return;
    const id = crypto.randomUUID();
    const apiKeyEnv = custom && key ? generateEnvName(config.connections) : undefined;
    const connection: Connection = { id, name: name.trim(), kind, provider, ...(custom ? { baseURL: baseURL.trim() } : {}), ...(apiKeyEnv ? { apiKeyEnv } : {}), timeoutMs: RAWSTEP_DEFAULTS.modelTimeoutMs };
    const ok = await run(async () => {
      // A preset provider keeps one key for all its connections; a custom server's key is stored under the connection's own variable.
      if (key && !custom) await api('/credentials', { method: 'POST', body: { provider, value: key } });
      await props.save({ ...props.view.config, connections: [...props.view.config.connections, connection] });
      if (apiKeyEnv) await api('/credentials', { method: 'POST', body: { connectionId: id, value: key } });
      setApiKey('');
    });
    if (ok) close();
  }
  const verdict = check?.state === 'done' ? check.result.ok : false;

  return <>
    <DialogHeader ref={heading} tabIndex={-1} className="outline-none">
      <DialogTitle>{t(`connections.steps.${step}.title`)}</DialogTitle>
      <DialogDescription>{t('connections.addTitle')} · {t('connections.step', { current: STEPS.indexOf(step) + 1, total: STEPS.length })} · {t(`connections.steps.${step}.description`)}</DialogDescription>
    </DialogHeader>
    <Stepper step={step} />
    {error && <ErrorState alert view={error} />}

    {step === 'kind' && <>
      <ConceptNote concept="decisionModel" />
      <RadioRows legend={t('connections.steps.kind.title')} value={kind} onChange={chooseKind}
        rows={KINDS.map(k => ({ id: k, label: t(`connections.kinds.${k}.name`), hint: t(`connections.kinds.${k}.description`), detail: t(`connections.kinds.${k}.use`) }))} />
      <DialogFooter><Button type="button" onClick={() => { setError(undefined); setStep('provider'); }}>{t('connections.next')}</Button></DialogFooter>
    </>}

    {step === 'provider' && <>
      <div className="grid gap-4">
        <RadioRows legend={t('connections.steps.provider.title')} value={provider ?? ('' as ProviderId)} onChange={chooseProvider}
          rows={providers.map(p => ({ id: p.id, label: t(`connections.providers.${providerTextKey(kind, p.id)}.name`), hint: t(`connections.providers.${providerTextKey(kind, p.id)}.description`) }))} />
        {custom && <Field label={t('connections.baseUrl')} value={baseURL} onChange={setBaseURL} placeholder={kind === 'llm' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:8000/v1'} hint={kind === 'llm' ? t('connections.baseUrlHintLlm') : t('connections.baseUrlHintDecision')} />}
        {provider && <SecretField label={preset?.keyRequired ? t('connections.apiKey') : t('connections.apiKeyOptional')} value={apiKey} onChange={setApiKey} saved={keySet} onReveal={custom ? undefined : async () => (await api<{ value: string | null }>('/credentials/reveal', { method: 'POST', body: { provider } })).value ?? undefined}
          hint={[keySet ? t('connections.keyAlreadySet') : preset?.keyRequired ? t('connections.keyRequiredHint') : t('connections.keyOptionalHint'), key ? t('connections.keyStoredHint') : undefined, !custom ? t('connections.keyShared') : undefined].filter(Boolean).join(' ')} />}
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(undefined); setStep('kind'); }}><ArrowLeft aria-hidden="true" />{t('connections.back')}</Button>
        <Button type="button" disabled={!canConnect} onClick={toCheck}>{t('connections.toCheck')}</Button>
      </DialogFooter>
    </>}

    {step === 'check' && <>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('connections.kind')}</dt><dd>{t(`connections.kinds.${kind}.name`)}</dd>
        <dt className="text-muted-foreground">{t('connections.provider')}</dt><dd>{providerName}</dd>
        {custom && <><dt className="text-muted-foreground">{t('connections.baseUrl')}</dt><dd className="font-mono text-[13px] break-all">{baseURL.trim()}</dd></>}
      </dl>
      <div className="grid gap-2 border-l-4 border-edge-strong bg-surface py-3 pl-4">
        {check && <CheckStatus check={check} />}
        <p className="text-xs leading-5 text-muted-foreground">{t(kind === 'decision' && custom ? 'connections.checkNoteDecision' : 'connections.checkNoteList')}</p>
      </div>
      <Field label={t('connections.name')} value={name} onChange={setName} hint={t('connections.nameHint')} />
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => { setError(undefined); setStep('provider'); }}><ArrowLeft aria-hidden="true" />{t('connections.back')}</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" disabled={check?.state === 'running'} onClick={() => void runCheck()}>{t('connections.checkAgain')}</Button>
          <Button type="button" variant={verdict ? 'default' : 'outline'} disabled={props.busy || check?.state === 'running' || !name.trim()} onClick={() => void add()}>{verdict ? t('connections.submit') : t('connections.addAnyway')}</Button>
        </div>
      </DialogFooter>
    </>}
  </>;
}

const hostOf = (url: string) => { try { return new URL(url.trim()).host; } catch { return url.trim(); } };
