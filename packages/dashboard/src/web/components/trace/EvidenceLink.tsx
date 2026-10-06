import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../../hooks/useRoute';
import { cn } from '../../lib/utils';
import { Link } from '../Link';

type Props = {
  taskId: string; runId: string;
  /** "Run #n" of the run in its task, when known. */
  number?: number | undefined;
  /** The action to open the run at. */
  step?: number | undefined;
  navigate: (change: RouteChange) => void;
  className?: string;
};

/** Evidence you can follow down to the record: `실행 #14 · 행동 9 →`, a link to that run opened at that action. */
export function EvidenceLink({ taskId, runId, number, step, navigate, className }: Props) {
  const { t } = useTranslation();
  const text = number === undefined ? t('trace.evidencePlain') : step === undefined ? t('trace.evidenceRunOnly', { number }) : t('trace.evidenceRun', { number, step });
  return <Link to={{ task: taskId, run: runId, ...(step !== undefined ? { step } : {}) }} navigate={navigate}
    className={cn('inline-flex items-center gap-1 rounded-sm text-[13px] tabular-nums text-trace underline-offset-2 hover:underline', className)}>
    {text}<ArrowRight className="size-3" aria-hidden="true" />
  </Link>;
}
