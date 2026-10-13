import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CheckKind, ModelCheck } from '../../shared/api';
import { Button } from './ui/button';
import { InfoTip } from './layout/InfoTip';
import { cn } from '../lib/utils';

/** What a connection check ended in, for display: only the dashboard's own words, one per kind. */
export type CheckState = { state: 'running' } | { state: 'done'; result: ModelCheck } | { state: 'failed'; connection: boolean };

const kindOf = (check: CheckState): CheckKind | 'running' | 'connection' => check.state === 'running' ? 'running' : check.state === 'failed' ? (check.connection ? 'connection' : 'failed') : check.result.kind;

/**
 * The result of checking a connection or a model: a mark, a headline (what is ready or what did not work) and the reason in a sentence. The mark differs by shape
 * as well as colour, and the words always say it.
 */
export function CheckStatus({ check, className, signIn }: { check: CheckState; className?: string; /** For a coding-agent connection: whether its preset has its own sign-in, and what the person's button does. Never run automatically. */ signIn?: { available: boolean; busy?: boolean; onClick: () => void } }) {
  const { t } = useTranslation();
  const kind = kindOf(check), ready = kind === 'ready', unverified = kind === 'unverified';
  const Icon = kind === 'running' ? LoaderCircle : ready ? CircleCheck : unverified ? CircleHelp : CircleAlert;
  return <div role="status" aria-live="polite" className={cn('flex items-start gap-2.5', className)}>
    <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ready ? 'text-reach' : kind === 'running' || unverified ? 'text-muted-foreground' : 'text-missed')} />
    <div className="grid gap-0.5">
      <p className="text-sm font-semibold">{t(`modelCheck.title.${kind}`)}</p>
      {kind !== 'running' && <p className="text-[13px] leading-5 text-muted-foreground">{t(`modelCheck.reason.${ready && check.state === 'done' && check.result.via === 'agent' ? 'readyAgent' : kind === 'cli-signed-out' && signIn?.available ? 'cli-signed-out-button' : kind}`)}</p>}
      {kind === 'cli-signed-out' && signIn?.available && <div className="mt-1.5 flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" disabled={signIn.busy} onClick={signIn.onClick}>{t('modelCheck.signIn')}</Button>
        <InfoTip term={t('modelCheck.signIn')}>{t('modelCheck.signInHint')}</InfoTip>
      </div>}
    </div>
  </div>;
}
