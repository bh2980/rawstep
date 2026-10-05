import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, ListTodo, Layers } from 'lucide-react';
import { ko } from '../i18n/ko';
import { cn } from '../lib/utils';
import { formatDate, isFinished, runStartedAt, runStepCount } from '../lib/runs';
import { allNodeIds, flattenTree, type TreeNode } from '../lib/tree';
import { requestHintSummary, type HintCount } from '../hooks/useHintSummaries';
import { RunStateLabel } from './RunStateLabel';
import { HintBadge } from './HintBadge';

export type RunTreeProps = {
  nodes: TreeNode[];
  selectedId: string | undefined;
  /** Ids to expand whenever this key changes, e.g. the ancestors of the selected run. */
  revealIds: string[];
  /** Expands every node whenever this key changes; used by search and filters. */
  expandAllKey: string;
  hintsFor: (runId: string) => HintCount[] | undefined;
  onSelect: (node: TreeNode) => void;
};

type Position = { posinset: number; setsize: number; parentId?: string };

function positions(nodes: readonly TreeNode[], parentId?: string, into = new Map<string, Position>()) {
  nodes.forEach((node, index) => {
    into.set(node.id, { posinset: index + 1, setsize: nodes.length, ...(parentId ? { parentId } : {}) });
    positions(node.children, node.id, into);
  });
  return into;
}

/** WAI-ARIA tree: roving tabindex, Arrow keys, Home/End, Enter or Space to select. */
export function RunTree({ nodes, selectedId, revealIds, expandAllKey, hintsFor, onSelect }: RunTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(revealIds));
  const [focusId, setFocusId] = useState<string>();
  const items = useRef(new Map<string, HTMLDivElement>());
  const revealKey = revealIds.join('|');
  useEffect(() => {
    if (revealIds.length) setExpanded(previous => new Set([...previous, ...revealIds]));
  }, [revealKey]);
  useEffect(() => {
    if (expandAllKey) setExpanded(new Set(allNodeIds(nodes)));
  }, [expandAllKey]);
  const visible = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const where = useMemo(() => positions(nodes), [nodes]);
  const activeId = visible.some(node => node.id === focusId) ? focusId
    : visible.some(node => node.id === selectedId) ? selectedId : visible[0]?.id;

  const toggle = (node: TreeNode, open?: boolean) => setExpanded(previous => {
    const next = new Set(previous), isOpen = open ?? !previous.has(node.id);
    if (isOpen) next.add(node.id); else next.delete(node.id);
    return next;
  });
  const focusNode = (node: TreeNode | undefined) => {
    if (!node) return;
    setFocusId(node.id);
    items.current.get(node.id)?.focus();
  };
  const activate = (node: TreeNode) => {
    if (node.kind === 'combo') { toggle(node); return; }
    onSelect(node);
    if (node.kind === 'task') toggle(node, true);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, node: TreeNode) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = visible.findIndex(item => item.id === node.id), open = expanded.has(node.id);
    const parentId = where.get(node.id)?.parentId;
    const handled = (() => {
      switch (event.key) {
        case 'ArrowDown': focusNode(visible[index + 1]); return true;
        case 'ArrowUp': focusNode(visible[index - 1]); return true;
        case 'Home': focusNode(visible[0]); return true;
        case 'End': focusNode(visible[visible.length - 1]); return true;
        case 'ArrowRight':
          if (node.children.length && !open) toggle(node, true);
          else if (node.children.length) focusNode(visible[index + 1]);
          return true;
        case 'ArrowLeft':
          if (node.children.length && open) toggle(node, false);
          else if (parentId) focusNode(visible.find(item => item.id === parentId));
          return true;
        case 'Enter': case ' ': activate(node); return true;
        default: return false;
      }
    })();
    if (handled) event.preventDefault();
  }

  return <div role="tree" aria-label={ko.sidebar.tree} className="grid gap-px p-1">
    {visible.map(node => <TreeRow key={node.id} node={node} position={where.get(node.id)!}
      active={node.id === activeId} selected={node.id === selectedId}
      expanded={node.children.length ? expanded.has(node.id) : undefined}
      hints={node.ref ? hintsFor(node.ref.run.id) : undefined}
      register={element => { if (element) items.current.set(node.id, element); else items.current.delete(node.id); }}
      onFocus={() => setFocusId(node.id)} onKeyDown={event => onKeyDown(event, node)}
      onClick={() => activate(node)} onToggle={() => toggle(node)} />)}
  </div>;
}

