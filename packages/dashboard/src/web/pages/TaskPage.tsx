import { RunsTable } from '../components/RunsTable';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedTask } from '@rawstep/project/config';
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
import { SaveBar } from '../components/conditions/SaveBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useTaskFindings } from '../hooks/useTaskFindings';
import { taskTabs, type RouteChange, type TaskTab } from '../hooks/useRoute';
import { isLive, taskRunNumbers, type RunRef } from '../lib/runs';
import type { RunOptions } from '../lib/quickRun';
import { createManagedTask } from '../lib/taskFiles';
import { CONDITION_KINDS, FIELD, type TaskConditionIds } from '../lib/taskConditions';
import { inputFields, taskInputOptions, taskInputs } from '../lib/taskInputs';
import { parseTaskJson, sameTaskJson, taskRules, updateTaskJson, withRules } from '../lib/taskJson';
import type { PageProps } from './types';

type Props = {
  taskId: string; tab: TaskTab; pageProps: PageProps; runs: RunRef[];
  navigate: (change: RouteChange, options?: { replace?: boolean }) => void;
  onCompare: (taskId: string) => void; onRun: (taskId: string, options: RunOptions) => void;
};

const CONDITION_KEYS = ['presetId', ...CONDITION_KINDS.map(kind => FIELD[kind])] as const;
/** The condition ids a task names itself. */
const conditionIds = (task: ManagedTask): TaskConditionIds => Object.fromEntries(CONDITION_KEYS.flatMap(key => task[key] ? [[key, task[key]]] : []));
const withoutConditions = (task: ManagedTask): ManagedTask => { const copy = { ...task }; for (const key of CONDITION_KEYS) delete copy[key]; return copy; };

/** Sends a person to the run bar of the task header, for an empty state that says "run it". */
function focusRunControl() {
  const form = document.getElementById('task-run-control');
  form?.scrollIntoView({ block: 'center' });
  form?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
}

/**
 * A task as one investigation sheet: its header (what it is, how to run it, the conditions of the next run), then 개요 (what the runs
 * found), 실행 기록, 완료 확인 and 설정. Name, address, goal and inputs are edited in the 작업 수정 sheet, conditions in the conditions
 * sheet of the header; the 완료 확인 and 설정 tabs share one draft saved from one bar. Mount with `key={taskId}` so drafts do not leak.
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
  const savedParsed = parseTaskJson(savedJson) ?? {}, savedRules = taskRules(savedParsed);
  /** The draft with the sheet's name and conditions: an id is kept even when it names the first entry, so the choice survives reordering. */
  const withChoice = (entry: ManagedTask, basics: Pick<TaskBasics, 'name' | 'conditions'>): ManagedTask => ({ ...withoutConditions(entry), ...basics.conditions, name: basics.name });
  // What the 세부 설정 tab changed, apart from what the sheet owns (the inputs are edited in both, so the sheet saves them with the rest).
  const otherChanges = JSON.stringify({ ...withoutConditions(task), ...conditionIds(saved), name: saved.name }) !== JSON.stringify({ ...withoutConditions(saved), ...conditionIds(saved) })
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
          await write({ task: withChoice(entry, basics), json: updateTaskJson(JSON.stringify(latest.tasks[taskId] ?? {}, null, 2), { url: basics.url, goal: basics.goal, ...inputFields(basics.input, basics.inputOptions) }) }, latest.revision, latest.config);
        } else await write({ task: withChoice(task, basics), json: updateTaskJson(json, { url: basics.url, goal: basics.goal, ...inputFields(basics.input, basics.inputOptions) }) }, revision);
        pageProps.notify(t('taskEdit.saved'));
      } catch (error) { result = { ok: false, conflict: error instanceof ApiError && error.status === 409, error }; }
    });
    return result;
  };
  const duplicate = () => void pageProps.act(async () => {
    const copy = await createManagedTask(pageProps, {
      name: t('taskPage.copyName', { name: saved.name }), slug: saved.file.replace(/^tasks\//, '').replace(/\.json$/i, ''), task: savedParsed, copyOf: saved,
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
    <TaskHeader taskId={taskId} name={saved.name} url={String(savedParsed.url ?? '')} goal={String(savedParsed.goal ?? '')}
      pageProps={pageProps} runs={taskRuns} navigate={navigate} onRun={options => onRun(taskId, options)} onCompare={() => onCompare(taskId)}
      onEdit={() => setEditing(true)} onDuplicate={duplicate} onDelete={() => setDeleting(true)} />

    <Tabs value={tab} onValueChange={value => navigate({ task: taskId, tab: value as TaskTab }, { replace: true })} className="gap-4">
      <TabsList variant="line" aria-label={t('taskPage.tabsLabel')}>
        {taskTabs.map(id => { const count = id === 'runs' ? taskRuns.length : id === 'check' ? savedRules.length : undefined;
          return <TabsTrigger key={id} value={id}>{t(`taskPage.tabs.${id}`)}{count !== undefined && <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}</TabsTrigger>; })}
      </TabsList>
      <TabsContent value="overview"><TaskOverview taskId={taskId} runs={taskRuns} numbers={numbers} findings={findings} navigate={navigate} onRun={focusRunControl} /></TabsContent>
      <TabsContent value="runs">
        <section aria-label={t('taskPage.tabs.runs')} className="grid gap-2">
          {taskRuns.length > 0
            ? <RunsTable runs={taskRuns} config={config} navigate={navigate} hideTask numbers={numbers} showConditions showHints />
            : <EmptyState compact title={t('taskPage.runsTabEmpty')} action={<Button variant="outline" size="sm" onClick={focusRunControl}>{t('empty.taskRuns.action')}</Button>} />}
        </section>
      </TabsContent>
      <TabsContent value="check"><TaskChecks rules={rules} onRules={next => setJson(withRules(json, next))} url={String(parsed?.url ?? '')} goal={String(parsed?.goal ?? '')} view={view} /></TabsContent>
      <TabsContent value="settings"><TaskSettings task={task} onTask={setTask} json={json} onJson={setJson} view={view} onEdit={() => setEditing(true)} /></TabsContent>
    </Tabs>

    {tab !== 'overview' && tab !== 'runs' && <SaveBar dirty={dirty} busy={pageProps.busy} behind={behind} onSave={() => void pageProps.act(behind ? saveOnLatest : save)} onDiscard={discard} />}

    <TaskEditSheet open={editing} onOpenChange={setEditing} busy={pageProps.busy} otherChanges={otherChanges} onSave={saveBasics}
      initial={{ name: task.name, url: String(parsed?.url ?? ''), goal: String(parsed?.goal ?? ''), conditions: conditionIds(task), input: taskInputs(parsed ?? {}), inputOptions: taskInputOptions(parsed ?? {}) }}
    />
    <DeleteTaskDialog open={deleting} onOpenChange={setDeleting} name={saved.name} file={saved.file} runCount={taskRuns.length} activeCount={active.length} onConfirm={remove} />
  </div>;
}
