import { RunsTable } from '../components/RunsTable';
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { taskProfile, type ManagedTask } from '@rawstep/project/config';
import type { DeleteTaskResult } from '../../shared/config';
import { api, ApiError } from '../api';
import { DeleteTaskDialog } from '../components/DeleteTaskDialog';
import { EmptyState } from '../components/layout/EmptyState';
import { TaskChecks } from '../components/TaskChecks';
import { TaskEditSheet, type BasicsSave, type TaskBasics } from '../components/TaskEditSheet';
import { TaskHeader } from '../components/TaskHeader';
import { TaskOverview } from '../components/TaskOverview';
import { TaskSettings } from '../components/TaskSettings';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useTaskFindings } from '../hooks/useTaskFindings';
import { taskTabs, type RouteChange, type TaskTab } from '../hooks/useRoute';
import { isLive, taskRunNumbers, type RunRef } from '../lib/runs';
import type { RunOptions } from '../lib/quickRun';
import { createManagedTask } from '../lib/taskFiles';
import { inputFields, taskInputOptions, taskInputs } from '../lib/taskInputs';
import { parseTaskJson, sameTaskJson, taskRules, updateTaskJson, withRules } from '../lib/taskJson';
import type { PageProps } from './types';

type Props = {
  taskId: string; tab: TaskTab; pageProps: PageProps; runs: RunRef[];
  navigate: (change: RouteChange, options?: { replace?: boolean }) => void;
  onCompare: (taskId: string) => void; onRun: (taskId: string, options: RunOptions) => void;
};

/** Sends a person to the run control of the task header, for an empty state that says "run it". */
function focusRunControl() {
  const form = document.getElementById('task-run-control');
  form?.scrollIntoView({ block: 'center' });
  form?.querySelector<HTMLElement>('[role="combobox"], button')?.focus();
}

/**
 * A task as one investigation sheet: its header with the run control, then overview, completion check and detailed settings.
 * Name, address, goal and run profile are edited in the 작업 수정 sheet; the tabs hold the rest. Both write the same draft and
 * the same file. Mount with `key={taskId}` so drafts do not leak between tasks.
 */
