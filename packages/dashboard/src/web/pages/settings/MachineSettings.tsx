import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle } from 'lucide-react';
import { AT_DRIVER_DEFAULTS, type MachineSettings as Machine } from '@rawstep/project/config';
import type { BrowserCheck } from '../../../shared/api';
import type { ServerMessage } from '../../../shared/messages';
import { serverText } from '../../i18n';
import { ApiError, api } from '../../api';
import { SaveBar } from '../../components/conditions/SaveBar';
import { Fold, Sheet, SheetRow } from '../../components/conditions/Sheet';
import { SectionHead } from '../../components/PageHeader';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { environmentViewport, sameValue } from '../../lib/conditions';
import { MAX_PARALLEL_RUNS, MIN_PARALLEL_RUNS, parseParallelRuns } from '../../lib/machine';
import { cn } from '../../lib/utils';
import type { PageProps } from '../types';

/** What a check ended in, as the row shows it: nothing yet, running, ready, or not working with a kind of reason. */
type Status = { kind: 'unchecked' } | { kind: 'running' } | { kind: 'ready'; text: string; note?: string } | { kind: 'failed'; reason: string };
/** How to start a Chrome Rawstep can connect to; a literal command, so it is not translated. */
const CHROME_CDP_COMMAND = 'chrome --remote-debugging-port=9222 --user-data-dir=<folder>';
const NATIVE = ['voiceover', 'nvda'] as const;
type Native = (typeof NATIVE)[number];

/** Whether a thing on this computer works, in one line, and the button that checks it. */
function StatusLine({ status, onCheck, busy, label }: { status: Status; onCheck: () => void; busy?: boolean; label: string }) {
  const { t } = useTranslation();
  const Icon = status.kind === 'running' ? LoaderCircle : status.kind === 'ready' ? CircleCheck : status.kind === 'failed' ? CircleAlert : CircleHelp;
  return <div className="grid gap-1">
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      <p role="status" className="flex min-w-0 items-center gap-1.5">
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', status.kind === 'ready' ? 'text-reach' : status.kind === 'failed' ? 'text-missed' : 'text-ink-2', status.kind === 'running' && 'animate-spin')} />
        {status.kind === 'ready' ? <span>{status.text}{status.note && <span className="text-ink-2"> · {status.note}</span>}</span>
          : status.kind === 'failed' ? <span className="font-medium text-missed">{t('machine.env.failed')}</span>
            : status.kind === 'running' ? <span className="text-ink-2">{t('machine.env.running')}</span>
              : <span className="text-ink-2">{t('machine.env.unchecked')}</span>}
      </p>
      <Button variant="outline" size="sm" aria-label={t('machine.env.checkAria', { name: label })} disabled={status.kind === 'running' || busy} onClick={onCheck}>{t('machine.env.check')}</Button>
    </div>
    {status.kind === 'failed' && <p>{status.reason}</p>}
  </div>;
}

/** A one-line text field in a sheet row, with an optional one-line hint under it. */
function TextRow({ label, value, onChange, placeholder, hint, type, invalid, onBlur, min, max, narrow, mono, children }: { children?: ReactNode; label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: ReactNode; type?: string; invalid?: boolean; onBlur?: () => void; min?: number; max?: number; narrow?: boolean; mono?: boolean }) {
  const id = useId();
  return <SheetRow label={label} htmlFor={id}>
    <Input id={id} type={type ?? 'text'} value={value} placeholder={placeholder} min={min} max={max} aria-invalid={invalid || undefined} onBlur={onBlur}
      aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => onChange(event.target.value)} className={cn(narrow ? 'w-20 tabular-nums' : 'max-w-xl', mono && 'font-mono')} />
    {hint && <p id={`${id}-hint`} className="mt-1 text-sm text-ink-2">{hint}</p>}
    {children}
  </SheetRow>;
}

/**
 * 설정 · 이 컴퓨터: where this computer's browser and AT Driver servers are. Each group puts its state and its 확인 next to the
 * fields it depends on. A check starts a browser or talks to a driver, so it runs only when 확인 is pressed, never on page load.
 */
