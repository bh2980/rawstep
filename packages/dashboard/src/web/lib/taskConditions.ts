import {
  defaultActionSet, defaultCombo, defaultPageEnvironment, sharedItems, taskConditions,
  type ActionSet, type AtEnvironment, type Combo, type ManagedTask, type PageEnvironment, type ProjectConfig,
} from '@rawstep/project/config';

/** The four conditions a task names besides its preset and run rules, with the config list and the task field of each. */
export const CONDITION_KINDS = ['combo', 'actionSet', 'pageEnvironment', 'atEnvironment'] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];
export const LIST = { combo: 'combos', actionSet: 'actionSets', pageEnvironment: 'pageEnvironments', atEnvironment: 'atEnvironments' } as const satisfies Record<ConditionKind, keyof ProjectConfig>;
export const FIELD = { combo: 'comboId', actionSet: 'actionSetId', pageEnvironment: 'pageEnvironmentId', atEnvironment: 'atEnvironmentId' } as const satisfies Record<ConditionKind, keyof ManagedTask>;
export type ConditionItem = { combo: Combo; actionSet: ActionSet; pageEnvironment: PageEnvironment; atEnvironment: AtEnvironment };
export type TaskConditionIds = Partial<Pick<ManagedTask, 'presetId' | 'comboId' | 'actionSetId' | 'pageEnvironmentId' | 'atEnvironmentId'>>;
type Owned = { id: string; name: string; owner?: string | undefined; copiedFrom?: string | undefined };

/**
 * Where a task's condition comes from: `task` (the task names it), `preset` (its preset does) or `default` (the first shared item).
 * `own` says the item is a copy only this task uses.
 */
export type ConditionSource = { item: Owned; from: 'task' | 'preset' | 'default'; own: boolean };
export function conditionSource(config: ProjectConfig, task: TaskConditionIds & { id?: string }, kind: ConditionKind): ConditionSource {
  const item = taskConditions(config, task)[kind] as Owned;
  const preset = config.presets.find(p => p.id === task.presetId);
  const from = task[FIELD[kind]] === item.id ? 'task' : preset?.[FIELD[kind]] === item.id ? 'preset' : 'default';
  return { item, from, own: !!task.id && item.owner === task.id };
}

/** What a task can pick for a condition: the shared items, then its own copies. Another task's copies are left out. */
export function selectable<T extends Owned>(list: readonly T[], taskId: string): T[] {
  return [...sharedItems(list), ...list.filter(item => item.owner === taskId)];
}

/** An id not used in the list yet, made from a base. */
export function freshId(base: string, list: readonly { id: string }[]): string {
  const stem = base.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'item';
  for (let n = 1; ; n++) { const id = n === 1 ? stem : `${stem}-${n}`; if (!list.some(item => item.id === id)) return id; }
}

/** A task-only copy of a condition item: same content, a new id, the task as owner and where it came from. */
export function taskCopy<T extends Owned>(item: T, list: readonly T[], task: { id: string; name: string }, name?: string): T {
  const copy = structuredClone(item);
  return { ...copy, id: freshId(`${item.copiedFrom ?? item.id}-${task.id.slice(0, 8)}`, list), name: name ?? `${item.name} (${task.name})`, owner: task.id, copiedFrom: item.owner ? item.copiedFrom ?? item.id : item.id };
}

/** A new task-only item of a kind, starting from Rawstep's defaults. The assistive technology environment has no task-only form. */
export function blankItem(kind: Exclude<ConditionKind, 'atEnvironment'>, config: ProjectConfig, task: { id: string; name: string }, name: string): Owned {
  const list = config[LIST[kind]] as readonly Owned[], id = freshId(`${kind}-${task.id.slice(0, 8)}`, list);
  const base = kind === 'combo' ? defaultCombo(id, name) : kind === 'actionSet' ? defaultActionSet(id, name) : defaultPageEnvironment(id, name);
  return { ...base, owner: task.id };
}

/** The config with one item of a kind added or replaced (by id). */
export function withItem(config: ProjectConfig, kind: ConditionKind, item: Owned): ProjectConfig {
  const list = config[LIST[kind]] as readonly Owned[];
  const next = list.some(entry => entry.id === item.id) ? list.map(entry => entry.id === item.id ? item : entry) : [...list, item];
  return { ...config, [LIST[kind]]: next } as ProjectConfig;
}

/** The config with a task entry changed. */
export function withTask(config: ProjectConfig, taskId: string, change: (task: ManagedTask) => ManagedTask): ProjectConfig {
  return { ...config, tasks: config.tasks.map(task => task.id === taskId ? change(task) : task) };
}

/** The task pointing at an item for a kind (or, without an id, back to its preset or the default). */
export function pointTask(task: ManagedTask, kind: ConditionKind, id: string | undefined): ManagedTask {
  const { [FIELD[kind]]: _old, ...rest } = task;
  return id ? { ...rest, [FIELD[kind]]: id } : rest;
}

/**
 * The task-only copies of a task carried over to a duplicate: each copy the original task uses is copied again for the new task,
 * so the two tasks never share a task-only item. Returns the config with the new copies and the ids the new task should use.
 */
export function copyOwned(config: ProjectConfig, from: TaskConditionIds & { id: string }, to: { id: string; name: string }): { config: ProjectConfig; ids: TaskConditionIds } {
  let next = config;
  const ids: TaskConditionIds = { ...(from.presetId ? { presetId: from.presetId } : {}) };
  for (const kind of CONDITION_KINDS) {
    const id = from[FIELD[kind]];
    if (!id) continue;
    const list = next[LIST[kind]] as readonly Owned[], item = list.find(entry => entry.id === id);
    if (item?.owner === from.id) {
      const copy = { ...taskCopy(item, list, to, item.name), copiedFrom: item.copiedFrom ?? item.id };
      next = withItem(next, kind, copy); ids[FIELD[kind]] = copy.id;
    } else ids[FIELD[kind]] = id;
  }
  return { config: next, ids };
}
