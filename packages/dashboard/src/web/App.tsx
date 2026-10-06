import { useCallback, useMemo, useState } from 'react';
import type { ProjectConfig } from '@rawstep/project/config';
import type { ConfigView, Experiment } from '../shared/config';
import { api } from './api';
import { useTranslation } from 'react-i18next';
import { findRun, flattenRuns } from './lib/runs';
import { startDefaultRun } from './lib/quickRun';
import { LiveEventsProvider } from './hooks/useLiveEvents';
import { useDashboardData } from './hooks/useDashboardData';
import { useMediaQuery } from './hooks/useMediaQuery';
import { NEW_TASK, useRoute } from './hooks/useRoute';
import type { PageProps } from './pages/types';
import { HomePage } from './pages/HomePage';
import { RunsPage } from './pages/RunsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';
import { AppNav } from './components/AppNav';
import { NewExperimentDialog } from './components/NewExperimentDialog';
import { NewTaskPage } from './components/NewTaskPage';
import { RunDetail } from './components/RunDetail';
import { StatusBanner } from './components/StatusBanner';
import { TaskDetail } from './components/TaskDetail';
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
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  /** The experiment builder; `taskId` preselects a task when it was opened from that task. */
  const [compare, setCompare] = useState<{ open: boolean; taskId?: string }>({ open: false });
  const { view, setView, refresh } = data;
  const runs = useMemo(() => flattenRuns(data.experiments), [data.experiments]);

  const act = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [refresh]);
  const save = useCallback(async (config: ProjectConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => {
    const state = await api<ConfigView>('/config', { method: 'PUT', body: { config, revision: revision ?? view!.revision, ...(taskWrite ? { taskWrite } : {}) } });
    setView(state); setNotice(t('app.saved'));
    return state;
  }, [view, setView]);
  const reload = () => void act(async () => { await refresh(); setEditorKey(key => key + 1); });
  const pageProps: PageProps | undefined = view ? { view, save, act, busy } : undefined;
  const banner = <StatusBanner error={error || data.loadError} notice={notice} busy={busy} onReload={reload} />;

  const go: typeof navigate = (change, options) => { setNotice(''); setNavOpen(false); navigate(change, options); };
  const running = runs.filter(ref => ref.run.state === 'running').length;
  const queued = runs.filter(ref => ref.run.state === 'queued').length;
  const openRun = (experiment: Experiment) => {
    const first = experiment.runs[0];
    setCompare({ open: false });
    if (first) go({ task: first.taskId, run: first.id });
  };
  const runDefault = (taskId: string) => void act(async () => openRun(await startDefaultRun(view!, taskId)));

  return <div className="flex h-screen flex-col">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-primary focus:p-3 focus:text-primary-foreground">{t('app.skip')}</a>
    <TopBar connected={data.connected} running={running} queued={queued} showNavigation={!wide && !!pageProps} onNavigation={() => setNavOpen(true)} />
    <div className="flex min-h-0 flex-1">
      {wide && pageProps && <aside className="w-48 shrink-0 border-r bg-sidebar text-sidebar-foreground"><AppNav route={route} navigate={go} /></aside>}
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-5 outline-none lg:px-6">
        <div className="mx-auto grid max-w-7xl gap-4">
          {!compare.open && banner}
          {!pageProps
            ? <div className="grid gap-4 py-20 text-center"><h1 className="text-xl font-medium">{t('app.loadingTitle')}</h1><p className="text-sm text-muted-foreground">{t('app.loadingBody')}</p></div>
            : <Page pageProps={pageProps} data={data} runs={runs} route={route} navigate={go} editorKey={editorKey} onCompare={taskId => setCompare({ open: true, ...(taskId ? { taskId } : {}) })} onRunDefault={runDefault} />}
        </div>
      </main>
    </div>
    {pageProps && <>
      {!wide && <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-56 gap-0 p-0 data-[side=left]:sm:max-w-56">
          <SheetHeader className="sr-only"><SheetTitle>{t('nav.label')}</SheetTitle><SheetDescription>{t('nav.description')}</SheetDescription></SheetHeader>
          <div className="pt-10"><AppNav route={route} navigate={go} /></div>
        </SheetContent>
      </Sheet>}
      <NewExperimentDialog open={compare.open} onOpenChange={open => setCompare({ open, ...(compare.taskId ? { taskId: compare.taskId } : {}) })} taskId={compare.taskId} pageProps={pageProps} banner={banner} editorKey={editorKey} onCreated={openRun} />
    </>}
  </div>;
}

type PageSwitchProps = {
  pageProps: PageProps; data: ReturnType<typeof useDashboardData>; runs: ReturnType<typeof flattenRuns>;
  route: ReturnType<typeof useRoute>['route']; navigate: ReturnType<typeof useRoute>['navigate']; editorKey: number;
  onCompare: (taskId?: string) => void; onRunDefault: (taskId: string) => void;
};

/** Chooses the page for the URL: a run, a task or the new-task page, otherwise the list or settings page of the current view. */
function Page({ pageProps, data, runs, route, navigate, editorKey, onCompare, onRunDefault }: PageSwitchProps) {
  const { t } = useTranslation();
  if (route.run) {
    const runRef = findRun(runs, route.run);
    return runRef
      ? <RunDetail key={runRef.run.id + editorKey} runRef={runRef} route={route} pageProps={pageProps} navigate={navigate} />
      : <div className="grid justify-items-start gap-3 py-10">
        <p>{t('run.notFound')}</p>
        <Button variant="outline" onClick={() => navigate({ view: 'runs' })}>{t('run.backToRuns')}</Button>
      </div>;
  }
  if (route.task === NEW_TASK) return <NewTaskPage key={editorKey} {...pageProps} navigate={navigate} />;
  if (route.task) return <TaskDetail key={route.task + editorKey} taskId={route.task} pageProps={pageProps} runs={runs} navigate={navigate} onCompare={onCompare} />;
  const lists = { pageProps, runs, summaries: data.summaries, summaryError: data.summaryError, navigate };
  if (route.view === 'tasks') return <TasksPage {...lists} onRunDefault={onRunDefault} />;
  if (route.view === 'runs') return <RunsPage {...lists} onCompare={() => onCompare()} />;
  if (route.view === 'settings') return <SettingsPage pageProps={pageProps} section={route.section} navigate={navigate} editorKey={editorKey} />;
  return <HomePage {...lists} />;
}
