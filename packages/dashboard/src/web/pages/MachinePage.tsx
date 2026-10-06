import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle, Save } from 'lucide-react';
import type { MachineSettings } from '@rawstep/project/config';
import type { BrowserCheck } from '../../shared/api';
import type { ConfigView } from '../../shared/config';
import { ApiError, api } from '../api';
import { Choice, Field, Toggle } from '../components/forms';
import { Button } from '../components/ui/button';
import { profileViewport } from '../lib/profileSummary';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

type Capabilities = ConfigView['capabilities'];

/** What a check ended in, as the row shows it: nothing yet, running, ready, or not working with a kind of reason. */
type Status = { kind: 'unchecked' } | { kind: 'running' } | { kind: 'ready'; text: string; note?: string } | { kind: 'failed'; reason: string };

function StatusMark({ status }: { status: Status }) {
  const { t } = useTranslation();
  const Icon = status.kind === 'running' ? LoaderCircle : status.kind === 'ready' ? CircleCheck : status.kind === 'failed' ? CircleAlert : CircleHelp;
  return <span className="flex items-start gap-2">
    <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', status.kind === 'ready' ? 'text-reach' : status.kind === 'failed' ? 'text-missed' : 'text-muted-foreground')} />
    <span className="grid gap-0.5">
      {status.kind === 'ready' && <><span className="font-semibold"><span lang="en">Ready</span> · {status.text}</span>{status.note && <span className="text-[13px] text-muted-foreground">{status.note}</span>}</>}
      {status.kind === 'failed' && <><span className="font-semibold">{t('machine.env.failed')}</span><span className="text-[13px] text-muted-foreground">{status.reason}</span></>}
      {status.kind === 'running' && <span className="text-muted-foreground">{t('machine.env.running')}</span>}
      {status.kind === 'unchecked' && <span className="text-muted-foreground">{t('machine.env.unchecked')}</span>}
    </span>
  </span>;
}

function EnvRow({ label, status, action, children }: { label: string; status: Status; action?: ReactNode; children?: ReactNode }) {
  return <div className="grid items-start gap-x-4 gap-y-1 border-b border-edge py-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
    <dt className="font-medium">{label}</dt>
    <dd className="grid min-w-0 gap-1"><StatusMark status={status} />{children}</dd>
    <div>{action}</div>
  </div>;
}

/**
 * This computer (spec §35): the environment first, as three lines of status (browser, screen reader driver, browser window), then the
 * fields that set it. A check starts a browser or talks to the driver, so it runs only when 확인 is pressed, never on page load.
 */
