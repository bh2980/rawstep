/**
 * An expected failure of the project layer: a bad config, a missing file, a run that cannot be assembled.
 * `code` is stable and meant for callers that translate or branch; `status` is an HTTP-style hint (400 bad input,
 * 404 missing, 409 conflict, 502 upstream) that the dashboard maps to its responses and the CLI ignores.
 */
export class ProjectError extends Error {
  override name = 'ProjectError';
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