type RowProps = {
  node: TreeNode; position: Position; active: boolean; selected: boolean;
  expanded: boolean | undefined; hints: HintCount[] | undefined;
  register: (element: HTMLDivElement | null) => void;
  onFocus: () => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onClick: () => void; onToggle: () => void;
};

function TreeRow({ node, position, active, selected, expanded, hints, register, onFocus, onKeyDown, onClick, onToggle }: RowProps) {
  const ref = node.ref;
  useEffect(() => {
    if (ref && isFinished(ref.run)) requestHintSummary(ref.experiment.id, ref.run.id);
  }, [ref?.experiment.id, ref?.run.id, ref?.run.state]);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const rowClass = cn(
    'flex cursor-pointer items-start gap-1 rounded-md py-1.5 pr-2 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'bg-accent font-medium ring-1 ring-border',
  );
  return <div role="treeitem" ref={register} tabIndex={active ? 0 : -1}
    aria-level={node.level} aria-setsize={position.setsize} aria-posinset={position.posinset}
    aria-expanded={expanded} aria-selected={selected}
    onFocus={onFocus} onKeyDown={onKeyDown} onClick={onClick}
    style={{ paddingLeft: `${(node.level - 1) * 14 + 4}px` }} className={rowClass}>
    <span className="mt-0.5 grid size-4 shrink-0 place-content-center text-muted-foreground"
      onClick={node.children.length ? event => { event.stopPropagation(); onToggle(); } : undefined}>
      {node.children.length ? <Chevron className="size-3.5" aria-hidden="true" /> : null}
    </span>
    {node.kind === 'run' && ref ? <RunRowBody node={node} hints={hints} /> : <GroupRowBody node={node} />}
  </div>;
}

function GroupRowBody({ node }: { node: TreeNode }) {
  const Icon = node.kind === 'task' ? ListTodo : Layers;
  const meta = [
    node.detail,
    node.runTotal ? ko.sidebar.runCount(node.runTotal) : ko.sidebar.noRuns,
    node.liveTotal ? ko.sidebar.liveCount(node.liveTotal) : '',
  ].filter(Boolean).join(' · ');
  return <span className="grid min-w-0 flex-1 gap-0.5">
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className={cn('truncate', node.kind === 'task' && 'font-medium')}>{node.label}</span>
    </span>
    <span className="pl-5 text-[11px] font-normal text-muted-foreground">{meta}</span>
  </span>;
}

function RunRowBody({ node, hints }: { node: TreeNode; hints: HintCount[] | undefined }) {
  const ref = node.ref!, steps = runStepCount(ref.run);
  return <span className="grid min-w-0 flex-1 gap-1">
    <span className="flex items-baseline justify-between gap-2">
      <span>{node.label}</span>
      <span className="text-[11px] font-normal tabular-nums text-muted-foreground">{formatDate(runStartedAt(ref))}</span>
    </span>
    <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-normal text-muted-foreground">
      <RunStateLabel state={ref.run.state} />
      {steps !== undefined && <span className="tabular-nums">{ko.sidebar.steps(steps)}</span>}
    </span>
    {hints && hints.length > 0 && <span className="flex flex-wrap gap-1">
      {hints.slice(0, 2).map(hint => <HintBadge key={hint.kind} kind={hint.kind} count={hint.count} />)}
    </span>}
  </span>;
}
