import { t } from './i18n';

/** Request failure that keeps the HTTP status so callers can react to e.g. 409. */
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch('/api' + path, { method: options.method ?? 'GET', headers: options.body === undefined ? {} : { 'content-type': 'application/json' }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const value = await response.json();
  if (!response.ok) throw new ApiError(typeof value.error === 'string' ? value.error : t('apiErrors.requestFailed'), response.status);
  return value as T;
}