export function MachinePage({ onCapabilities, ...props }: PageProps & { onCapabilities: (capabilities: Capabilities) => void }) {
  const { t } = useTranslation();
  const [machine, setMachine] = useState<MachineSettings>(() => structuredClone(props.view.config.machine));
  const [browser, setBrowser] = useState<Status>({ kind: 'unchecked' }), [driver, setDriver] = useState<Status>({ kind: 'unchecked' });
  const native = machine.backend !== 'simulation';
  const update = (part: Partial<MachineSettings>) => { setMachine({ ...machine, ...part }); if ('browserExecutablePath' in part) setBrowser({ kind: 'unchecked' }); if ('backend' in part || 'atEndpoint' in part) setDriver({ kind: 'unchecked' }); };
  const changeBackend = (backend: string) => {
    const next = { ...machine, backend: backend as MachineSettings['backend'] };
    setMachine(next); setDriver({ kind: 'unchecked' });
    void props.act(async () => onCapabilities(await api<Capabilities>('/capabilities', { method: 'POST', body: { machine: next } })));
  };
  async function checkBrowser() {
    setBrowser({ kind: 'running' });
    try {
      const result = await api<BrowserCheck>('/browser/check', { method: 'POST', body: { machine } });
      setBrowser(result.ok
        ? { kind: 'ready', text: `${result.name} ${result.version}`, note: t(`machine.env.source.${result.source}`) }
        : { kind: 'failed', reason: t(`machine.env.browserFailed.${result.kind}`) });
    } catch (error) { setBrowser({ kind: 'failed', reason: error instanceof ApiError && error.status === 0 ? t('machine.env.noServer') : error instanceof Error ? error.message : t('machine.env.browserFailed.launch-failed') }); }
  }
  async function checkDriver() {
    setDriver({ kind: 'running' });
    try {
      await api<{ message: string }>('/backend/check', { method: 'POST', body: { machine } });
      setDriver({ kind: 'ready', text: t(`machine.backends.${machine.backend}`), note: t('machine.env.driverReadyNote') });
    } catch (error) { setDriver({ kind: 'failed', reason: error instanceof ApiError && error.status === 0 ? t('machine.env.noServer') : error instanceof Error ? error.message : t('machine.env.driverFailed') }); }
  }
  // Only this slice is written, on top of the latest config, so edits made in other settings tabs are kept.
  const save = () => void props.act(async () => { await props.save({ ...props.view.config, machine }, undefined, props.view.revision); });
  const viewport = profileViewport(props.view.config.profiles[0]!, props.view.environmentPresets);
  // A native screen reader run always opens a visible window.
  const visible = native || !machine.headless;
  return <div className="grid max-w-3xl gap-7">
    <div><h2 className="text-lg font-semibold tracking-tight">{t('machine.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('machine.intro')}</p></div>

    <section aria-labelledby="machine-env" className="grid gap-1">
      <h3 id="machine-env" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('machine.env.title')}</h3>
      <dl className="grid">
        <EnvRow label={t('machine.env.browser')} status={browser} action={<Button variant="outline" size="sm" disabled={browser.kind === 'running' || props.busy} onClick={() => void checkBrowser()}>{t('machine.env.check')}</Button>}>
          {browser.kind === 'unchecked' && <p className="text-xs leading-5 text-muted-foreground">{t('machine.env.browserHint')}</p>}
        </EnvRow>
        <EnvRow label={t('machine.env.driver')} status={native ? driver : { kind: 'ready', text: t('machine.backends.simulation'), note: t('machine.env.driverSimulationNote') }}
          action={native ? <Button variant="outline" size="sm" disabled={driver.kind === 'running' || props.busy} onClick={() => void checkDriver()}>{t('machine.env.check')}</Button> : undefined}>
          {native && <p className="font-mono text-xs text-muted-foreground">{machine.atEndpoint}</p>}
        </EnvRow>
        <EnvRow label={t('machine.env.window')} status={{ kind: 'ready', text: t('machine.env.windowValue', { width: viewport.width, height: viewport.height, mode: t(visible ? 'machine.env.windowVisible' : 'machine.env.windowHidden') }) }}>
          <p className="text-xs leading-5 text-muted-foreground">{native ? t('machine.env.windowNative') : t('machine.env.windowHint')}</p>
        </EnvRow>
      </dl>
    </section>

    <section aria-labelledby="machine-fields" className="grid gap-5">
      <h3 id="machine-fields" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('machine.fieldsTitle')}</h3>
      <Field label={t('machine.browserPath')} value={machine.browserExecutablePath} onChange={browserExecutablePath => update({ browserExecutablePath })} placeholder={t('machine.browserPathPlaceholder')} hint={t('machine.browserPathHint')} />
      <div className="grid gap-2">
        <Choice label={t('machine.backend')} value={machine.backend} onChange={changeBackend}
          options={[{ id: 'simulation', name: t('machine.backendSimulation') }, { id: 'voiceover', name: t('machine.backendVoiceover') }, { id: 'nvda', name: t('machine.backendNvda') }]} />
        <p className="text-xs leading-5 text-muted-foreground">{native ? t('machine.backendHintNative') : t('machine.backendHintSimulation')}</p>
      </div>
      {native && <Field label={t('machine.atEndpoint')} value={machine.atEndpoint} onChange={atEndpoint => update({ atEndpoint })} />}
      <Toggle label={t('machine.showBrowser')} hint={t('machine.showBrowserHint')} checked={!machine.headless} onChange={show => update({ headless: !show })} />
    </section>
    <div className="flex flex-wrap items-center gap-3 border-t border-edge-strong pt-4">
      <Button size="xl" disabled={props.busy} onClick={save}><Save aria-hidden="true" />{t('machine.save')}</Button>
      <p className="text-xs text-muted-foreground">{t('machine.saveHint')}</p>
    </div>
  </div>;
}
