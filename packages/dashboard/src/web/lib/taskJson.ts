import type { VerifyRule } from '@rawstep/core/contracts';

export type Json = Record<string, unknown>;
export const asObject = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

/** The Task JSON text as an object; `undefined` when it is not valid JSON or not an object, so a screen can say so instead of failing. */
export function parseTaskJson(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
  } catch { return undefined; }
}

/** The completion checks written in a task. */
export function taskRules(task: Json): VerifyRule[] {
  const all = asObject(task.verify).all;
  return Array.isArray(all) ? all as VerifyRule[] : [];
}

/** The text with these top-level fields replaced; unchanged when the text is not a JSON object. */
export function updateTaskJson(text: string, part: Json): string {
  const task = parseTaskJson(text);
  return task ? JSON.stringify({ ...task, ...part }, null, 2) : text;
}

export const withRules = (text: string, rules: readonly VerifyRule[]): string => updateTaskJson(text, { verify: { all: rules } });

/** Whether two Task JSON texts hold the same data, whatever their formatting. */
export function sameTaskJson(a: string, b: string): boolean {
  const left = parseTaskJson(a), right = parseTaskJson(b);
  return left && right ? JSON.stringify(left) === JSON.stringify(right) : a === b;
}

/** The start URL as written in a task file (a project HTML path stays relative). */
export function taskUrl(task: unknown): string {
  return task && typeof task === 'object' && typeof (task as { url?: unknown }).url === 'string' ? (task as { url: string }).url : '';
}