export function MachineSettings({ onDirty, ...props }: PageProps & { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const idBase = useId();
  const config = props.view.config;
  const [machine, setMachine] = useState<Machine>(() => structuredClone(config.machine));
  // The command that starts the AT Driver server lives in this computer's .env.local, not in the shared config: it runs a program.
  const [command, setCommand] = useState(''), [savedCommand, setSavedCommand] = useState('');
  useEffect(() => { void api<{ command: string }>('/machine/at-driver-command').then(result => { setCommand(result.command); setSavedCommand(result.command); }, () => {}); }, []);
  const storeCommand = async () => { if (command.trim() !== savedCommand) { const result = await api<{ command: string }>('/machine/at-driver-command', { method: 'PUT', body: { command } }); setSavedCommand(result.command); } };
  // What is typed in 동시 실행 수: the machine keeps the last valid number, so a half-typed value never reaches the config.
  const [parallelText, setParallelText] = useState(() => String(config.machine.parallelRuns));
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
      const result = await api<{ message: ServerMessage }>('/backend/check', { method: 'POST', body: { backend, machine } });
      status = { kind: 'ready', text: t(`conditions.backends.${backend}`), note: serverText(result.message) };
    } catch (error) { status = { kind: 'failed', reason: error instanceof ApiError && error.status === 0 ? t('machine.env.noServer') : error instanceof Error ? error.message : t('machine.env.driverFailed') }; }
    setDrivers(current => ({ ...current, [backend]: status }));
  }
  // Only this slice is written, on top of the latest config, so edits made on other pages are kept.
  const save = () => void props.act(async () => { await storeCommand(); await props.save({ ...props.view.config, machine }, undefined, props.view.revision); });
  const discard = () => { setMachine(structuredClone(config.machine)); setCommand(savedCommand); setParallelText(String(config.machine.parallelRuns)); };
  const viewport = environmentViewport(config.profiles[0]!.page, props.view.environmentPresets);
  const connected = !!machine.browserEndpoint.trim(), visible = !machine.headless;
  const parallelOk = parseParallelRuns(parallelText) !== undefined;
  const showId = `${idBase}-show`;
  return <div className="grid gap-8">
    <section aria-labelledby="machine-browser" className="grid">
      <SectionHead id="machine-browser" title={t('machine.browserTitle')} />
      <Sheet>
        <SheetRow label={t('machine.env.browser')}>
          <StatusLine label={t('machine.env.browser')} status={browser} busy={props.busy} onCheck={() => void checkBrowser()} />
          {browser.kind === 'unchecked' && <p className="text-sm text-ink-2">{t(connected ? 'machine.env.browserConnectedHint' : 'machine.env.browserHint')}</p>}
        </SheetRow>
        <TextRow label={t('machine.browserEndpointShort')} value={machine.browserEndpoint} onChange={browserEndpoint => updateMachine({ browserEndpoint })} placeholder="http://localhost:9222" mono
          hint={t('machine.browserEndpointHint')}>
          <Fold label={t('machine.browserEndpointLaunch')} className="mt-1">
            <code className="block max-w-xl overflow-x-auto rounded-sm border border-edge bg-raised px-2.5 py-1.5 font-mono text-sm">{CHROME_CDP_COMMAND}</code>
            <p className="text-sm text-ink-2">{t('machine.browserEndpointTasks')}</p>
          </Fold>
        </TextRow>
        <TextRow label={t('machine.browserPath')} value={machine.browserExecutablePath} onChange={browserExecutablePath => updateMachine({ browserExecutablePath })} placeholder={t('machine.browserPathPlaceholder')} mono
          hint={t('machine.browserPathShort')} />
        <SheetRow label={t('machine.showBrowser')} htmlFor={showId}>
          <div className="flex min-h-8 items-center gap-3">
            <Switch id={showId} checked={visible} onCheckedChange={show => updateMachine({ headless: !show })} aria-describedby={`${showId}-hint`} />
            <span id={`${showId}-hint`} className="text-ink-2">{t('machine.env.windowValue', { width: viewport.width, height: viewport.height, mode: t(visible ? 'machine.env.windowVisible' : 'machine.env.windowHidden') })}</span>
          </div>
        </SheetRow>
        <TextRow label={t('machine.parallelRuns')} type="number" min={MIN_PARALLEL_RUNS} max={MAX_PARALLEL_RUNS} narrow value={parallelText} invalid={!parallelOk} hint={t('machine.parallelRunsHint')}
          onChange={text => { setParallelText(text); const count = parseParallelRuns(text); if (count !== undefined) updateMachine({ parallelRuns: count }); }}
          onBlur={() => setParallelText(String(machine.parallelRuns))} />
      </Sheet>
    </section>

    <section aria-labelledby="machine-driver" className="grid">
      <SectionHead id="machine-driver" title={t('machine.driverTitle')} />
      <p className="mb-2 text-ink-2">{t('machine.driverShort')}</p>
      <Sheet>
        {NATIVE.map(backend => <Fragment key={backend}>
          <SheetRow label={t(`conditions.backends.${backend}`)}>
            <StatusLine label={t(`conditions.backends.${backend}`)} status={drivers[backend]} busy={props.busy} onCheck={() => void checkDriver(backend)} />
          </SheetRow>
          <TextRow label={t(`machine.atEndpoint.${backend}`)} value={machine.atEndpoints[backend]} placeholder={AT_DRIVER_DEFAULTS[backend]} hint={t('machine.atEndpointHint')} mono
            onChange={value => updateMachine({ atEndpoints: { ...machine.atEndpoints, [backend]: value } })} />
        </Fragment>)}
        <TextRow label={t('machine.atCommand')} value={command} placeholder={t('machine.atCommandPlaceholder')} mono hint={savedCommand ? t('machine.atCommandSet') : t('machine.atCommandUnset')}
          onChange={next => { setCommand(next); setDrivers({ voiceover: { kind: 'unchecked' }, nvda: { kind: 'unchecked' } }); }} />
      </Sheet>
    </section>
    <SaveBar dirty={dirty} busy={props.busy} blocked={parallelOk ? undefined : t('machine.parallelRunsInvalid')} onSave={save} onDiscard={discard} />
  </div>;
}
