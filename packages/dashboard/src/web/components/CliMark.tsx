import { useTranslation } from 'react-i18next';
import type { BatchOwner } from '../../shared/config';
import { cn } from '../lib/utils';

/** Whether a batch was started from the command line (`rawstep suite`), as its owner recorded. */
export const startedFromCli = (experiment: { owner?: BatchOwner | undefined }): boolean => experiment.owner?.via === 'cli';

/** `· CLI` in the quiet colour beside a run or batch that was started from the command line; screen readers get the full phrase. */
export function CliMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  return <span title={t('runList.viaCli')} className={cn('ml-1.5 whitespace-nowrap text-ink-3', className)}>
    <span aria-hidden="true">· {t('runList.cli')}</span><span className="sr-only">{t('runList.viaCli')}</span>
  </span>;
}
