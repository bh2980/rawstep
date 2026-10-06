import { useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { taskProfile, type ManagedTask } from '@rawstep/project/config';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { RunBox } from '../components/RunBox';
import { TaskChecks } from '../components/TaskChecks';
import { TaskOverview } from '../components/TaskOverview';
import { TaskSettings } from '../components/TaskSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useTaskFindings } from '../hooks/useTaskFindings';
import { taskTabs, type RouteChange, type TaskTab } from '../hooks/useRoute';
import { describeRule } from '../lib/describeRule';
import { isLive, taskRunNumbers, type RunRef } from '../lib/runs';
import type { RunOptions } from '../lib/quickRun';
import { parseTaskJson, sameTaskJson, taskRules, withRules } from '../lib/taskJson';
import type { PageProps } from './types';

type Props = {
  taskId: string; tab: TaskTab; pageProps: PageProps; runs: RunRef[];
  navigate: (change: RouteChange, options?: { replace?: boolean }) => void;
  onCompare: (taskId: string) => void; onRun: (taskId: string, options: RunOptions) => void;
};

/** A task: what it is and how it is run at the top, then its overview, completion checks and settings. Mount with `key={taskId}` so drafts do not leak between tasks. */
export function TaskPage({ taskId, tab, pageProps, runs, navigate, onCompare, onRun }: Props) {
  const { t } = useTranslation();
  const findings = useTaskFindings(taskId);
  const { view } = pageProps, config = view.config;
  const saved = config.tasks.find(task => task.id === taskId), savedJson = JSON.stringify(view.tasks[taskId] ?? {}, null, 2);
  const [task, setTask] = useState<ManagedTask | undefined>(() => saved && structuredClone(saved));
  const [json, setJson] = useState(savedJson), [revision, setRevision] = useState(view.revision);
  const taskRuns = useMemo(() => runs.filter(ref => ref.run.taskId === taskId), [runs, taskId]);
  const numbers = useMemo(() => taskRunNumbers(runs, taskId), [runs, taskId]);
  if (!saved || !task) return <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">{t('task.unknown')}</p>;
  const parsed = parseTaskJson(json), rules = parsed ? taskRules(parsed) : [];
  const dirty = JSON.stringify(task) !== JSON.stringify(saved) || !sameTaskJson(json, savedJson);
  const profile = taskProfile(config, saved), savedRules = taskRules(parseTaskJson(savedJson) ?? {});
  const save = async () => {
    if (!parsed) throw new Error(t('taskSettings.invalidJson'));
    const state = await pageProps.save({ ...config, tasks: config.tasks.map(item => item.id === task.id ? task : item) }, { file: task.file, task: parsed }, revision);
    // Start again from what the server stored, so the page is clean even where it normalised the file.
    const stored = state.config.tasks.find(item => item.id === task.id);
    setRevision(state.revision);
    if (stored) setTask(structuredClone(stored));
    setJson(JSON.stringify(state.tasks[taskId] ?? parsed, null, 2));
  };
  const discard = () => { setTask(structuredClone(saved)); setJson(savedJson); };
  return <div className="grid gap-5">
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="grid min-w-0 flex-[1_1_24rem] gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{saved.name}</h1>
        <p className="font-mono text-[13px] break-all text-muted-foreground">{String(parseTaskJson(savedJson)?.url ?? '')}</p>
        <p className="max-w-3xl text-sm leading-6">{String(parseTaskJson(savedJson)?.goal ?? '')}</p>
        <ul className="mt-1 flex flex-wrap gap-2" aria-label={t('taskPage.chipsLabel')}>
          <li><Badge variant="outline" className="h-auto whitespace-normal py-0.5 text-left">{savedRules.length ? t('taskPage.checkChip', { rule: describeRule(savedRules[0]), more: savedRules.length > 1 ? t('taskPage.checkChipMore', { count: savedRules.length - 1 }) : '' }) : t('taskPage.noCheckChip')}</Badge></li>
          <li><Badge variant="outline" className="h-auto whitespace-normal py-0.5">{t('taskPage.profileChip', { name: profile.name })}</Badge></li>
        </ul>
      </div>
      <RunBox view={view} busy={pageProps.busy} active={taskRuns.filter(ref => isLive(ref.run))} navigate={navigate}
        onRun={options => onRun(taskId, options)} onCompare={() => onCompare(taskId)} />
    </header>

    <Tabs value={tab} onValueChange={value => navigate({ task: taskId, tab: value as TaskTab }, { replace: true })} className="gap-4">
      <TabsList variant="line" aria-label={t('taskPage.tabsLabel')} className="h-9 w-full justify-start gap-1 border-b">
        {taskTabs.map(id => <TabsTrigger key={id} value={id} className="h-9 flex-none px-3 text-sm">{t(`taskPage.tabs.${id}`)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="overview"><TaskOverview taskId={taskId} runs={taskRuns} numbers={numbers} findings={findings} profiles={config.profiles} navigate={navigate} /></TabsContent>
      <TabsContent value="check"><TaskChecks rules={rules} onRules={next => setJson(withRules(json, next))} url={String(parsed?.url ?? '')} goal={String(parsed?.goal ?? '')} view={view} /></TabsContent>
      <TabsContent value="settings"><TaskSettings task={task} onTask={setTask} json={json} onJson={setJson} view={view} /></TabsContent>
    </Tabs>

    {dirty && tab !== 'overview' && <div role="region" aria-label={t('taskPage.saveBar')} className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur">
      <Button size="xl" disabled={pageProps.busy} onClick={() => void pageProps.act(save)}><Save aria-hidden="true" />{t('taskPage.save')}</Button>
      <Button variant="outline" size="xl" disabled={pageProps.busy} onClick={discard}><RotateCcw aria-hidden="true" />{t('taskPage.discard')}</Button>
      <p role="status" className="text-xs text-muted-foreground">{t('taskPage.unsaved')}</p>
    </div>}
  </div>;
}
