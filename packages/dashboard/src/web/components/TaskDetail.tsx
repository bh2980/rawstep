import { useMemo, useState } from 'react';
import { defaultModes, type ManagedTask } from '../../shared/config';
import { ko } from '../i18n/ko';
import { formatDate, isFinished, runStartedAt, runStepCount, environmentName, type RunRef } from '../lib/runs';
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
type Props = { taskId: string; pageProps: PageProps; runs: RunRef[]; navigate: (change: RouteChange) => void };

function newDraft(): Draft {
  const id = crypto.randomUUID();
  return { task: { id, name: ko.task.newName, file: 'tasks/' + id + '.json', modes: defaultModes() } };
}

/** Task editor plus a table of that task's runs. Mount with `key={taskId}` so drafts do not leak between tasks. */
export function TaskDetail({ taskId, pageProps, runs, navigate }: Props) {
  const [draft, setDraft] = useState<Draft | undefined>(() => taskId === 'new' ? newDraft() : undefined);
  const config = pageProps.view.config;
  const saved = config.tasks.find(task => task.id === taskId);
  const managed = draft?.task ?? saved;
  const taskRuns = useMemo(() => runs.filter(ref => ref.run.taskId === taskId), [runs, taskId]);
  return <div className="grid gap-6">
    <h1 className="text-2xl font-semibold tracking-tight">{managed?.name ?? taskRuns[0]?.run.snapshot.taskName ?? ko.sidebar.unnamedTask}</h1>
    {taskRuns.length > 0 && <TaskRuns runs={taskRuns} environments={config.environments} navigate={navigate} />}
    {managed
      ? <TaskEditor key={managed.id} {...pageProps} managed={managed} initial={draft ? draft.json : pageProps.view.tasks[managed.id]}
        onSaved={id => { setDraft(undefined); navigate({ task: id }); }} onDuplicate={(task, json) => setDraft({ task, json })} />
      : <Card><CardContent className="py-16 text-center text-muted-foreground">{ko.task.unknown}</CardContent></Card>}
  </div>;
}

function TaskRuns({ runs, environments, navigate }: { runs: RunRef[]; environments: { id: string; name: string }[]; navigate: Props['navigate'] }) {
  const hintsFor = useHintSummaries();
  useRequestHintSummaries(runs.filter(ref => isFinished(ref.run)).map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })));
  const columns = ko.task.columns;
  return <Card>
    <CardHeader><CardTitle>{ko.task.runsTitle}</CardTitle></CardHeader>
    <CardContent>
      <div className="max-h-72 overflow-auto">
        <Table>
          <TableCaption>{ko.task.runsCaption}</TableCaption>
          <TableHeader><TableRow>
            <TableHead>{columns.started}</TableHead><TableHead>{columns.condition}</TableHead><TableHead>{columns.state}</TableHead>
            <TableHead className="text-right">{columns.steps}</TableHead><TableHead>{columns.hints}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{runs.map(ref => {
            const { run } = ref, steps = runStepCount(run), hints = hintsFor(run.id) ?? [];
            const condition = `${run.snapshot.model.name} · ${run.snapshot.prompt.name} · ${environmentName(environments, run.environmentId)}`;
            return <TableRow key={run.id}>
              <TableCell><Button variant="link" className="h-auto p-0 tabular-nums" onClick={() => navigate({ task: run.taskId, run: run.id })}>{formatDate(runStartedAt(ref))}<span className="sr-only"> {ko.sidebar.repeat(run.repeat)}</span></Button></TableCell>
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