export function TaskPage({ taskId, tab, pageProps, runs, navigate, onCompare, onRun }: Props) {
  const { t } = useTranslation();
  const findings = useTaskFindings(taskId);
  const { view } = pageProps, config = view.config;
  const saved = config.tasks.find(item => item.id === taskId), savedJson = JSON.stringify(view.tasks[taskId] ?? {}, null, 2);
  const [task, setTask] = useState<ManagedTask | undefined>(() => saved && structuredClone(saved));
  const [json, setJson] = useState(savedJson), [revision, setRevision] = useState(view.revision);
  // What the draft started from, to tell an edit from a change made elsewhere (another window, a file edit, the CLI).
  const [base, setBase] = useState(() => ({ task: JSON.stringify(saved ?? null), json: savedJson }));
  const adopt = () => { if (!saved) return; setTask(structuredClone(saved)); setJson(savedJson); setRevision(view.revision); setBase({ task: JSON.stringify(saved), json: savedJson }); };
  const edited = !!task && (JSON.stringify(task) !== base.task || !sameTaskJson(json, base.json));
  // A newer project revision is taken over at once when nothing was edited; an edited draft stays and is marked as behind.
  useEffect(() => { if (revision !== view.revision && !edited) adopt(); }, [view.revision]);
  const behind = revision !== view.revision;
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false);
  const taskRuns = useMemo(() => runs.filter(ref => ref.run.taskId === taskId), [runs, taskId]);
  const numbers = useMemo(() => taskRunNumbers(runs, taskId), [runs, taskId]);
  if (!saved || !task) return <EmptyState title={t('task.unknownTitle')} why={t('task.unknown')} action={<Button variant="outline" onClick={() => navigate({ view: 'tasks' })}>{t('task.backToTasks')}</Button>} />;
  const parsed = parseTaskJson(json), rules = parsed ? taskRules(parsed) : [];
  const dirty = JSON.stringify(task) !== JSON.stringify(saved) || !sameTaskJson(json, savedJson);
  const profile = taskProfile(config, saved), savedParsed = parseTaskJson(savedJson) ?? {}, savedRules = taskRules(savedParsed);
  const draftProfile = taskProfile(config, task);
  // What the 세부 설정 tab changed, apart from what the sheet owns (the inputs are edited in both, so the sheet saves them with the rest).
  const otherChanges = JSON.stringify({ ...task, name: saved.name, profileId: saved.profileId }) !== JSON.stringify(saved)
    || !sameTaskJson(updateTaskJson(json, { url: savedParsed.url, goal: savedParsed.goal, input: savedParsed.input, inputOptions: savedParsed.inputOptions }), savedJson);

  /** Writes a task entry and its file against `base`, then starts the draft again from what the server stored. */
  async function write(next: { task: ManagedTask; json: string }, base: string, current = config) {
    const body = parseTaskJson(next.json);
    if (!body) throw new Error(t('taskSettings.invalidJson'));
    const state = await pageProps.save({ ...current, tasks: current.tasks.map(item => item.id === next.task.id ? next.task : item) }, { file: next.task.file, task: body }, base);
    const stored = state.config.tasks.find(item => item.id === next.task.id);
    const storedJson = JSON.stringify(state.tasks[taskId] ?? body, null, 2);
    setRevision(state.revision);
    if (stored) setTask(structuredClone(stored));
    setJson(storedJson);
    setBase({ task: JSON.stringify(stored ?? next.task), json: storedJson });
  }
  const save = () => write({ task, json }, revision);
  /** Saves this draft on top of the project as it is now: other tasks and settings stay as they are, this task becomes the draft. */
  const saveOnLatest = () => write({ task, json }, view.revision, view.config);
  const discard = adopt;

  const saveBasics = async (basics: TaskBasics, rebase: boolean): Promise<BasicsSave> => {
    let result: BasicsSave = { ok: true };
    await pageProps.act(async () => {
      try {
        if (rebase) {
          // The project as it is now with only these edits on top, saved against its own revision.
          const latest = pageProps.view, entry = latest.config.tasks.find(item => item.id === taskId);
          if (!entry) throw new Error(t('task.unknown'));
          await write({ task: { ...entry, name: basics.name, profileId: basics.profileId }, json: updateTaskJson(JSON.stringify(latest.tasks[taskId] ?? {}, null, 2), { url: basics.url, goal: basics.goal, ...inputFields(basics.input, basics.inputOptions) }) }, latest.revision, latest.config);
        } else await write({ task: { ...task, name: basics.name, profileId: basics.profileId }, json: updateTaskJson(json, { url: basics.url, goal: basics.goal, ...inputFields(basics.input, basics.inputOptions) }) }, revision);
        pageProps.notify(t('taskEdit.saved'));
      } catch (error) { result = { ok: false, conflict: error instanceof ApiError && error.status === 409, error }; }
    });
    return result;
  };
  const duplicate = () => void pageProps.act(async () => {
    const copy = await createManagedTask(pageProps, {
      name: t('taskPage.copyName', { name: saved.name }), slug: saved.file.replace(/^tasks\//, '').replace(/\.json$/i, ''), task: savedParsed, profileId: saved.profileId ?? profile.id, copyOf: saved,
    });
    navigate({ task: copy.id });
    pageProps.notify(t('taskPage.duplicated', { name: saved.name }));
  });
  const remove = () => { setDeleting(false); void pageProps.act(async () => {
    const result = await api<DeleteTaskResult>('/tasks/' + encodeURIComponent(taskId), { method: 'DELETE', body: { revision: pageProps.view.revision } });
    navigate({ view: 'tasks' });
    pageProps.notify(result.fileRemoved ? t('taskDelete.doneRemoved', { name: saved.name, file: result.file }) : t('taskDelete.doneKept', { name: saved.name, file: result.file }));
  }); };

  const active = taskRuns.filter(ref => isLive(ref.run));
  return <div className="grid gap-5">
    <TaskHeader taskId={taskId} name={saved.name} url={String(savedParsed.url ?? '')} goal={String(savedParsed.goal ?? '')} checkCount={savedRules.length} profileName={profile.name}
      view={view} busy={pageProps.busy} active={active} navigate={navigate} onRun={options => onRun(taskId, options)} onCompare={() => onCompare(taskId)}
      onEdit={() => setEditing(true)} onDuplicate={duplicate} onDelete={() => setDeleting(true)} />

    <Tabs value={tab} onValueChange={value => navigate({ task: taskId, tab: value as TaskTab }, { replace: true })} className="gap-4">
      <TabsList variant="line" aria-label={t('taskPage.tabsLabel')}>
        {taskTabs.map(id => <TabsTrigger key={id} value={id}>{t(`taskPage.tabs.${id}`)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="overview"><TaskOverview taskId={taskId} runs={taskRuns} numbers={numbers} findings={findings} profiles={config.profiles} navigate={navigate} onRun={focusRunControl} /></TabsContent>
      <TabsContent value="runs">
        <section aria-label={t('taskPage.tabs.runs')} className="grid gap-2">
          <p className="text-[13px] leading-5 text-muted-foreground">{taskRuns.length ? t('taskPage.runsTabNote') : t('taskPage.runsTabEmpty')}</p>
          {taskRuns.length > 0 && <RunsTable runs={taskRuns} profiles={config.profiles} navigate={navigate} hideTask numbers={numbers} showProfile showHints />}
        </section>
      </TabsContent>
      <TabsContent value="check"><TaskChecks rules={rules} onRules={next => setJson(withRules(json, next))} url={String(parsed?.url ?? '')} goal={String(parsed?.goal ?? '')} view={view} /></TabsContent>
      <TabsContent value="settings"><TaskSettings task={task} onTask={setTask} json={json} onJson={setJson} view={view} onEdit={() => setEditing(true)} /></TabsContent>
    </Tabs>

    {dirty && tab !== 'overview' && <div role="region" aria-label={t('taskPage.saveBar')} className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-edge-strong bg-background/95 py-3 backdrop-blur">
      {behind
        ? <Button size="xl" disabled={pageProps.busy} onClick={() => void pageProps.act(saveOnLatest)}><Save aria-hidden="true" />{t('taskPage.saveOnLatest')}</Button>
        : <Button size="xl" disabled={pageProps.busy} onClick={() => void pageProps.act(save)}><Save aria-hidden="true" />{t('taskPage.save')}</Button>}
      <Button variant="outline" size="xl" disabled={pageProps.busy} onClick={discard}><RotateCcw aria-hidden="true" />{behind ? t('taskPage.takeLatest') : t('taskPage.discard')}</Button>
      <p role="status" className="text-xs text-muted-foreground">{behind ? t('taskPage.behind') : t('taskPage.unsaved')}</p>
    </div>}

    <TaskEditSheet open={editing} onOpenChange={setEditing} busy={pageProps.busy} view={view} rules={rules} otherChanges={otherChanges} onSave={saveBasics}
      initial={{ name: task.name, url: String(parsed?.url ?? ''), goal: String(parsed?.goal ?? ''), profileId: draftProfile.id, input: taskInputs(parsed ?? {}), inputOptions: taskInputOptions(parsed ?? {}) }}
      onOpenCheck={() => { setEditing(false); navigate({ task: taskId, tab: 'check' }); }} />
    <DeleteTaskDialog open={deleting} onOpenChange={setDeleting} name={saved.name} file={saved.file} runCount={taskRuns.length} activeCount={active.length} onConfirm={remove} />
  </div>;
}
