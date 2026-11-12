/**
 * The two ways to read something that may be anything (a parsed file, an event's data, a model's reply) as a plain object. The one
 * place they are written: every package asks here, so "a plain object" means the same everywhere (not null, not an array).
 * Pure and free of Node APIs, so a browser page can use it too. Workspace-internal: the published `rawstep` does not export it.
 */

/** Whether the value is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/** The value when it is a plain object, otherwise an empty one: for reading a field of something that may not be an object at all. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
