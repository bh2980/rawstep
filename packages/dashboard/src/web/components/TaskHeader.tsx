import { ArrowLeft, Copy, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PageProps } from '../pages/types';
import type { RouteChange } from '../hooks/useRoute';
import { isLive, type RunRef } from '../lib/runs';
import { Link } from './Link';
import { LivePlanCard } from './trace/LivePlanCard';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

type Props = {
  name: string; url: string; goal: string;
  /** What the simulated user knows before starting, if the task says. */
  context?: string;
  pageProps: PageProps;
  /** Every run of the task, newest first; the run bar follows the ones still going. */
  runs: RunRef[];
  navigate: (change: RouteChange) => void;
  /** Opens the run dialog for this task. */
  onRun: () => void;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
};

/**
 * The head of a task: what it is (name, start address, goal, what the user knows) and 실행…, which opens the run dialog where the
 * profiles and repeats are picked. Editing, duplicating and deleting the task wait in a ⋯ menu, deletion last and apart.
 */
export function TaskHeader({ name, url, goal, context, pageProps, runs, navigate, onRun, onEdit, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation();
  const active = runs.filter(ref => isLive(ref.run));
  return <header className="grid gap-4">
    <nav aria-label={t('taskPage.breadcrumb')}>
      <Link to={{ view: 'tasks' }} navigate={navigate} className="inline-flex items-center gap-1 rounded-sm text-[13px] text-muted-foreground hover:text-foreground hover:underline">
        <ArrowLeft aria-hidden="true" className="size-3.5" />{t('nav.tasks')}
      </Link>
    </nav>
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="grid min-w-0 max-w-3xl flex-1 gap-1">
        <div className="flex items-start gap-1">
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{name}</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="mt-0.5 shrink-0" aria-label={t('taskPage.more')}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden="true" />{t('taskPage.edit')}</DropdownMenuItem>
              <DropdownMenuItem disabled={pageProps.busy} onSelect={onDuplicate}><Copy aria-hidden="true" />{t('taskPage.duplicate')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 aria-hidden="true" />{t('taskPage.delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="font-mono text-[13px] break-all text-muted-foreground">{url}</p>
        <p className="mt-1 text-[15px] leading-6">{goal}</p>
        {context && <p className="text-[13px] leading-5 text-muted-foreground"><span className="font-medium">{t('taskPage.context')}</span> {context}</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button id="task-run-control" data-run onClick={onRun} disabled={pageProps.busy}><Play aria-hidden="true" />{t('taskPage.run')}</Button>
      {active[0] && <p role="status" className="text-xs leading-5 text-muted-foreground">
        {t('runBox.active', { count: active.length })} <Link to={{ task: active[0].run.taskId, run: active[0].run.id }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.openActive')}</Link>
      </p>}
    </div>
    <LivePlanCard runs={runs} navigate={navigate} />
  </header>;
}
