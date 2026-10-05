import { useCallback, useMemo, useState } from 'react';
import type { ConfigView, DashboardConfig, Experiment } from '../shared/config';
import { api } from './api';
import { useTranslation } from 'react-i18next';
import { findRun, flattenRuns } from './lib/runs';
import { LiveEventsProvider } from './hooks/useLiveEvents';
import { useDashboardData } from './hooks/useDashboardData';
import { useMediaQuery } from './hooks/useMediaQuery';
import { NEW_TASK, useRoute } from './hooks/useRoute';
import type { PageProps } from './pages/types';
import { NewTaskPage } from './components/NewTaskPage';
import { NewExperimentDialog } from './components/NewExperimentDialog';
import { OverviewTable } from './components/OverviewTable';
import { RunDetail } from './components/RunDetail';
import { SettingsSheet } from './components/SettingsSheet';
import { Sidebar } from './components/Sidebar';
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
  const [navOpen, setNavOpen] = useState(false), [newOpen, setNewOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const { view, setView, refresh } = data;
  const runs = useMemo(() => flattenRuns(data.experiments), [data.experiments]);

  const act = useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [refresh]);
  const save = useCallback(async (config: DashboardConfig, taskWrite?: { file: string; task: unknown }, revision?: string) => {
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
  const created = (experiment: Experiment) => {
    const first = experiment.runs[0];
    setNewOpen(false);
    if (first) go({ task: first.taskId, run: first.id });
  };

  return <div className="flex h-screen flex-col">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-primary focus:p-3 focus:text-primary-foreground">{t('app.skip')}</a>
    <TopBar connected={data.connected} running={running} queued={queued} showNavigation={!wide && !!pageProps}
      onNavigation={() => setNavOpen(true)} onNewExperiment={() => setNewOpen(true)} onSettings={() => setSettingsOpen(true)} />
    <div className="flex min-h-0 flex-1">
      {wide && pageProps && <aside aria-label={t('sidebar.label')} className="w-80 shrink-0 border-r bg-sidebar text-sidebar-foreground">
        <Sidebar pageProps={pageProps} experiments={data.experiments} route={route} navigate={go} />
      </aside>}
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-5 py-6 outline-none lg:px-8 lg:py-8">
        <div className="mx-auto grid max-w-6xl gap-5">
          {!settingsOpen && !newOpen && banner}
          {!pageProps
            ? <div className="grid gap-4 py-20 text-center"><h1 className="text-xl font-medium">{t('app.loadingTitle')}</h1><p className="text-sm text-muted-foreground">{t('app.loadingBody')}</p></div>
            : <Detail pageProps={pageProps} data={data} runs={runs} route={route} navigate={go} editorKey={editorKey} />}
        </div>
      </main>
    </div>
    {pageProps && <>
      {!wide && <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-80 gap-0 p-0 data-[side=left]:sm:max-w-80">
          <SheetHeader className="sr-only"><SheetTitle>{t('sidebar.label')}</SheetTitle><SheetDescription>{t('sidebar.treeHelp')}</SheetDescription></SheetHeader>
          <Sidebar pageProps={pageProps} experiments={data.experiments} route={route} navigate={go} inSheet />
        </SheetContent>
      </Sheet>}
      <NewExperimentDialog open={newOpen} onOpenChange={setNewOpen} pageProps={pageProps} banner={banner} editorKey={editorKey} onCreated={created} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} pageProps={pageProps} banner={banner} editorKey={editorKey} />
    </>}
  </div>;
}

type DetailProps = {
  pageProps: PageProps; data: ReturnType<typeof useDashboardData>; runs: ReturnType<typeof flattenRuns>;
  route: ReturnType<typeof useRoute>['route']; navigate: ReturnType<typeof useRoute>['navigate']; editorKey: number;
};

function Detail({ pageProps, data, runs, route, navigate, editorKey }: DetailProps) {
  const { t } = useTranslation();
  if (route.run) {
    const runRef = findRun(runs, route.run);
    return runRef
      ? <RunDetail key={runRef.run.id + editorKey} runRef={runRef} route={route} pageProps={pageProps} navigate={navigate} />
      : <div className="grid justify-items-start gap-3 py-10">
        <p>{t('run.notFound')}</p>
        <Button variant="outline" onClick={() => navigate({})}>{t('run.backToOverview')}</Button>
      </div>;
  }
  if (route.task === NEW_TASK) return <NewTaskPage key={editorKey} {...pageProps} navigate={navigate} />;
  if (route.task) return <TaskDetail key={route.task + editorKey} taskId={route.task} pageProps={pageProps} runs={runs} navigate={navigate} />;
  return <OverviewTable rows={data.overview} runs={runs} error={data.overviewError} navigate={navigate} />;
}
