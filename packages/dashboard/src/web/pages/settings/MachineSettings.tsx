import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle } from 'lucide-react';
import { AT_DRIVER_DEFAULTS, type MachineSettings as Machine } from '@rawstep/project/config';
import type { BrowserCheck } from '../../../shared/api';
import { ApiError, api } from '../../api';
import { SaveBar } from '../../components/conditions/SaveBar';
import { Field, Toggle } from '../../components/forms';
import { PageHeader, SectionHead } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/button';
import { environmentViewport, sameValue } from '../../lib/conditions';
import { cn } from '../../lib/utils';
import type { PageProps } from '../types';

/** What a check ended in, as the row shows it: nothing yet, running, ready, or not working with a kind of reason. */
type Status = { kind: 'unchecked' } | { kind: 'running' } | { kind: 'ready'; text: string; note?: string } | { kind: 'failed'; reason: string };
const NATIVE = ['voiceover', 'nvda'] as const;
type Native = (typeof NATIVE)[number];

/** A thing on this computer, whether it works, and the button that checks it. */
function StatusRow({ label, status, onCheck, busy, children }: { label: string; status: Status; onCheck?: () => void; busy?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  const Icon = status.kind === 'running' ? LoaderCircle : status.kind === 'ready' ? CircleCheck : status.kind === 'failed' ? CircleAlert : CircleHelp;
  return <div className="grid items-start gap-x-4 gap-y-1 rounded-md border border-edge bg-surface px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
    <div className="flex min-w-0 items-start gap-2">
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', status.kind === 'ready' ? 'text-reach' : status.kind === 'failed' ? 'text-missed' : 'text-muted-foreground', status.kind === 'running' && 'animate-spin')} />
      <div className="grid min-w-0 gap-0.5">
        <p><span className="font-medium">{label}</span> <span className="text-muted-foreground">·</span>{' '}
          {status.kind === 'ready' ? <span>{status.text}</span>
            : status.kind === 'failed' ? <span className="font-medium text-missed">{t('machine.env.failed')}</span>
              : status.kind === 'running' ? <span className="text-muted-foreground">{t('machine.env.running')}</span>
                : <span className="text-muted-foreground">{t('machine.env.unchecked')}</span>}
        </p>
        {status.kind === 'ready' && status.note && <p className="text-xs text-muted-foreground">{status.note}</p>}
        {status.kind === 'failed' && <p className="text-[13px] leading-5">{status.reason}</p>}
        {children}
      </div>
    </div>
    {onCheck && <Button variant="outline" size="sm" disabled={status.kind === 'running' || busy} onClick={onCheck}>{t('machine.env.check')}</Button>}
  </div>;
}

/**
 * 설정 · 이 컴퓨터: where this computer's browser and AT Driver servers are. Each group puts its state and its 확인 next to the
 * fields it depends on. A check starts a browser or talks to a driver, so it runs only when 확인 is pressed, never on page load.
 */
export function MachineSettings({ onDirty, ...props }: PageProps & { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [machine, setMachine] = useState<Machine>(() => structuredClone(config.machine));
  // The command that starts the AT Driver server lives in this computer's .env.local, not in the shared config: it runs a program.
  const [command, setCommand] = useState(''), [savedCommand, setSavedCommand] = useState('');
  useEffect(() => { void api<{ command: string }>('/machine/at-driver-command').then(result => { setCommand(result.command); setSavedCommand(result.command); }, () => {}); }, []);
  const storeCommand = async () => { if (command.trim() !== savedCommand) { const result = await api<{ command: string }>('/machine/at-driver-command', { method: 'PUT', body: { command } }); setSavedCommand(result.command); } };
  const [browser, setBrowser] = useState<Status>({ kind: 'unchecked' });
  const [drivers, setDrivers] = useState<Record<Native, Status>>({ voiceover: { kind: 'unchecked' }, nvda: { kind: 'unchecked' } });
  const dirty = !sameValue(machine, config.machine) || command.trim() !== savedCommand;
  useEffect(() => { onDirty(dirty); }, [dirty]);
  const updateMachine = (part: Partial<Machine>) => {
    setMachine({ ...machine, ...part });
    if ('browserExecutablePath' in part || 'browserEndpoint' in part) setBrowser({ kind: 'unchecked' });
    if ('atEndpoints' in part) setDrivers({ voiceover: { kind: 'unchecked' }, nvda: { kind: 'unchecked' } });
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
  async function checkDriver(backend: Native) {
    setDrivers(current => ({ ...current, [backend]: { kind: 'running' } }));
    let status: Status;
    try {
      await storeCommand();
      const result = await api<{ message: string }>('/backend/check', { method: 'POST', body: { backend, machine } });
      status = { kind: 'ready', text: t(`conditions.backends.${backend}`), note: result.message };
    } catch (error) { status = { kind: 'failed', reason: error instanceof ApiError && error.status === 0 ? t('machine.env.noServer') : error instanceof Error ? error.message : t('machine.env.driverFailed') }; }
    setDrivers(current => ({ ...current, [backend]: status }));
  }
  // Only this slice is written, on top of the latest config, so edits made on other pages are kept.
  const save = () => void props.act(async () => { await storeCommand(); await props.save({ ...props.view.config, machine }, undefined, props.view.revision); });
  const discard = () => { setMachine(structuredClone(config.machine)); setCommand(savedCommand); };
  const viewport = environmentViewport(config.pageEnvironments[0]!.profile, props.view.environmentPresets);
  const connected = !!machine.browserEndpoint.trim(), visible = machine.personCheck || connected || !machine.headless;
  return <div className="grid max-w-3xl gap-8">
    <PageHeader title={t('settingsNav.sections.machine')} info={t('machine.intro')} />

    <section aria-labelledby="machine-browser" className="grid gap-4">
      <SectionHead id="machine-browser" title={t('machine.browserTitle')} />
      <StatusRow label={t('machine.env.browser')} status={browser} busy={props.busy} onCheck={() => void checkBrowser()}>
        {browser.kind === 'unchecked' && <p className="text-xs leading-5 text-muted-foreground">{t(connected ? 'machine.env.browserConnectedHint' : 'machine.env.browserHint')}</p>}
      </StatusRow>
      <Field label={t('machine.browserEndpoint')} value={machine.browserEndpoint} onChange={browserEndpoint => updateMachine({ browserEndpoint })} placeholder="http://localhost:9222" info={t('machine.browserEndpointHint')} />
      <Field label={t('machine.browserPath')} value={machine.browserExecutablePath} onChange={browserExecutablePath => updateMachine({ browserExecutablePath })} placeholder={t('machine.browserPathPlaceholder')} info={t('machine.browserPathHint')} disabled={connected} />
      <Toggle label={t('machine.showBrowser')} info={t('machine.showBrowserHint')} checked={visible} disabled={machine.personCheck || connected} onChange={show => updateMachine({ headless: !show })} />
      <Toggle label={t('machine.personCheck')} info={t('machine.personCheckHint')} checked={machine.personCheck} onChange={personCheck => updateMachine({ personCheck })} />
      <p className="text-xs leading-5 text-muted-foreground">{t('machine.env.windowValue', { width: viewport.width, height: viewport.height, mode: t(visible ? 'machine.env.windowVisible' : 'machine.env.windowHidden') })} · {t('machine.env.windowHint')}</p>
    </section>

    <section aria-labelledby="machine-driver" className="grid gap-4">
      <SectionHead id="machine-driver" title={t('machine.driverTitle')} info={t('machine.driverIntro')} />
      {NATIVE.map(backend => <div key={backend} className="grid gap-2">
        <StatusRow label={t(`conditions.backends.${backend}`)} status={drivers[backend]} busy={props.busy} onCheck={() => void checkDriver(backend)} />
        <Field label={t(`machine.atEndpoint.${backend}`)} value={machine.atEndpoints[backend]} placeholder={AT_DRIVER_DEFAULTS[backend]} hint={t('machine.atEndpointHint')}
          onChange={value => updateMachine({ atEndpoints: { ...machine.atEndpoints, [backend]: value } })} />
      </div>)}
      <Field label={t('machine.atCommand')} value={command} placeholder={t('machine.atCommandPlaceholder')} info={t('machine.atCommandHint')} hint={savedCommand ? t('machine.atCommandSet') : t('machine.atCommandUnset')}
        onChange={next => { setCommand(next); setDrivers({ voiceover: { kind: 'unchecked' }, nvda: { kind: 'unchecked' } }); }} />
    </section>
    <SaveBar dirty={dirty} busy={props.busy} onSave={save} onDiscard={discard} />
  </div>;
}
