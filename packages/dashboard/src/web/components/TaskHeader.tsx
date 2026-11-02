import { Copy, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PageProps } from '../pages/types';
import type { RouteChange } from '../hooks/useRoute';
import { isLive, type RunRef } from '../lib/runs';
import { Link } from './Link';
import { PageHeader } from './PageHeader';
import { LivePlanCard } from './trace/LivePlanCard';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';

/** A start address as a person reads it: host and path without the scheme and `www.`; a project file path stays as written. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return parsed.host.replace(/^www\./, '') + path + parsed.search;
  } catch { return url; }
}

type Props = {
  name: string; url: string; goal: string;
  /** What the simulated user knows before starting, if the task says. */
  context?: string;
  /** The most actions a run may take. */
  maxSteps?: number | undefined;
  pageProps: PageProps;
  /** Every run of the task, newest first; the run bar follows the ones still going. */
  runs: RunRef[];
  navigate: (change: RouteChange) => void;
  /** Opens the run dialog for this task. */
  onRun: () => void;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
};

/**
 * The head of a task: the way back to the list, its name, one line of what it is (start address, goal, the action limit), and on the
 * right a ⋯ menu (edit, duplicate, and apart from them delete) and 실행…, which opens the run dialog.
 */
export function TaskHeader({ name, url, goal, context, maxSteps, pageProps, runs, navigate, onRun, onEdit, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation();
  const active = runs.filter(ref => isLive(ref.run));
  return <div className="grid gap-3">
    <PageHeader className="mb-0" title={<span className="min-w-0 break-words">{name}</span>} crumbs={[{ label: t('nav.tasks'), to: { view: 'tasks' } }]} navigate={navigate}
      meta={[
        url && <span className="break-all" title={url}>{displayUrl(url)}</span>,
        goal && <span>{t('taskPage.goalMeta', { goal })}</span>,
        maxSteps !== undefined && <span className="tabular-nums">{t('taskPage.maxStepsMeta', { count: maxSteps })}</span>,
      ]}
      actions={<>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t('taskPage.more')}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden="true" />{t('taskPage.edit')}</DropdownMenuItem>
            <DropdownMenuItem disabled={pageProps.busy} onSelect={onDuplicate}><Copy aria-hidden="true" />{t('taskPage.duplicate')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 aria-hidden="true" />{t('taskPage.delete')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button id="task-run-control" data-run onClick={onRun} disabled={pageProps.busy}><Play aria-hidden="true" />{t('taskPage.run')}</Button>
      </>} />
    {context && <p className="max-w-3xl text-sm text-ink-2"><span className="text-foreground">{t('taskPage.context')}</span> {context}</p>}
    {active[0] && <p role="status" className="text-sm text-ink-2">
      {t('runBox.active', { count: active.length })} <Link to={{ task: active[0].run.taskId, run: active[0].run.id }} navigate={navigate} className="text-foreground underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{t('runBox.openActive')}</Link>
    </p>}
    <LivePlanCard runs={runs} navigate={navigate} />
  </div>;
}
