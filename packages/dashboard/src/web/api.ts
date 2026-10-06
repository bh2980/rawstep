import { t } from './i18n/index.js';

/**
 * Request failure that keeps the HTTP status so callers can react to e.g. 409.
 * Status 0 means the request never got an answer: the local service could not be reached.
 */
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, { method: options.method ?? 'GET', headers: options.body === undefined ? {} : { 'content-type': 'application/json' }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  } catch { throw new ApiError(t('apiErrors.connectionLost'), 0); }
  let value: { error?: unknown } | undefined;
  try { value = await response.json() as { error?: unknown }; } catch { if (response.ok) throw new ApiError(t('apiErrors.notJson'), response.status); }
  if (!response.ok) throw new ApiError(typeof value?.error === 'string' ? value.error : t('apiErrors.requestFailed'), response.status);
  return value as T;
}
