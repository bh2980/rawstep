import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../hooks/useRoute';
import { cn } from '../lib/utils';
import { Link } from './Link';
import { Button } from './ui/button';

const HIDDEN = 'rawstep.setup.hidden';
function wasHidden() { try { return localStorage.getItem(HIDDEN) === '1'; } catch { return false; } }

export type SetupStep = { id: 'model' | 'task' | 'run'; done: boolean; detail: string; /** Where to do it; a step done on the page itself has none. */ to?: RouteChange };

type Props = { steps: SetupStep[]; navigate: (change: RouteChange) => void };

/**
 * Getting started on the task list: one ruled row per step (`01  모델 연결  …  완료`). The step to do now carries its link; a finished one
 * is marked 완료. The page shows it only while a step is undone, and a
 * person can close it for good in this browser.
 */
export function SetupRail({ steps, navigate }: Props) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(wasHidden);
  if (hidden) return null;
  const hide = () => { try { localStorage.setItem(HIDDEN, '1'); } catch { /* closed for this visit only */ } setHidden(true); };
  const current = steps.find(step => !step.done);
  const rail = <ol aria-label={t('taskList.setup.title')} className="grid border-t border-edge">{steps.map((step, index) => {
    const now = step === current;
    return <li key={step.id} aria-current={now ? 'step' : undefined} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-edge py-2.5">
      <span className="tabular-nums text-ink-3">{String(index + 1).padStart(2, '0')}</span>
      <div className="grid min-w-0 gap-0.5">
        <p className={cn('font-medium', !now && !step.done && 'text-ink-2')}>{t(`taskList.setup.steps.${step.id}`)}</p>
        <p className="text-sm text-ink-2">{step.detail}</p>
      </div>
      <span className="text-sm whitespace-nowrap">
        {step.done ? <span className="inline-flex items-center gap-1 text-ink-2"><Check aria-hidden="true" className="size-3.5 text-reach" />{t('taskList.setup.done')}</span>
          : now && step.to ? <Link to={step.to} navigate={navigate} className="underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{t(`taskList.setup.go.${step.id}`)}</Link>
          : now ? <span className="text-ink-2">{t('taskList.setup.now')}</span> : null}
      </span>
    </li>;
  })}</ol>;
  return <section aria-labelledby="setup-rail" className="grid gap-2">
    <div className="flex items-center justify-between gap-2">
      <h2 id="setup-rail" className="text-md font-semibold">{t('taskList.setup.title')}</h2>
      <Button type="button" variant="ghost" size="sm" onClick={hide}><X aria-hidden="true" />{t('taskList.setup.hide')}</Button>
    </div>
    {rail}
  </section>;
}
