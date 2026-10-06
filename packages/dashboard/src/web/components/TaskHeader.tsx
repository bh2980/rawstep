import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConfigView } from '../../shared/config';
import type { RouteChange } from '../hooks/useRoute';
import type { RunOptions } from '../lib/quickRun';
import type { RunRef } from '../lib/runs';
import { RunControl } from './RunControl';
import { FactLine } from './trace/FactLine';
import { Button } from './ui/button';

type Props = {
  taskId: string; name: string; url: string; goal: string;
  /** How many completion checks the task has, and the name of its run profile. */
  checkCount: number; profileName: string;
  view: ConfigView; busy: boolean; active: RunRef[];
  navigate: (change: RouteChange) => void;
  onRun: (options: RunOptions) => void; onCompare: () => void;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
};

/**
 * The head of the task sheet (spec §15). On the left what the task is: name, address, goal and `완료 확인 2개 · 기본 키보드`, with the
 * actions that change the task itself. On the right the run control, inside the same header and divided from it by a rule.
 */
export function TaskHeader({ taskId, name, url, goal, checkCount, profileName, view, busy, active, navigate, onRun, onCompare, onEdit, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation();
  return <header className="grid gap-5 border-b border-edge-strong pb-5 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-0">
    <div className="grid min-w-0 content-start gap-1.5 lg:pr-8">
      <h1 className="text-2xl font-semibold tracking-tight break-words">{name}</h1>
      <p className="font-mono text-[13px] break-all text-muted-foreground">{url}</p>
      <p className="max-w-3xl text-sm leading-6">{goal}</p>
      <FactLine label={t('taskPage.chipsLabel')} className="mt-0.5" items={[
        checkCount > 0 ? t('taskPage.checkFact', { count: checkCount }) : t('taskPage.noCheckFact'),
        t('taskPage.profileFact', { name: profileName }),
      ]} />
      <div role="group" aria-label={t('taskPage.actionsLabel')} className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onEdit}><Pencil aria-hidden="true" />{t('taskPage.edit')}</Button>
        <Button variant="outline" disabled={busy} onClick={onDuplicate}><Copy aria-hidden="true" />{t('taskPage.duplicate')}</Button>
        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}><Trash2 aria-hidden="true" />{t('taskPage.delete')}</Button>
      </div>
    </div>
    <div className="border-t border-edge-strong pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
      <RunControl view={view} busy={busy} taskId={taskId} active={active} navigate={navigate} onRun={onRun} onCompare={onCompare} />
    </div>
  </header>;
}
