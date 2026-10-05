import { useMemo, useState } from 'react';
import { FileInput, Plus, Search } from 'lucide-react';
import { ko } from '../i18n/ko';
import { findRun, flattenRuns, environmentName, isFinished, type RunRef } from '../lib/runs';
import { allNodeIds, ancestorIds, buildTree, runNodeId, taskNodeId, type TreeFilter, type TreeNode } from '../lib/tree';
import { useHintSummaries, useRequestHintSummaries } from '../hooks/useHintSummaries';
import type { Route, RouteChange } from '../hooks/useRoute';
import type { PageProps } from '../pages/types';
import type { Experiment } from '../../shared/config';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { RunTree } from './RunTree';
import { TaskImportDialog } from './TaskImportDialog';

type SidebarProps = {
  pageProps: PageProps;
  experiments: Experiment[];
  route: Route;
  navigate: (change: RouteChange) => void;
  /** Rendered inside a Sheet: leave room for its close button. */
  inSheet?: boolean;
};

const filters: TreeFilter[] = ['all', 'hints', 'running', 'missed'];

/** Task → combination → run tree with search, a filter and the task section actions. */
export function Sidebar({ pageProps, experiments, route, navigate, inSheet }: SidebarProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TreeFilter>('all');
  const [importing, setImporting] = useState(false);
  const config = pageProps.view.config;
  const runs = useMemo(() => flattenRuns(experiments), [experiments]);
  const hintsFor = useHintSummaries();
  useRequestHintSummaries(filter === 'hints' ? runs.filter(ref => isFinished(ref.run)).map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })) : []);
  const nodes = useMemo(() => buildTree({
    tasks: config.tasks, runs, filter, query,
    environmentName: id => environmentName(config.environments, id),
    hintCount: runId => hintsFor(runId)?.reduce((sum, hint) => sum + hint.count, 0),
  }), [config.tasks, config.environments, runs, filter, query, hintsFor]);
  const selected: RunRef | undefined = findRun(runs, route.run);
  const taskId = selected?.run.taskId ?? (route.task && route.task !== 'new' ? route.task : undefined);
  const selectedId = selected ? runNodeId(selected.run.id) : taskId ? taskNodeId(taskId) : undefined;
  const revealIds = selected ? ancestorIds(selected) : taskId ? [taskNodeId(taskId)] : [];
  const narrowed = query.trim() !== '' || filter !== 'all';
  const expandAllKey = narrowed ? `${query}|${filter}|${allNodeIds(nodes).length}` : '';
  function select(node: TreeNode) {
    if (node.kind === 'run' && node.ref) navigate({ task: node.taskId, run: node.ref.run.id, tab: selected ? route.tab : 'hints' });
    else if (node.kind === 'task') navigate({ task: node.taskId });
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className={'grid gap-3 border-b p-3' + (inSheet ? ' pr-12' : '')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{ko.sidebar.tasks}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={ko.sidebar.importTask} title={ko.sidebar.importTask} onClick={() => setImporting(true)}><FileInput aria-hidden="true" /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={ko.sidebar.addTask} title={ko.sidebar.addTask} onClick={() => navigate({ task: 'new' })}><Plus aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="relative">
        <Label htmlFor="tree-search" className="sr-only">{ko.sidebar.search}</Label>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input id="tree-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={ko.sidebar.searchPlaceholder} className="h-8 pl-8 text-xs" />
      </div>
      <Select value={filter} onValueChange={value => setFilter(value as TreeFilter)}>
        <SelectTrigger size="sm" className="w-full text-xs" aria-label={ko.sidebar.filter}><SelectValue /></SelectTrigger>
        <SelectContent>{filters.map(id => <SelectItem key={id} value={id}>{ko.sidebar.filters[id]}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {nodes.length
        ? <RunTree nodes={nodes} selectedId={selectedId} revealIds={revealIds} expandAllKey={expandAllKey} hintsFor={hintsFor} onSelect={select} />
        : <p className="p-4 text-xs leading-5 text-muted-foreground">{narrowed ? ko.sidebar.emptyFiltered : ko.sidebar.empty}</p>}
    </div>
    <p className="border-t p-3 text-[11px] leading-4 text-muted-foreground">{ko.sidebar.treeHelp}</p>
    <TaskImportDialog {...pageProps} open={importing} onOpenChange={setImporting} onImported={id => navigate({ task: id })} />
  </div>;
}
