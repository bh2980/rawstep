import { serverText, t } from './i18n/index.js';
import type { ServerMessage } from '../shared/messages.js';

/**
 * Request failure that keeps the HTTP status so callers can react to e.g. 409, and the server's message code.
 * Status 0 means the request never got an answer: the local service could not be reached.
 * The message is already worded in the language shown when the request failed.
 */
export class ApiError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }

const isServerMessage = (value: unknown): value is ServerMessage => !!value && typeof value === 'object' && typeof (value as { code?: unknown }).code === 'string';

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, { method: options.method ?? 'GET', headers: options.body === undefined ? {} : { 'content-type': 'application/json' }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  } catch { throw new ApiError(t('apiErrors.connectionLost'), 0); }
  let value: { error?: unknown } | undefined;
  try { value = await response.json() as { error?: unknown }; } catch { if (response.ok) throw new ApiError(t('apiErrors.notJson'), response.status); }
  if (!response.ok) {
    const error = value?.error;
    throw isServerMessage(error) ? new ApiError(serverText(error), response.status, error.code) : new ApiError(t('apiErrors.requestFailed'), response.status);
  }
  return value as T;
}
