import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, LoaderCircle, PlugZap } from 'lucide-react';
import type { AtEnvironment } from '@rawstep/project/config';
import type { ConfigView } from '../../../shared/config';
import { ApiError, api } from '../../api';
import { actionLabel, AT_BACKENDS } from '../../lib/conditions';
import { cn } from '../../lib/utils';
import { InfoTip } from '../layout/InfoTip';
import { RadioRows } from '../layout/RadioRows';
import { Button } from '../ui/button';

type Props = {
  environment: AtEnvironment; onChange: (e: AtEnvironment) => void; compact?: boolean;
  /** When given, the screen reader actions the chosen backend supports are listed. */
  capabilities?: ConfigView['capabilities'];
};
type Check = { state: 'idle' } | { state: 'running' } | { state: 'ok'; message: string } | { state: 'failed'; message: string };

/**
 * The assistive technology screen reader runs go through: Rawstep's simulated VoiceOver or a native screen reader driven over AT Driver.
 * 연결 확인 asks the local server to reach it with this computer's saved settings (addresses live in 설정 › 이 컴퓨터).
 */
export function AtEnvironmentEditor({ environment, onChange, compact, capabilities }: Props) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const backend = environment.backend;
  async function runCheck() {
    setCheck({ state: 'running' });
    try {
      // The check uses the saved settings of this computer, never unsaved edits on another page.
      const { config } = await api<ConfigView>('/state');
      const result = await api<{ message: string }>('/backend/check', { method: 'POST', body: { backend, machine: config.machine } });
      setCheck({ state: 'ok', message: result.message });
    } catch (error) {
      setCheck({ state: 'failed', message: error instanceof ApiError && error.status === 0 ? t('machine.env.noServer') : error instanceof Error ? error.message : t('conditions.atEnv.checkFailed') });
    }
  }
  const supported = capabilities?.[backend].intents ?? [];
  return <div className={cn('grid min-w-0', compact ? 'gap-3' : 'gap-4')}>
    <RadioRows legend={t('conditions.atEnv.backend')} value={backend} onChange={next => { onChange({ ...environment, backend: next }); setCheck({ state: 'idle' }); }}
      rows={AT_BACKENDS.map(id => ({ id, label: t(`conditions.backends.${id}`), hint: t(`conditions.atEnv.hints.${id}`) }))} />
    {supported.length > 0 && <p className="text-[13px] leading-5"><span className="text-muted-foreground">{t('conditions.atEnv.supported')} </span>{supported.map(actionLabel).join(' · ')}</p>}
    <div className="grid gap-2 border-t border-edge pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={check.state === 'running'} onClick={() => void runCheck()}><PlugZap aria-hidden="true" />{t('conditions.atEnv.check')}</Button>
        {!compact && <InfoTip term={t('conditions.atEnv.check')}>{backend === 'simulation' ? t('conditions.atEnv.checkSimulation') : t('conditions.atEnv.checkNative')}</InfoTip>}
      </div>
      <p role="status" className="flex items-start gap-2 text-[13px] leading-5 empty:hidden">
        {check.state === 'running' && <><LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />{t('conditions.atEnv.checking')}</>}
        {check.state === 'ok' && <><CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-reach" />{check.message}</>}
        {check.state === 'failed' && <><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-missed" />{check.message}</>}
      </p>
    </div>
  </div>;
}
