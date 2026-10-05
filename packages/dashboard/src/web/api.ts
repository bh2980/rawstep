import { t } from './i18n';

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch('/api' + path, { method: options.method ?? 'GET', headers: options.body === undefined ? {} : { 'content-type': 'application/json' }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : t('apiErrors.requestFailed'));
  return value as T;
}
