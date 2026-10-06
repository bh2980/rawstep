import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle } from 'lucide-react';
import { AT_DRIVER_DEFAULTS, type MachineSettings, type ProjectSettings } from '@rawstep/project/config';
import type { BrowserCheck } from '../../shared/api';
import { ApiError, api } from '../api';
import { SaveBar } from '../components/conditions/SaveBar';
import { Field, Toggle } from '../components/forms';
import { PageHeader } from '../components/layout/PageHeader';
import { ModelPicker } from '../components/ModelPicker';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { environmentViewport, sameValue } from '../lib/conditions';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

/** What a check ended in, as the row shows it: nothing yet, running, ready, or not working with a kind of reason. */
type Status = { kind: 'unchecked' } | { kind: 'running' } | { kind: 'ready'; text: string; note?: string } | { kind: 'failed'; reason: string };
const NATIVE = ['voiceover', 'nvda'] as const;
type Native = (typeof NATIVE)[number];
const same = sameValue;

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

/** A section heading with the note that what it sets never changes a run's outcome. */
function NoEffectHead({ id, title, intro }: { id: string; title: string; intro: string }) {
  const { t } = useTranslation();
  return <div className="grid gap-1 border-b border-edge-strong pb-1.5">
    <h3 id={id} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">{title}<span className="text-xs font-normal text-muted-foreground">{t('conditions.noEffect')}</span></h3>
    <p className="text-[13px] leading-5 text-muted-foreground">{intro}</p>
  </div>;
}

/**
 * 설정: what is not an experiment condition. 프로젝트 holds the shared settings that never change an outcome (the default analysis model
 * and the model that suggests completion checks); 이 컴퓨터 holds where this computer's browser and AT Driver servers are. A check
 * starts a browser or talks to a driver, so it runs only when 확인 is pressed, never on page load.
 */
