import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../hooks/useRoute';
import { cn } from '../lib/utils';
import { Link } from './Link';

export type SetupStep = { id: 'model' | 'task' | 'run'; done: boolean; detail: string; /** Where to do it; a step done on the page itself has none. */ to?: RouteChange };

type Props = { steps: SetupStep[]; navigate: (change: RouteChange) => void };

/**
 * Getting started on the task list (spec §13): three steps on one line each (`01 ━ 모델 연결`). Only the step to do now is emphasised;
 * a finished one is marked 완료 and the ones after it are drawn with a dashed line. The page shows it only while a step is undone.
 */
export function SetupRail({ steps, navigate }: Props) {
  const { t } = useTranslation();
  const current = steps.find(step => !step.done);
  const rail = <ol aria-label={t('taskList.setup.title')} className="grid border-t border-edge-strong">{steps.map((step, index) => {
    const now = step === current, future = !step.done && !now;
    return <li key={step.id} aria-current={now ? 'step' : undefined} data-selected={now} className={cn('row-rail rail-divider grid grid-cols-[1.75rem_2.5rem_minmax(0,1fr)] items-start gap-x-3 border-b border-edge py-3 pr-4 pl-4 sm:grid-cols-[1.75rem_4rem_minmax(0,1fr)_7rem]', now && 'bg-trace-soft')}>
      <span className={cn('font-mono text-sm leading-6 tabular-nums', now ? 'font-semibold text-trace' : 'text-muted-foreground')}>{String(index + 1).padStart(2, '0')}</span>
      <span aria-hidden="true" className={cn('mt-3 border-t-2', future ? 'border-dashed border-edge-strong' : 'border-solid border-foreground')} />
      <div className="grid gap-0.5">
        <p className={cn('leading-6', now ? 'text-base font-semibold' : step.done ? 'font-medium' : 'font-medium text-muted-foreground')}>{t(`taskList.setup.steps.${step.id}`)}</p>
        <p className={cn('text-sm leading-6', future ? 'text-muted-foreground' : 'text-foreground/80')}>{step.detail}</p>
        {now && step.to && <Link to={step.to} navigate={navigate} className="mt-1.5 w-fit rounded-sm text-sm font-semibold text-trace underline underline-offset-4">{t(`taskList.setup.go.${step.id}`)}</Link>}
      </div>
      <p className={cn('col-span-3 pl-[calc(1.75rem+0.75rem)] text-xs font-medium sm:col-span-1 sm:pl-0 sm:text-right sm:leading-6', now ? 'text-trace' : 'text-muted-foreground')}>
        {step.done ? <span className="inline-flex items-center gap-1"><Check aria-hidden="true" className="size-3.5" />{t('taskList.setup.done')}</span> : now ? t('taskList.setup.now') : ''}
      </p>
    </li>;
  })}</ol>;
  return <section aria-labelledby="setup-rail" className="grid gap-2">
    <h2 id="setup-rail" className="text-base font-semibold">{t('taskList.setup.title')}</h2>
    {rail}
  </section>;
}
