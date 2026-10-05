import { ko } from '../i18n/ko';
import { isFinished, isLive, type RunRef } from './runs';

export type TreeFilter = 'all' | 'hints' | 'running' | 'missed';
export type TreeKind = 'task' | 'combo' | 'run';
export type TreeNode = {
  id: string; kind: TreeKind; level: 1 | 2 | 3; label: string; detail: string;
  taskId: string; parentId?: string; children: TreeNode[]; ref?: RunRef; runTotal: number; liveTotal: number;
};
export type TreeInput = {
  tasks: readonly { id: string; name: string }[];
  runs: readonly RunRef[];
  environmentName: (id: string) => string;
  filter: TreeFilter;
  query: string;
  hintCount: (runId: string) => number | undefined;
};

export const taskNodeId = (taskId: string) => `task:${taskId}`;
export const comboNodeId = (taskId: string, ref: RunRef) => `combo:${taskId}:${ref.run.snapshot.mode}:${ref.run.modelId}:${ref.run.promptId}:${ref.run.environmentId}`;
export const runNodeId = (runId: string) => `run:${runId}`;

function matchesFilter(ref: RunRef, filter: TreeFilter, hintCount: TreeInput['hintCount']): boolean {
  if (filter === 'hints') return (hintCount(ref.run.id) ?? 0) > 0;
  if (filter === 'running') return isLive(ref.run);
  if (filter === 'missed') return ref.run.state === 'failure';
  return true;
}

/** Task → combination (model · prompt · environment) → runs, newest first. Orphaned runs keep the task name they were recorded with. */
export function buildTree(input: TreeInput): TreeNode[] {
  const query = input.query.trim().toLowerCase();
  const tasks = new Map(input.tasks.map(task => [task.id, task.name]));
  for (const { run } of input.runs) if (!tasks.has(run.taskId)) tasks.set(run.taskId, run.snapshot.taskName || ko.sidebar.unnamedTask);
  const narrowed = input.filter !== 'all';
  const nodes: TreeNode[] = [];
  for (const [taskId, taskName] of tasks) {
    const taskRuns = input.runs.filter(ref => ref.run.taskId === taskId);
    const visibleRuns = taskRuns.filter(ref => matchesFilter(ref, input.filter, input.hintCount) && (!query || searchText(ref, taskName, input.environmentName).includes(query)));
    const taskMatches = !query || taskName.toLowerCase().includes(query);
    if (!visibleRuns.length && (narrowed || !taskMatches)) continue;
    const taskNode: TreeNode = {
      id: taskNodeId(taskId), kind: 'task', level: 1, label: taskName, detail: '', taskId, children: [],
      runTotal: visibleRuns.length, liveTotal: visibleRuns.filter(ref => isLive(ref.run)).length,
    };
    const combos = new Map<string, TreeNode>();
    for (const ref of visibleRuns) {
      const id = comboNodeId(taskId, ref);
      let combo = combos.get(id);
      if (!combo) {
        const { run } = ref;
        combo = {
          id, kind: 'combo', level: 2, taskId, parentId: taskNode.id, children: [], runTotal: 0, liveTotal: 0,
          label: `${run.snapshot.model.name} · ${run.snapshot.prompt.name} · ${input.environmentName(run.environmentId)}`,
          detail: ko.sidebar.modes[run.snapshot.mode],
        };
        combos.set(id, combo);
        taskNode.children.push(combo);
      }
      combo.runTotal += 1;
      if (isLive(ref.run)) combo.liveTotal += 1;
      combo.children.push({ id: runNodeId(ref.run.id), kind: 'run', level: 3, label: ko.sidebar.repeat(ref.run.repeat), detail: '', taskId, parentId: id, children: [], ref, runTotal: 1, liveTotal: 0 });
    }
    nodes.push(taskNode);
  }
  return nodes;
}

function searchText(ref: RunRef, taskName: string, environmentName: (id: string) => string): string {
  const { run } = ref;
  return [taskName, run.snapshot.model.name, run.snapshot.prompt.name, environmentName(run.environmentId), run.id].join(' ').toLowerCase();
}

/** Visible nodes in tree order given the expanded ids; the unit of keyboard navigation. */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const visit = (list: readonly TreeNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length && expanded.has(node.id)) visit(node.children);
    }
  };
  visit(nodes);
  return out;
}

export function allNodeIds(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap(node => [node.id, ...allNodeIds(node.children)]);
}

/** Ids of the ancestors of a run, so a selected run is always revealed. */
export function ancestorIds(ref: RunRef): string[] {
  return [taskNodeId(ref.run.taskId), comboNodeId(ref.run.taskId, ref)];
}

export const needsHints = (ref: RunRef) => isFinished(ref.run);
