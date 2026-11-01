import type { ManagedTask } from '@rawstep/project/config';
import { ApiError } from '../api';
import type { ConfigView } from '../../shared/config.js';
import type { PageProps } from '../pages/types';

/** Lowercase a-z0-9 and hyphens, at most 40 characters; empty when nothing usable remains. */
export function slugify(text: string): string {
  return text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

export { nameFromGoal } from './taskName.js';

export function hostnameOf(url: string): string {
  try { return new URL(url.trim()).hostname; } catch { return ''; }
}

/** `tasks/<slug>.json`, or with -2, -3… appended until the path is not already registered. */
export function uniqueTaskFile(slug: string, used: ReadonlySet<string>): string {
  const base = slug || 'task';
  let file = 'tasks/' + base + '.json';
  for (let n = 2; used.has(file); n++) file = 'tasks/' + base + '-' + n + '.json';
  return file;
}

/**
 * Registers a new managed task and writes its Task JSON. A 409 means the file already exists on disk
 * (or the config changed), so retry once with a random suffix. Returns the new task id and the project state that includes it.
 */
export async function createManagedTask(props: PageProps, input: {
  name: string; slug: string; task: unknown;
  /** Tags for the new task; a copy keeps its original's. */
  tags?: string[];
  /** A task being copied: its base task, tags, fewest moves and analysis instructions come along. */
  copyOf?: ManagedTask;
}): Promise<{ id: string; view: ConfigView }> {
  const id = crypto.randomUUID(), { copyOf } = input;
  const { config } = props.view, tags = input.tags ?? copyOf?.tags;
  const write = (file: string) => props.save(
    { ...config, tasks: [...config.tasks, {
      id, name: input.name, file,
      ...(tags?.length ? { tags } : {}),
      ...(copyOf?.profiles?.length ? { profiles: copyOf.profiles } : {}),
      ...(copyOf?.variantOf ? { variantOf: copyOf.variantOf } : {}), ...(copyOf?.minimalSteps !== undefined ? { minimalSteps: copyOf.minimalSteps } : {}),
      ...(copyOf?.analysisInstructions ? { analysisInstructions: copyOf.analysisInstructions } : {}),
    }] },
    { file, task: input.task },
  );
  const used = new Set(props.view.config.tasks.map(task => task.file));
  try { return { id, view: await write(uniqueTaskFile(input.slug, used)) }; }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    return { id, view: await write('tasks/' + (input.slug || 'task') + '-' + crypto.randomUUID().slice(0, 6) + '.json') };
  }
}
