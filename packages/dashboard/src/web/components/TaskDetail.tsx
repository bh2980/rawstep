import { useMemo, useState } from 'react';
import type { ManagedTask } from '@rawstep/project/config';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../lib/format';
import { isFinished, runStartedAt, runStepCount, runProfileName, type RunRef } from '../lib/runs';
import { useHintSummaries, useRequestHintSummaries } from '../hooks/useHintSummaries';
import type { RouteChange } from '../hooks/useRoute';
import type { PageProps } from '../pages/types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { RunStateLabel } from './RunStateLabel';
import { HintBadge } from './HintBadge';
import { TaskEditor } from './TaskEditor';

type Draft = { task: ManagedTask; json?: unknown };
type Props = { taskId: string; pageProps: PageProps; runs: RunRef[]; navigate: (change: RouteChange) => void; onCompare: (taskId: string) => void };

/** Task editor plus a table of that task's runs. Mount with `key={taskId}` so drafts do not leak between tasks. */
export function TaskDetail({ taskId, pageProps, runs, navigate, onCompare }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft | undefined>();
  const config = pageProps.view.config;
  const saved = config.tasks.find(task => task.id === taskId);
  const managed = draft?.task ?? saved;
  const taskRuns = useMemo(() => runs.filter(ref => ref.run.taskId === taskId), [runs, taskId]);
  return <div className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{managed?.name ?? taskRuns[0]?.run.snapshot.taskName ?? t('sidebar.unnamedTask')}</h1>
      {managed && <Button variant="outline" onClick={() => onCompare(taskId)}>{t('task.compare')}</Button>}
    </div>
    {taskRuns.length > 0 && <TaskRuns runs={taskRuns} profiles={config.profiles} navigate={navigate} />}
    {managed
      ? <TaskEditor key={managed.id} {...pageProps} managed={managed} initial={draft ? draft.json : pageProps.view.tasks[managed.id]}
        onSaved={id => { setDraft(undefined); navigate({ task: id }); }} onDuplicate={(task, json) => setDraft({ task, json })} />
      : <Card><CardContent className="py-16 text-center text-muted-foreground">{t('task.unknown')}</CardContent></Card>}
  </div>;
}

function TaskRuns({ runs, profiles, navigate }: { runs: RunRef[]; profiles: { id: string; name: string }[]; navigate: Props['navigate'] }) {
  const { t } = useTranslation();
  const hintsFor = useHintSummaries();
  useRequestHintSummaries(runs.filter(ref => isFinished(ref.run)).map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })));
  return <Card>
    <CardHeader><CardTitle>{t('task.runsTitle')}</CardTitle></CardHeader>
    <CardContent>
      <div className="max-h-72 overflow-auto">
        <Table>
          <TableCaption>{t('task.runsCaption')}</TableCaption>
          <TableHeader><TableRow>
            <TableHead>{t('task.columns.started')}</TableHead><TableHead>{t('task.columns.condition')}</TableHead><TableHead>{t('task.columns.state')}</TableHead>
            <TableHead className="text-right">{t('task.columns.steps')}</TableHead><TableHead>{t('task.columns.hints')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{runs.map(ref => {
            const { run } = ref, steps = runStepCount(run), hints = hintsFor(run.id) ?? [];
            const condition = `${run.snapshot.model.name} · ${run.snapshot.prompt.name} · ${runProfileName(profiles, run)}`;
            return <TableRow key={run.id}>
              <TableCell><Button variant="link" className="h-auto p-0 tabular-nums" onClick={() => navigate({ task: run.taskId, run: run.id })}>{formatDate(runStartedAt(ref))}<span className="sr-only"> {t('sidebar.repeat', { n: run.repeat })}</span></Button></TableCell>
              <TableCell className="whitespace-normal">{condition}</TableCell>
              <TableCell><RunStateLabel state={run.state} /></TableCell>
              <TableCell className="text-right tabular-nums">{steps ?? '—'}</TableCell>
              <TableCell><div className="flex flex-wrap gap-1">{hints.slice(0, 2).map(hint => <HintBadge key={hint.kind} kind={hint.kind} count={hint.count} />)}</div></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>;
}
