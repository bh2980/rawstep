/** The most tags one task can have, and the longest tag: the same limits as the project's `tagSchema` (`@rawstep/project/config`). */
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
/** A tag starts with a letter or digit and goes on with letters, digits, `-` and `_`; the same rule as `tagSchema`. */
const TAG = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

/** Why a tag cannot be added: it has characters a tag cannot have, is too long, is already on the task, or the task has the most tags it can. */
export type TagProblem = 'characters' | 'length' | 'duplicate' | 'full';

/** What is wrong with adding `tag` to `existing`, or nothing. A blank tag is not a problem, only nothing to add. */
export function tagProblem(tag: string, existing: readonly string[]): TagProblem | undefined {
  if (!tag) return undefined;
  if (existing.includes(tag)) return 'duplicate';
  if (existing.length >= MAX_TAGS) return 'full';
  if (!TAG.test(tag)) return 'characters';
  if ([...tag].length > MAX_TAG_LENGTH) return 'length';
  return undefined;
}

/**
 * Takes the tags typed in `text` (separated by commas) onto `existing`. It stops at the first one that cannot be added and
 * returns it as `problem`, with `rest` holding the text from there on so the person can fix it; otherwise `rest` is empty.
 */
export function addTags(text: string, existing: readonly string[]): { tags: string[]; rest: string; problem?: { code: TagProblem; tag: string } } {
  const tags = [...existing], pieces = text.split(',');
  for (const [index, piece] of pieces.entries()) {
    const tag = piece.trim(), code = tagProblem(tag, tags);
    if (code) return { tags, rest: pieces.slice(index).join(',').trim(), problem: { code, tag } };
    if (tag) tags.push(tag);
  }
  return { tags, rest: '' };
}

/** Every tag used by any of the tasks, each once, in alphabetical order. */
export function projectTags(tasks: readonly { tags?: readonly string[] | undefined }[]): string[] {
  return [...new Set(tasks.flatMap(task => task.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

/** Whether `tag` picks `task`: every task when there is no tag. */
export const hasTag = (task: { tags?: readonly string[] | undefined } | undefined, tag: string | undefined): boolean => !tag || !!task?.tags?.includes(tag);

/** The tasks that carry `tag`, in their order. */
export const tasksWithTag = <T extends { tags?: readonly string[] | undefined }>(tasks: readonly T[], tag: string): T[] => tasks.filter(task => hasTag(task, tag));

/**
 * The tag a filter really applies: the one chosen, unless no task has it any more (it was removed while the filter was set), in
 * which case no tag. `none` is the filter's "all" value.
 */
export function activeTag(chosen: string, none: string, tasks: readonly { tags?: readonly string[] | undefined }[]): string | undefined {
  return chosen !== none && projectTags(tasks).includes(chosen) ? chosen : undefined;
}

/** Whether all of the tasks picked by `tag` are in `selected` (false when no task has the tag). */
export function allTaggedSelected(tasks: readonly { id: string; tags?: readonly string[] | undefined }[], tag: string, selected: readonly string[]): boolean {
  const tagged = tasksWithTag(tasks, tag);
  return tagged.length > 0 && tagged.every(task => selected.includes(task.id));
}

/** `selected` with every task carrying `tag` added, or, when they were all in already, taken out. Other tasks stay as they are. */
export function toggleTagged(tasks: readonly { id: string; tags?: readonly string[] | undefined }[], tag: string, selected: readonly string[]): string[] {
  const ids = tasksWithTag(tasks, tag).map(task => task.id);
  if (allTaggedSelected(tasks, tag, selected)) return selected.filter(id => !ids.includes(id));
  return [...selected, ...ids.filter(id => !selected.includes(id))];
}
