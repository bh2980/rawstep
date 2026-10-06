import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CheckKind, ModelCheck } from '../../shared/api';
import { cn } from '../lib/utils';

/** What a connection check ended in, for display: only the dashboard's own words, one per kind. */
export type CheckState = { state: 'running' } | { state: 'done'; result: ModelCheck } | { state: 'failed'; connection: boolean };

const kindOf = (check: CheckState): CheckKind | 'running' | 'connection' => check.state === 'running' ? 'running' : check.state === 'failed' ? (check.connection ? 'connection' : 'failed') : check.result.kind;

/**
 * The result of checking a model: a mark, a headline (`Ready` or what did not work) and the reason in a sentence. The mark differs by shape
 * as well as colour, and the words always say it.
 */
export function ModelStatus({ check, className }: { check: CheckState; className?: string }) {
  const { t } = useTranslation();
  const kind = kindOf(check), ready = kind === 'ready', unverified = kind === 'unverified';
  const Icon = kind === 'running' ? LoaderCircle : ready ? CircleCheck : unverified ? CircleHelp : CircleAlert;
  return <div role="status" aria-live="polite" className={cn('flex items-start gap-2.5', className)}>
    <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ready ? 'text-reach' : kind === 'running' || unverified ? 'text-muted-foreground' : 'text-missed')} />
    <div className="grid gap-0.5">
      <p className="text-sm font-semibold">{t(`modelCheck.title.${kind}`)}</p>
      <p className="text-[13px] leading-5 text-muted-foreground">{t(`modelCheck.reason.${kind}`)}</p>
    </div>
  </div>;
}
