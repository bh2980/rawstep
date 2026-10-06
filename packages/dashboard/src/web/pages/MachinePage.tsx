import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { api } from '../api';
import { Choice, Field, Toggle } from '../components/forms';
import { Button } from '../components/ui/button';
import type { MachineSettings } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import type { PageProps } from './types';

type Capabilities = ConfigView['capabilities'];

/** Settings of the computer running the dashboard: browser window, screen reader backend and Chrome path. */
export function MachinePage({ onCapabilities, ...props }: PageProps & { onCapabilities: (capabilities: Capabilities) => void }) {
  const { t } = useTranslation();
  const [machine, setMachine] = useState<MachineSettings>(() => structuredClone(props.view.config.machine));
  const [backendStatus, setBackendStatus] = useState('');
  const native = machine.backend !== 'simulation';
  const update = (part: Partial<MachineSettings>) => setMachine({ ...machine, ...part });
  const changeBackend = (backend: string) => {
    const next = { ...machine, backend: backend as MachineSettings['backend'] };
    setMachine(next); setBackendStatus('');
    void props.act(async () => onCapabilities(await api<Capabilities>('/capabilities', { method: 'POST', body: { machine: next } })));
  };
  const check = () => void props.act(async () => {
    const result = await api<{ message: string }>('/backend/check', { method: 'POST', body: { machine } });
    setBackendStatus(result.message);
  });
  // Only this slice is written, on top of the latest config, so edits made in other settings tabs are kept.
  const save = () => void props.act(async () => { await props.save({ ...props.view.config, machine }, undefined, props.view.revision); });
  return <div className="grid max-w-2xl gap-4">
    <div><h2 className="text-lg font-semibold tracking-tight">{t('machine.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('machine.intro')}</p></div>
    <div className="grid gap-5 rounded-lg border p-4">
      <Toggle label={t('machine.showBrowser')} hint={t('machine.showBrowserHint')} checked={!machine.headless} onChange={show => update({ headless: !show })} />
      <div className="grid gap-2">
        <Choice label={t('machine.backend')} value={machine.backend} onChange={changeBackend}
          options={[{ id: 'simulation', name: t('machine.backendSimulation') }, { id: 'voiceover', name: t('machine.backendVoiceover') }, { id: 'nvda', name: t('machine.backendNvda') }]} />
        <p className="text-xs leading-5 text-muted-foreground">{native ? t('machine.backendHintNative') : t('machine.backendHintSimulation')}</p>
      </div>
      {native && <div className="grid gap-4">
        <Field label={t('machine.atEndpoint')} value={machine.atEndpoint} onChange={atEndpoint => update({ atEndpoint })} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={props.busy} onClick={check}>{t('machine.checkBackend')}</Button>
          {backendStatus && <p role="status" className="text-sm text-primary">{backendStatus}</p>}
        </div>
      </div>}
      <Field label={t('machine.browserPath')} value={machine.browserExecutablePath} onChange={browserExecutablePath => update({ browserExecutablePath })} placeholder={t('machine.browserPathPlaceholder')} hint={t('machine.browserPathHint')} />
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xl" disabled={props.busy} onClick={save}><Save aria-hidden="true" />{t('machine.save')}</Button>
      <p className="text-xs text-muted-foreground">{t('machine.saveHint')}</p>
    </div>
  </div>;
}
