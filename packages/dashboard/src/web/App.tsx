import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectConfig } from '@rawstep/project/config';
import type { ConfigView, Experiment } from '../shared/config';
import { api } from './api';
import { useTranslation } from 'react-i18next';
import { findRun, flattenRuns } from './lib/runs';
import { LiveEventsProvider } from './hooks/useLiveEvents';
import { useDashboardData } from './hooks/useDashboardData';
import { useMediaQuery } from './hooks/useMediaQuery';
import { connectionLostView, describeApiError, type ErrorKind, type ErrorView } from './lib/errors';
import { NEW_TASK, useRoute } from './hooks/useRoute';
import type { MarkUnsaved, PageProps, Unsaved } from './pages/types';
import { BatchSummaryPage } from './pages/BatchSummaryPage';
import { ComparePage } from './pages/ComparePage';
import { NewTaskPage } from './pages/NewTaskPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { RunPage } from './pages/RunPage';
import { RunsPage } from './pages/RunsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TaskPage } from './pages/TaskPage';
import { TasksPage } from './pages/TasksPage';
import { AppNav } from './components/AppNav';
import { RunDialog } from './components/RunDialog';
import { StatusBanner } from './components/StatusBanner';
import { TopBar } from './components/TopBar';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet';

export function App() {
  return <LiveEventsProvider><Dashboard /></LiveEventsProvider>;
}

function Dashboard() {
  const { t } = useTranslation();
  const data = useDashboardData();
  const { route, navigate } = useRoute();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState<ErrorView>(), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  // A connection that was never made is a failed load; one that was made and dropped is a connection loss.
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => { if (data.connected) setEverConnected(true); }, [data.connected]);
  const [navOpen, setNavOpen] = useState(false);
  /** Which pages hold edits that are not saved, for the dots in the left navigation. */
  const [unsaved, setUnsaved] = useState<Unsaved>({});
  const markUnsaved = useCallback<MarkUnsaved>((part, value) => setUnsaved(current => current[part] === value ? current : { ...current, [part]: value }), []);
  /** The run dialog, with the tasks it opens with (the task page's own, or the tasks picked in the list). */
  const [running, setRunning] = useState<{ open: boolean; taskIds: string[] }>({ open: false, taskIds: [] });
  const { view, setView, refresh } = data;
  const runs = useMemo(() => flattenRuns(data.experiments), [data.experiments]);

  const act = useCallback(async (work: () => Promise<unknown>, options?: { as?: ErrorKind }) => {
    setBusy(true); setError(undefined); setNotice('');
    try { await work(); await refresh(); } catch (e) { setError(describeApiError(e, options?.as)); } finally { setBusy(false); }
  }, [refresh]);
  const save = useCallback(async (config: ProjectConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => {
    const state = await api<ConfigView>('/config', { method: 'PUT', body: { config, revision: revision ?? view!.revision, ...(taskWrite ? { taskWrite } : {}) } });
    setView(state); setNotice(t('app.saved'));
    return state;
  }, [view, setView]);
  const go: typeof navigate = (change, options) => { setNotice(''); setNavOpen(false); navigate(change, options); };
  const reload = () => void act(async () => { await refresh(); setEditorKey(key => key + 1); });
  const pageProps: PageProps | undefined = view ? { view, save, act, busy, notify: setNotice } : undefined;
  const lost = everConnected && !data.connected;
  const banner = <StatusBanner error={error ?? data.loadError ?? (lost ? connectionLostView() : undefined)} notice={notice} busy={busy} onReload={reload} navigate={go} />;

  const active = runs.filter(ref => ref.run.state === 'running').length;
  const queued = runs.filter(ref => ref.run.state === 'queued').length;
  /** Opens the first run of what was just started: its task page when several tasks run, else the run itself. */
  const openRun = (experiment: Experiment) => {
    const first = experiment.runs[0];
    if (first) go(new Set(experiment.runs.map(run => run.taskId)).size > 1 ? { view: 'runs' } : { task: first.taskId, run: first.id });
  };
  const openRunDialog = (taskIds: string[]) => setRunning({ open: true, taskIds });

  return <div className="flex h-screen flex-col">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-primary focus:p-3 focus:text-primary-foreground">{t('app.skip')}</a>
    <TopBar connected={data.connected} running={active} queued={queued} showNavigation={!wide && !!pageProps} onNavigation={() => setNavOpen(true)} />
    <div className="flex min-h-0 flex-1">
      {wide && pageProps && <aside className="w-48 shrink-0 border-r bg-sidebar text-sidebar-foreground"><AppNav route={route} navigate={go} unsaved={unsaved} /></aside>}
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-5 outline-none lg:px-6">
        <div className="grid gap-4">
          {!running.open && banner}
          {!pageProps
            ? <div className="grid gap-4 py-20 text-center"><h1 className="text-xl font-medium">{t('app.loadingTitle')}</h1><p className="text-sm text-muted-foreground">{t('app.loadingBody')}</p></div>
            : <Page pageProps={pageProps} data={data} runs={runs} route={route} navigate={go} editorKey={editorKey} onRun={openRunDialog} onUnsaved={markUnsaved} />}
        </div>
      </main>
    </div>
    {pageProps && <>
      {!wide && <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-56 gap-0 p-0 data-[side=left]:sm:max-w-56">
          <SheetHeader className="sr-only"><SheetTitle>{t('nav.label')}</SheetTitle><SheetDescription>{t('nav.description')}</SheetDescription></SheetHeader>
          <div className="pt-10"><AppNav route={route} navigate={go} unsaved={unsaved} /></div>
        </SheetContent>
      </Sheet>}
      <RunDialog open={running.open} onOpenChange={open => setRunning(current => ({ ...current, open }))} taskIds={running.taskIds} pageProps={pageProps} navigate={go} onStarted={openRun} />
    </>}
  </div>;
}

