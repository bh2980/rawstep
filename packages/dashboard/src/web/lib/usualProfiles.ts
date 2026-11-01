/** What of a task the run dialog needs: its id and the run profiles it usually runs with (`profiles` of its config entry). */
export type UsualTask = { id: string; profiles?: readonly string[] | undefined };
type WithId = { id: string };

/**
 * How the run dialog gives profiles to tasks: `explicit` — one list of profiles for every task (what a person picks); `perTask` — each
 * task with its own usual profiles, the project's first profile for a task that has none.
 */
export type ProfileMode = 'perTask' | 'explicit';

/** The usual profiles of a task that still exist, in the task's order. */
export const usualProfileIds = (task: UsualTask, profiles: readonly WithId[]): string[] => (task.profiles ?? []).filter(id => profiles.some(profile => profile.id === id));

/** Whether any of these tasks has usual profiles. */
export const anyUsual = (tasks: readonly UsualTask[], profiles: readonly WithId[]): boolean => tasks.some(task => usualProfileIds(task, profiles).length > 0);

/**
 * What the run dialog starts with for these tasks: one task with usual profiles starts with them picked (as a list to change); several
 * tasks of which any has usual profiles start `perTask`; otherwise the one profile `fallbackId` (the last or first usable). A mode that
 * would not apply to the tasks is never returned.
 */
export function startingChoice(tasks: readonly UsualTask[], profiles: readonly WithId[], fallbackId: string | undefined): { mode: ProfileMode; profileIds: string[] } {
  const fallback = fallbackId ? [fallbackId] : [];
  if (tasks.length > 1 && anyUsual(tasks, profiles)) return { mode: 'perTask', profileIds: fallback };
  const usual = tasks.length === 1 ? usualProfileIds(tasks[0]!, profiles) : [];
  return { mode: 'explicit', profileIds: usual.length ? usual : fallback };
}

/** The mode that really applies: `perTask` only for several tasks of which any has usual profiles. */
export const effectiveMode = (mode: ProfileMode, tasks: readonly UsualTask[], profiles: readonly WithId[]): ProfileMode =>
  mode === 'perTask' && tasks.length > 1 && anyUsual(tasks, profiles) ? 'perTask' : 'explicit';

/** The profiles each task runs with, in the order of `tasks`. */
export function profilesPerTask(tasks: readonly UsualTask[], profiles: readonly WithId[], mode: ProfileMode, picked: readonly string[]): { taskId: string; profileIds: string[] }[] {
  const first = profiles[0]?.id, known = picked.filter(id => profiles.some(profile => profile.id === id));
  return tasks.map(task => {
    if (mode === 'explicit') return { taskId: task.id, profileIds: known };
    const usual = usualProfileIds(task, profiles);
    return { taskId: task.id, profileIds: usual.length ? usual : first ? [first] : [] };
  });
}

/** How many runs the assignment makes with each task run `repeats` times under each of its profiles. */
export const runTotal = (assignment: readonly { profileIds: readonly string[] }[], repeats: number): number => assignment.reduce((sum, item) => sum + item.profileIds.length, 0) * repeats;

/** Every profile used, each once, in the order they first appear. */
export const profilesUsed = (assignment: readonly { profileIds: readonly string[] }[]): string[] => [...new Set(assignment.flatMap(item => item.profileIds))];

/**
 * The profile part of a batch request: `profileIds` alone when every task shares one list; with `perTask`, every task's own list in
 * `profilesByTask` and all the profiles used in `profileIds`.
 */
export function profileRequest(assignment: readonly { taskId: string; profileIds: string[] }[], mode: ProfileMode): { profileIds: string[]; profilesByTask?: Record<string, string[]> } {
  const profileIds = profilesUsed(assignment);
  return mode === 'perTask' ? { profileIds, profilesByTask: Object.fromEntries(assignment.map(item => [item.taskId, item.profileIds])) } : { profileIds };
}

/** The tasks with a deleted profile taken off their usual profiles; a task left with none loses the field. */
export function withoutProfiles<T extends { profiles?: string[] | undefined }>(tasks: readonly T[], removed: readonly string[]): T[] {
  return tasks.map(task => {
    if (!task.profiles?.some(id => removed.includes(id))) return task;
    const kept = task.profiles.filter(id => !removed.includes(id)), { profiles: _profiles, ...rest } = task;
    return (kept.length ? { ...rest, profiles: kept } : rest) as T;
  });
}
