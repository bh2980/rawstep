import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Save } from 'lucide-react';
import { api } from '../api';
import { EnvironmentFields } from '../components/EnvironmentFields';
import { Choice, Field, Section } from '../components/forms';
import { PermissionsEditor } from '../components/PermissionsEditor';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { defaultConfig, type DashboardConfig } from '../../shared/config';
import type { PageProps } from './types';

/** Switch with a label and a one-line plain explanation. */
function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="grid gap-1"><div className="flex items-center gap-3"><Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={id + '-hint'} /><Label htmlFor={id}>{label}</Label></div><p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p></div>;
}

export function SettingsPage(props: PageProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<DashboardConfig>(() => structuredClone(props.view.config));
  const [revision, setRevision] = useState(props.view.revision);
  const [environments, setEnvironments] = useState(JSON.stringify(config.environments, null, 2));
  const [capabilities, setCapabilities] = useState(props.view.capabilities);
  const [backendStatus, setBackendStatus] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const globals = config.globals;
  const native = globals.backend !== 'simulation';
  const update = (part: Partial<typeof globals>) => setConfig({ ...config, globals: { ...globals, ...part } });
  const policy = (part: Partial<typeof globals.policy>) => update({ policy: { ...globals.policy, ...part } });
  const reset = () => {
    const defaults = defaultConfig();
    setConfig({ ...config, globals: defaults.globals }); setEnvironments(JSON.stringify(defaults.environments, null, 2)); setBackendStatus('');
    void props.act(async () => setCapabilities(await api<typeof capabilities>('/capabilities', { method: 'POST', body: { globals: defaults.globals } })));
  };
  const save = () => void props.act(async () => { const saved = await props.save({ ...config, environments: JSON.parse(environments) }, undefined, revision); setRevision(saved.revision); });
  const changeBackend = (backend: string) => {
    const next = { ...globals, backend: backend as typeof globals.backend };
    update({ backend: next.backend }); setBackendStatus('');
    void props.act(async () => setCapabilities(await api<typeof capabilities>('/capabilities', { method: 'POST', body: { globals: next } })));
  };
  return <div className="grid gap-6">
    <div><h2 className="text-lg font-semibold tracking-tight">{t('runSettings.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('runSettings.intro')}</p></div>
    <div className="grid gap-5">
      <Toggle id="show-browser" label={t('runSettings.showBrowser')} hint={t('runSettings.showBrowserHint')} checked={!globals.headless} onChange={show => update({ headless: !show })} />
      <div className="grid gap-2">
        <Choice label={t('runSettings.backend')} value={globals.backend} onChange={changeBackend} options={[{ id: 'simulation', name: t('runSettings.backendSimulation') }, { id: 'voiceover', name: t('runSettings.backendVoiceover') }, { id: 'nvda', name: t('runSettings.backendNvda') }]} />
        <p className="text-xs leading-5 text-muted-foreground">{native ? t('runSettings.backendHintNative') : t('runSettings.backendHintSimulation')}</p>
      </div>
      {native && <div className="grid gap-4">
        <Field label={t('runSettings.atEndpoint')} value={globals.atEndpoint} onChange={atEndpoint => update({ atEndpoint })} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={props.busy} onClick={() => void props.act(async () => { const result = await api<{ message: string }>('/backend/check', { method: 'POST', body: { globals } }); setBackendStatus(result.message); })}>{t('runSettings.checkBackend')}</Button>
          {backendStatus && <p role="status" className="text-sm text-primary">{backendStatus}</p>}
        </div>
      </div>}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={props.busy} onClick={save}><Save aria-hidden="true" />{t('runSettings.save')}</Button>
      <Button variant="outline" onClick={reset}>{t('runSettings.reset')}</Button>
      <p className="text-xs text-muted-foreground">{t('runSettings.resetHint')}</p>
    </div>
    <Collapsible open={advanced} onOpenChange={setAdvanced} asChild>
      <Card>
        <CardHeader>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="h-auto w-full justify-between p-0 text-left font-normal hover:bg-transparent">
              <span className="grid gap-1"><CardTitle>{t('runSettings.advancedTitle')}</CardTitle><CardDescription>{t('runSettings.advancedDescription')}</CardDescription></span>
              <ChevronDown aria-hidden="true" className={'shrink-0 transition-transform' + (advanced ? ' rotate-180' : '')} />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-6">
            <Section title={t('runSettings.permissionsTitle')} description={t('runSettings.permissionsDescription')}>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="grid content-start gap-3"><h4 className="text-sm font-medium">{t('runSettings.keyboardPermissions')}</h4><PermissionsEditor value={globals.keyboard} onChange={keyboard => update({ keyboard })} capabilities={capabilities.keyboard} /></div>
                <div className="grid content-start gap-3"><h4 className="text-sm font-medium">{t('runSettings.screenreaderPermissions')}</h4><PermissionsEditor value={globals.screenreader} onChange={screenreader => update({ screenreader })} capabilities={capabilities.screenreader} /></div>
              </div>
            </Section>
            <Section title={t('runSettings.stuckTitle')} description={t('runSettings.stuckDescription')}>
              <Field label={t('runSettings.historyLimit')} type="number" value={String(globals.policy.historyLimit)} onChange={s => policy({ historyLimit: Number(s) })} hint={t('runSettings.historyLimitHint')} />
              <Field label={t('runSettings.maxStateVisits')} type="number" value={String(globals.policy.maxStateVisits)} onChange={s => policy({ maxStateVisits: Number(s) })} hint={t('runSettings.maxStateVisitsHint')} />
              <Field label={t('runSettings.maxUnchangedTransitions')} type="number" value={String(globals.policy.maxUnchangedTransitions)} onChange={s => policy({ maxUnchangedTransitions: Number(s) })} hint={t('runSettings.maxUnchangedTransitionsHint')} />
              <Toggle id="focus-gate" label={t('runSettings.focusGate')} hint={t('runSettings.focusGateHint')} checked={globals.policy.focusGate} onChange={focusGate => policy({ focusGate })} />
              <div className="grid gap-2">
                <Choice label={t('runSettings.repetitionGuard')} value={globals.policy.repetitionGuard} onChange={repetitionGuard => policy({ repetitionGuard: repetitionGuard as typeof globals.policy.repetitionGuard })} options={[{ id: 'auto', name: t('runSettings.repetitionAuto') }, { id: 'on', name: t('runSettings.repetitionOn') }, { id: 'off', name: t('runSettings.repetitionOff') }]} />
                <p className="text-xs leading-5 text-muted-foreground">{t('runSettings.repetitionHint')}</p>
              </div>
              <Toggle id="model-give-up" label={t('runSettings.modelGiveUp')} hint={t('runSettings.modelGiveUpHint')} checked={globals.policy.modelGiveUp} onChange={modelGiveUp => policy({ modelGiveUp })} />
            </Section>
            <Section title={t('runSettings.analysisTitle')}>
              <Field label={t('runSettings.analysisLabel')} multiline value={globals.analysisInstructions} onChange={analysisInstructions => update({ analysisInstructions })} hint={t('runSettings.analysisHint')} />
            </Section>
            <Section title={t('runSettings.browserTitle')}>
              <Field label={t('runSettings.browserPath')} value={globals.browserExecutablePath} onChange={browserExecutablePath => update({ browserExecutablePath })} hint={t('runSettings.browserPathHint')} />
            </Section>
            <Section title={t('runSettings.environmentsTitle')} description={t('runSettings.environmentsDescription')}>
              <EnvironmentFields json={environments} onChange={setEnvironments} profiles={props.view.profiles} />
              <details><summary className="cursor-pointer text-sm">{t('runSettings.environmentsJsonSummary')}</summary><div className="mt-4"><Field label={t('runSettings.environmentsJson')} value={environments} multiline onChange={setEnvironments} hint={t('runSettings.environmentsJsonHint')} /></div></details>
              <p className="text-xs text-muted-foreground">{t('runSettings.defaultProfiles', { profiles: Object.keys(props.view.profiles).join(', ') })}</p>
            </Section>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  </div>;
}
