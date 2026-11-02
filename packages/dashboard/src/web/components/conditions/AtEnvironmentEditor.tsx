import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, LoaderCircle, PlugZap } from 'lucide-react';
import type { AtBackend } from '@rawstep/project/config';
import type { ConfigView } from '../../../shared/config';
import type { ServerMessage } from '../../../shared/messages';
import { serverText } from '../../i18n';
import { ApiError, api } from '../../api';
import { actionLabel, AT_BACKENDS } from '../../lib/conditions';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/** The screen reader a profile is heard through, as one select; `· 바꿈` follows it when it is not the default simulation. */
export function BackendSelect({ value, onChange }: { value: AtBackend; onChange: (backend: AtBackend) => void }) {
  const { t } = useTranslation();
  return <Select value={value} onValueChange={next => onChange(next as AtBackend)}>
    <SelectTrigger aria-label={t('conditions.atEnv.backend')} className="w-52 max-w-full">
      <SelectValue>{t(`conditions.backends.${value}`)}{value !== 'simulation' && <span className="ml-1 font-medium text-foreground">· {t('profile.changedMark')}</span>}</SelectValue>
    </SelectTrigger>
    <SelectContent>{AT_BACKENDS.map(id => <SelectItem key={id} value={id}>{t(`conditions.backends.${id}`)}</SelectItem>)}</SelectContent>
  </Select>;
}

type Check = { state: 'idle' } | { state: 'running' } | { state: 'ok'; message: string } | { state: 'failed'; message: string };

/**
 * What the chosen screen reader is (the simulation is never a real screen reader's speech), what it supports, and 연결 확인, which asks
 * the local server to reach it with this computer's saved settings (addresses live in 설정 › 이 컴퓨터).
 */
export function AtEnvironmentDetails({ backend, capabilities }: { backend: AtBackend; capabilities?: ConfigView['capabilities'] }) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<Check & { backend?: AtBackend }>({ state: 'idle' });
  const shown: Check = check.backend === backend ? check : { state: 'idle' };
  async function runCheck() {
    setCheck({ state: 'running', backend });
    try {
      // The check uses the saved settings of this computer, never unsaved edits on another page.
      const { config } = await api<ConfigView>('/state');
      const result = await api<{ message: ServerMessage }>('/backend/check', { method: 'POST', body: { backend, machine: config.machine } });
      setCheck({ state: 'ok', message: serverText(result.message), backend });
    } catch (error) {
      setCheck({ state: 'failed', message: error instanceof ApiError && error.status === 0 ? t('machine.env.noServer') : error instanceof Error ? error.message : t('conditions.atEnv.checkFailed'), backend });
    }
  }
  const supported = capabilities?.[backend].intents ?? [];
  return <div className="grid min-w-0 gap-2">
    <p>{t(`conditions.backends.${backend}`)} <span className="text-ink-2">· {t(`conditions.atEnv.hints.${backend}`)}</span></p>
    {supported.length > 0 && <p className="text-ink-2">{t('conditions.atEnv.supported')} <span className="text-foreground">{supported.map(actionLabel).join(' · ')}</span></p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={shown.state === 'running'} title={backend === 'simulation' ? t('conditions.atEnv.checkSimulation') : t('conditions.atEnv.checkNative')} onClick={() => void runCheck()}>
        <PlugZap aria-hidden="true" />{t('conditions.atEnv.check')}
      </Button>
      <p role="status" className="flex items-start gap-1.5 empty:hidden">
        {shown.state === 'running' && <><LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-ink-2" />{t('conditions.atEnv.checking')}</>}
        {shown.state === 'ok' && <><CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-reach" />{shown.message}</>}
        {shown.state === 'failed' && <><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-missed" />{shown.message}</>}
      </p>
    </div>
  </div>;
}
