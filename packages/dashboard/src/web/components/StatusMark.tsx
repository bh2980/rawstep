import { useTranslation } from 'react-i18next';
import type { RunStatus } from '../lib/runStrip';
import { cn } from '../lib/utils';

const colors: Record<RunStatus, string> = {
  reached: 'text-reach', 'gave-up': 'text-gave-up', mistaken: 'text-mistaken', unmeasured: 'text-unmeasured',
  error: 'text-errored', running: 'text-trace', queued: 'text-ink-3', cancelled: 'text-ink-3',
};

/**
 * The shape of each status, 10px: 해냄 ● · 포기함 ◆ · 잘못 끝냄 ▲ · 측정 못 함 ○ · 오류로 끝남 ×. A square is never a status (it is a
 * checkbox). Running is a ring with a dot, waiting a dashed ring.
 */
export function StatusShape({ status, className }: { status: RunStatus; className?: string }) {
  const shape = (() => {
    switch (status) {
      case 'reached': return <circle cx="5" cy="5" r="4.5" fill="currentColor" />;
      case 'gave-up': return <path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" fill="currentColor" />;
      case 'mistaken': return <path d="M5 0.8 9.6 9.2H0.4Z" fill="currentColor" />;
      case 'unmeasured': return <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.4" />;
      case 'error': return <path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />;
      case 'running': return <><circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="5" cy="5" r="1.6" fill="currentColor" /></>;
      default: return <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" />;
    }
  })();
  return <svg viewBox="0 0 10 10" aria-hidden="true" className={cn('size-2.5 shrink-0', colors[status], className)}>{shape}</svg>;
}

type Props = {
  status: RunStatus;
  /** Words in place of the status name, such as `2번 중 2번 해냄`. */
  label?: string;
  /** Why a run was not measured (`시간 한도`), after the name in the secondary colour. */
  why?: string | undefined;
  /** Only the shape on screen; the words stay for a screen reader. */
  hideText?: boolean;
  className?: string;
};

/** A run's status as a shape, its colour and its name together, so colour never carries it alone. */
export function StatusMark({ status, label, why, hideText, className }: Props) {
  const { t } = useTranslation();
  const name = label ?? t(`status.${status}`);
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
    <StatusShape status={status} />
    <span className={hideText ? 'sr-only' : undefined}>{name}</span>
    {why && <span className="text-ink-2">· {why}</span>}
  </span>;
}

/** Several runs' shapes in a row, oldest first, read as one phrase (`해냄, 해냄, 포기함`). */
export function StatusMarks({ statuses, label, className }: { statuses: RunStatus[]; label?: string; className?: string }) {
  const { t } = useTranslation();
  return <span role="img" aria-label={label ?? statuses.map(status => t(`status.${status}`)).join(', ')} className={cn('inline-flex items-center gap-1', className)}>
    {statuses.map((status, index) => <StatusShape key={index} status={status} />)}
  </span>;
}

const ENDED: RunStatus[] = ['reached', 'gave-up', 'mistaken', 'unmeasured', 'error'];

/**
 * What each shape means, in one line above the shapes it explains (`● 해냄 ◆ 포기함 ▲ 잘못 끝냄 ○ 측정 못 함 × 오류로 끝남`). Shapes alone
 * were not read by first-time readers, so wherever shapes stand without their names this line stays on screen. `order` adds how a
 * row of shapes runs (oldest first).
 */
export function StatusLegend({ order, className }: { order?: boolean; className?: string }) {
  const { t } = useTranslation();
  return <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2', className)}>
    <span className="sr-only">{t('statusLegend.label')}</span>
    {ENDED.map(status => <span key={status} className="inline-flex items-center gap-1 whitespace-nowrap"><StatusShape status={status} />{t(`status.${status}`)}</span>)}
    {order && <span className="whitespace-nowrap text-ink-3">{t('statusLegend.order')}</span>}
  </p>;
}
