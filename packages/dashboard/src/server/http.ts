import { ProjectError } from '@rawstep/project/errors';
import { z } from 'zod';
import type { ServerMessage, ServerMessageCode } from '../shared/messages.js';

/**
 * A refusal the API answers with: an HTTP status and a message code with its values. The server never words a message itself;
 * the dashboard does, in the reader's language. `message` is the code, for logs.
 */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ServerMessageCode, readonly params?: Record<string, string | number>) { super(code); }
}
export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** The message for a failure: a project error by its own code, a refusal by its code, bad input as such, anything else as the generic failure. */
export function messageOf(error: unknown): ServerMessage {
  if (error instanceof HttpError) return { code: error.code, ...(error.params ? { params: error.params } : {}) };
  if (error instanceof ProjectError) return { code: error.code };
  if (error instanceof z.ZodError) return { code: 'invalid-input' };
  return { code: 'request-failed' };
}
/** The HTTP status for a failure: a refusal's or a project error's own, otherwise 400. */
export const statusOf = (error: unknown): number => error instanceof HttpError || error instanceof ProjectError ? error.status : 400;