export function SettingsPage(props: PageProps) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [project, setProject] = useState<ProjectSettings>(() => structuredClone(config.project));
  const [machine, setMachine] = useState<MachineSettings>(() => structuredClone(config.machine));
  // The command that starts the AT Driver server lives in this computer's .env.local, not in the shared config: it runs a program.
  const [command, setCommand] = useState(''), [savedCommand, setSavedCommand] = useState('');
  useEffect(() => { void api<{ command: string }>('/machine/at-driver-command').then(result => { setCommand(result.command); setSavedCommand(result.command); }, () => {}); }, []);
  const storeCommand = async () => { if (command.trim() !== savedCommand) { const result = await api<{ command: string }>('/machine/at-driver-command', { method: 'PUT', body: { command } }); setSavedCommand(result.command); } };
  const [browser, setBrowser] = useState<Status>({ kind: 'unchecked' });
  const [drivers, setDrivers] = useState<Record<Native, Status>>({ voiceover: { kind: 'unchecked' }, nvda: { kind: 'unchecked' } });
  const llms = config.connections.filter(c => c.kind === 'llm');
  const dirty = !same(project, config.project) || !same(machine, config.machine) || command.trim() !== savedCommand;
  const blocked = (project.analysis.model && !project.analysis.model.modelId.trim()) || (project.suggestions.model && !project.suggestions.model.modelId.trim()) ? t('settingsPage.missingModelId') : undefined;
  const updateMachine = (part: Partial<MachineSettings>) => {
    setMachine({ ...machine, ...part });
    if ('browserExecutablePath' in part) setBrowser({ kind: 'unchecked' });
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
  // Only these slices are written, on top of the latest config, so edits made on other pages are kept.
  const save = () => void props.act(async () => { await storeCommand(); await props.save({ ...props.view.config, project, machine }, undefined, props.view.revision); });
  const viewport = environmentViewport(config.pageEnvironments[0]!.profile, props.view.environmentPresets);
  const visible = machine.personCheck || !machine.headless;
  return <div className="grid max-w-3xl gap-5">
    <PageHeader title={t('settingsPage.heading')} description={t('settingsPage.intro')} />
    <SaveBar dirty={dirty} busy={props.busy} blocked={blocked} onSave={save} lead={<p className="text-[13px] leading-5 text-muted-foreground">{t('settingsPage.saveLead')}</p>} />
    <Tabs defaultValue="project" className="gap-5">
      <TabsList variant="line" aria-label={t('settingsPage.tabsLabel')}>
        <TabsTrigger value="project">{t('settingsPage.tabs.project')}</TabsTrigger>
        <TabsTrigger value="machine">{t('settingsPage.tabs.machine')}</TabsTrigger>
      </TabsList>

      <TabsContent value="project" className="grid gap-7">
        <section aria-labelledby="settings-analysis" className="grid gap-4">
          <NoEffectHead id="settings-analysis" title={t('settingsPage.analysis.title')} intro={t('settingsPage.analysis.intro')} />
          <ModelPicker label={t('settingsPage.analysis.model')} connections={llms} connectionId={project.analysis.model?.connectionId} modelId={project.analysis.model?.modelId ?? ''}
            none={t('settingsPage.analysis.rulesOnly')} onNone={() => { const { model: _removed, ...rest } = project.analysis; setProject({ ...project, analysis: rest }); }}
            onChange={next => setProject({ ...project, analysis: { ...project.analysis, model: { connectionId: next.connectionId, modelId: next.modelId } } })} />
          <Field label={t('settingsPage.analysis.instructions')} multiline value={project.analysis.instructions} onChange={instructions => setProject({ ...project, analysis: { ...project.analysis, instructions } })} hint={t('settingsPage.analysis.instructionsHint')} />
        </section>
        <section aria-labelledby="settings-suggestions" className="grid gap-4">
          <NoEffectHead id="settings-suggestions" title={t('settingsPage.suggestions.title')} intro={t('settingsPage.suggestions.intro')} />
          <ModelPicker label={t('settingsPage.suggestions.model')} connections={llms} connectionId={project.suggestions.model?.connectionId} modelId={project.suggestions.model?.modelId ?? ''}
            none={t('settingsPage.suggestions.sameAsAnalysis')} onNone={() => setProject({ ...project, suggestions: {} })}
            onChange={next => setProject({ ...project, suggestions: { model: { connectionId: next.connectionId, modelId: next.modelId } } })} />
        </section>
      </TabsContent>

      <TabsContent value="machine" className="grid gap-7">
        <p className="text-[13px] leading-5 text-muted-foreground">{t('machine.intro')}</p>
        <section aria-labelledby="machine-env" className="grid gap-1">
          <h3 id="machine-env" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('machine.env.title')}</h3>
          <dl className="grid">
            <EnvRow label={t('machine.env.browser')} status={browser} action={<Button variant="outline" size="sm" disabled={browser.kind === 'running' || props.busy} onClick={() => void checkBrowser()}>{t('machine.env.check')}</Button>}>
              {browser.kind === 'unchecked' && <p className="text-xs leading-5 text-muted-foreground">{t('machine.env.browserHint')}</p>}
            </EnvRow>
            {NATIVE.map(backend => <EnvRow key={backend} label={t(`conditions.backends.${backend}`)} status={drivers[backend]}
              action={<Button variant="outline" size="sm" disabled={drivers[backend].kind === 'running' || props.busy} onClick={() => void checkDriver(backend)}>{t('machine.env.check')}</Button>}>
              <p className="font-mono text-xs text-muted-foreground">{machine.atEndpoints[backend].trim() || AT_DRIVER_DEFAULTS[backend]}</p>
            </EnvRow>)}
            <EnvRow label={t('machine.env.window')} status={{ kind: 'ready', text: t('machine.env.windowValue', { width: viewport.width, height: viewport.height, mode: t(visible ? 'machine.env.windowVisible' : 'machine.env.windowHidden') }) }}>
              <p className="text-xs leading-5 text-muted-foreground">{t('machine.env.windowHint')}</p>
            </EnvRow>
          </dl>
        </section>

        <section aria-labelledby="machine-driver" className="grid gap-5">
          <div className="grid gap-1 border-b border-edge-strong pb-1.5">
            <h3 id="machine-driver" className="text-sm font-semibold">{t('machine.driverTitle')}</h3>
            <p className="text-[13px] leading-5 text-muted-foreground">{t('machine.driverIntro')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {NATIVE.map(backend => <Field key={backend} label={t(`machine.atEndpoint.${backend}`)} value={machine.atEndpoints[backend]} placeholder={AT_DRIVER_DEFAULTS[backend]}
              onChange={value => updateMachine({ atEndpoints: { ...machine.atEndpoints, [backend]: value } })} />)}
          </div>
          <p className="-mt-2 text-xs leading-5 text-muted-foreground">{t('machine.atEndpointHint')}</p>
          <Field label={t('machine.atCommand')} value={command} placeholder={t('machine.atCommandPlaceholder')} hint={t('machine.atCommandHint')}
            onChange={next => { setCommand(next); setDrivers({ voiceover: { kind: 'unchecked' }, nvda: { kind: 'unchecked' } }); }} />
          <p className="-mt-2 text-xs leading-5 text-muted-foreground">{savedCommand ? t('machine.atCommandSet') : t('machine.atCommandUnset')}</p>
        </section>

        <section aria-labelledby="machine-browser" className="grid gap-5">
          <h3 id="machine-browser" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('machine.browserTitle')}</h3>
          <Field label={t('machine.browserPath')} value={machine.browserExecutablePath} onChange={browserExecutablePath => updateMachine({ browserExecutablePath })} placeholder={t('machine.browserPathPlaceholder')} hint={t('machine.browserPathHint')} />
          <Toggle label={t('machine.showBrowser')} hint={t('machine.showBrowserHint')} checked={!machine.headless || machine.personCheck} disabled={machine.personCheck} onChange={show => updateMachine({ headless: !show })} />
          <Toggle label={t('machine.personCheck')} hint={t('machine.personCheckHint')} checked={machine.personCheck} onChange={personCheck => updateMachine({ personCheck })} />
        </section>
      </TabsContent>
    </Tabs>
  </div>;
}
