import { useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RunsTable } from '../components/RunsTable';
import { Button } from '../components/ui/button';
import { Choice } from '../components/forms';
import { isFinished, isLive } from '../lib/runs';
import type { ListProps } from './types';

const PAGE = 50;
const ALL = '__all__';
const results = ['all', 'success', 'failure', 'inconclusive', 'live'] as const;
type Result = (typeof results)[number];

/** Every run of every task, newest first, narrowed by task, model and result. */
export function RunsPage({ pageProps, runs, navigate, onCompare }: ListProps & { onCompare: () => void }) {
  const { t } = useTranslation();
  const [task, setTask] = useState(ALL), [model, setModel] = useState(ALL), [result, setResult] = useState<Result>('all'), [shown, setShown] = useState(PAGE);
  const { config } = pageProps.view;
  const tasks = useMemo(() => [...new Map(runs.map(ref => [ref.run.taskId, ref.run.snapshot.taskName])).entries()], [runs]);
  const models = useMemo(() => [...new Map(runs.map(ref => [ref.run.modelId, ref.run.snapshot.model.name])).entries()], [runs]);
  const matching = runs.filter(({ run }) => (task === ALL || run.taskId === task) && (model === ALL || run.modelId === model)
    && (result === 'all' || (result === 'live' ? isLive(run) : isFinished(run) && run.state === result)));
  const options = (items: [string, string][]) => [{ id: ALL, name: t('runList.all') }, ...items.map(([id, name]) => ({ id, name }))];
  return <div className="grid gap-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">{t('runList.title')}</h1><p className="mt-1 text-sm text-muted-foreground">{t('runList.count', { count: runs.length })}</p></div>
      <Button size="xl" disabled={config.tasks.length === 0} onClick={onCompare}><ListFilter aria-hidden="true" />{t('runList.compare')}</Button>
    </header>
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-52"><Choice label={t('runList.filters.task')} value={task} onChange={value => { setTask(value); setShown(PAGE); }} options={options(tasks)} /></div>
      <div className="w-52"><Choice label={t('runList.filters.model')} value={model} onChange={value => { setModel(value); setShown(PAGE); }} options={options(models)} /></div>
      <div className="w-44"><Choice label={t('runList.filters.result')} value={result} onChange={value => { setResult(value as Result); setShown(PAGE); }} options={results.map(id => ({ id, name: t(`runList.results.${id}`) }))} /></div>
    </div>
    {runs.length === 0
      ? <div className="grid justify-items-center gap-2 rounded-lg border border-dashed py-14 text-center"><p className="font-medium">{t('runList.empty')}</p><p className="max-w-md text-sm text-muted-foreground">{t('runList.emptyHint')}</p></div>
      : matching.length === 0
        ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('runList.noMatch')}</p>
        : <>
          <RunsTable runs={matching.slice(0, shown)} profiles={config.profiles} navigate={navigate} detailed />
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t('runList.shown', { shown: Math.min(shown, matching.length), total: matching.length })}</span>
            {matching.length > shown && <Button variant="outline" onClick={() => setShown(shown + PAGE)}>{t('runList.more')}</Button>}
          </div>
        </>}
  </div>;
}
