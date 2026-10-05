import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, ListTodo, Network, History, Settings, GitBranch, RefreshCw, Circle } from 'lucide-react';
import type { ConfigView, DashboardConfig, Experiment } from '../shared/config';
import { api } from './api';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from './components/ui/alert';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { TasksPage } from './pages/TasksPage';
import { ModelsPage } from './pages/ModelsPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
const tabs = [
  { id: 'experiments', name: '실험과 실행', icon: FlaskConical }, { id: 'tasks', name: '작업', icon: ListTodo },
  { id: 'models', name: '연결과 모델', icon: Network }, { id: 'history', name: '실행 이력', icon: History }, { id: 'settings', name: '전역 설정', icon: Settings },
];
export function App() {
  const [view, setView] = useState<ConfigView>();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [tab, setTab] = useState('experiments'), [focus, setFocus] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const refresh = useCallback(async () => {
    const [state, history] = await Promise.all([api<ConfigView>('/state'), api<Experiment[]>('/experiments')]);
    setView(state); setExperiments(history); setConnected(true);
  }, []);
  useEffect(() => {
    let disposed = false;
    const load = () => { if (!disposed) void refresh().catch(e => { if (!disposed) { setConnected(false); setError((e as Error).message); } }); };
    load(); const source = new EventSource('/api/events'); source.addEventListener('changed', load);
    source.onerror = () => { if (!disposed) setConnected(false); };
    return () => { disposed = true; source.close(); };
  }, [refresh]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save(config: DashboardConfig, taskWrite?: { file: string; task: unknown }, revision?: string) {
    const state = await api<ConfigView>('/config', { method: 'PUT', body: { config, revision: revision ?? view!.revision, ...(taskWrite ? { taskWrite } : {}) } });
    setView(state); setNotice('프로젝트 파일에 저장했습니다.'); return state;
  }
  const active = experiments.flatMap(e => e.runs).filter(r => r.state === 'running').length;
  const waiting = experiments.flatMap(e => e.runs).filter(r => r.state === 'queued').length;
  const props = view ? { view, save, act, busy } : undefined;
  return <div className="min-h-screen">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-primary focus:p-3 focus:text-primary-foreground">본문으로 이동</a>
    <header className="border-b px-5 py-4 lg:px-8"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid size-9 place-content-center rounded-lg bg-primary/10 text-primary"><GitBranch className="size-5" aria-hidden="true" /></div><span className="font-semibold tracking-tight">rawstep <span className="font-normal text-muted-foreground">/ dashboard</span></span><Badge variant="outline">LOCAL</Badge></div><div role="status" aria-live="polite" className="flex items-center gap-4 text-xs text-muted-foreground"><span>{active} 실행 중 · {waiting} 대기</span><span className="flex items-center gap-2"><Circle className={'size-2 fill-current ' + (connected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />{connected ? '서버 연결됨' : '재연결 중'}</span></div></div></header>
    <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="대시보드 메뉴" className="flex gap-1 overflow-x-auto border-b p-3 lg:sticky lg:top-0 lg:h-[calc(100vh-70px)] lg:flex-col lg:border-r lg:border-b-0 lg:p-5">{tabs.map(({ id, name, icon: Icon }) => <Button key={id} variant={tab === id ? 'secondary' : 'ghost'} aria-current={tab === id ? 'page' : undefined} className="shrink-0 justify-start lg:w-full" onClick={() => { setTab(id); setNotice(''); }}><Icon aria-hidden="true" />{name}</Button>)}<p className="mt-auto hidden px-3 pt-10 text-xs leading-6 text-muted-foreground lg:block">설정과 실행 기록은<br />이 프로젝트에 보관합니다.</p></nav>
      <main id="main" className="min-w-0 px-5 py-8 lg:px-8 lg:py-10">
        {error && <Alert variant="destructive" className="mb-6" role="alert"><AlertTitle>처리하지 못했습니다</AlertTitle><AlertDescription><p>{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await refresh(); setEditorKey(key => key + 1); })}><RefreshCw aria-hidden="true" />편집을 버리고 다시 불러오기</Button></AlertDescription></Alert>}
        {notice && <p role="status" className="mb-5 text-sm text-primary">{notice}</p>}
        {!props ? <div className="grid gap-4 py-20 text-center"><h1 className="text-xl font-medium">프로젝트를 불러오는 중</h1><p className="text-sm text-muted-foreground">로컬 Node 서비스의 연결 상태를 확인하고 있습니다.</p></div>
          : tab === 'experiments' ? <ExperimentsPage key={editorKey} {...props} onRun={e => { setFocus(e.runs[0]!.id); setTab('history'); }} />
          : tab === 'tasks' ? <TasksPage key={editorKey} {...props} />
          : tab === 'models' ? <ModelsPage key={editorKey} {...props} />
          : tab === 'settings' ? <SettingsPage key={editorKey} {...props} />
          : <HistoryPage key={editorKey} {...props} experiments={experiments} focus={focus} />}
      </main>
    </div>
  </div>;
}
