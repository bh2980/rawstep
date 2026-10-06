import type { TaskInputOptions } from '@rawstep/core/contracts';
import { asObject, type Json } from './taskJson.js';

export type InputProblem = 'name' | 'goal';

/** The inputs written in a task, as names to string values (anything that is not a string is read as empty). */
export function taskInputs(task: Json): Record<string, string> {
  return Object.fromEntries(Object.entries(asObject(task.input)).map(([name, value]) => [name, typeof value === 'string' ? value : '']));
}

/** The per-input options written in a task; `undefined` when there are none. */
export const taskInputOptions = (task: Json): Record<string, TaskInputOptions> | undefined => Object.keys(asObject(task.inputOptions)).length ? asObject(task.inputOptions) as Record<string, TaskInputOptions> : undefined;

/**
 * Inputs a task cannot be saved with, by name: a blank name, or a sensitive value of four or more characters that is written in the goal
 * (the goal goes to the model as it is, so the value would not be hidden). The server checks the same rules.
 */
export function inputProblems(input: Record<string, string>, options: Record<string, TaskInputOptions> | undefined, goal: string): Map<string, InputProblem> {
  const found = new Map<string, InputProblem>();
  for (const [name, value] of Object.entries(input)) {
    if (!name.trim()) found.set(name, 'name');
    else if (options?.[name]?.sensitive !== false && value.length >= 4 && goal.includes(value)) found.set(name, 'goal');
  }
  return found;
}

/** The task fields for these inputs. Empty ones are `undefined`, so merging them into a task removes them; options only stay for names that still exist. */
export function inputFields(input: Record<string, string>, options?: Record<string, TaskInputOptions>): { input: Record<string, string> | undefined; inputOptions: Record<string, TaskInputOptions> | undefined } {
  const kept = Object.fromEntries(Object.entries(options ?? {}).filter(([name]) => Object.hasOwn(input, name)));
  return { input: Object.keys(input).length ? input : undefined, inputOptions: Object.keys(kept).length ? kept : undefined };
}