type PageSwitchProps = {
  pageProps: PageProps; data: ReturnType<typeof useDashboardData>; runs: ReturnType<typeof flattenRuns>;
  route: ReturnType<typeof useRoute>['route']; navigate: ReturnType<typeof useRoute>['navigate']; editorKey: number;
  /** Opens the run dialog with these tasks picked. */
  onRun: (taskIds: string[]) => void;
  /** Tells the left navigation whether a page has edits that are not saved. */
  onUnsaved: MarkUnsaved;
};

/** Chooses the page for the URL: a run, a task or the new-task page, otherwise a batch's summary, runs side by side, the run list, 실행 프로필, 설정, or the task list. */
function Page({ pageProps, data, runs, route, navigate, editorKey, onRun, onUnsaved }: PageSwitchProps) {
  const { t } = useTranslation();
  if (route.run) {
    const runRef = findRun(runs, route.run);
    return runRef
      ? <RunPage key={runRef.run.id + editorKey} runRef={runRef} runs={runs} route={route} pageProps={pageProps} navigate={navigate} />
      : <div className="grid justify-items-start gap-3 py-10">
        <p>{t('run.notFound')}</p>
        <Button variant="outline" onClick={() => navigate({ view: 'runs' })}>{t('run.backToRuns')}</Button>
      </div>;
  }
  if (route.task === NEW_TASK) return <NewTaskPage key={editorKey} {...pageProps} navigate={navigate} />;
  if (route.task) return <TaskPage key={route.task + editorKey} taskId={route.task} tab={route.tab} pageProps={pageProps} runs={runs} navigate={navigate} onRun={() => onRun([route.task!])} />;
  const lists = { pageProps, runs, summaries: data.summaries, summaryError: data.summaryError, navigate };
  if (route.view === 'runs' && route.batch) return <BatchSummaryPage key={route.batch} pageProps={pageProps} experiments={data.experiments} runs={runs} batchId={route.batch} against={route.against} navigate={navigate} />;
  if (route.view === 'runs' && route.compare) return <ComparePage pageProps={pageProps} runs={runs} ids={route.compare} navigate={navigate} />;
  if (route.view === 'runs') return <RunsPage {...lists} onRun={() => onRun([])} />;
  if (route.view === 'profiles') return <ProfilesPage key={editorKey} {...pageProps} navigate={navigate} onUnsaved={onUnsaved} />;
  if (route.view === 'settings') return <SettingsPage key={editorKey} {...pageProps} section={route.section} navigate={navigate} onUnsaved={onUnsaved} />;
  return <TasksPage {...lists} onRun={onRun} />;
}
