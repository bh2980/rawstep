/**
 * Messages the server sends to the dashboard are a stable code and its values, never finished sentences: the browser words them
 * in the reader's language (`serverMessages` in the web locales). Codes of `@rawstep/project` errors are used as they are.
 */
export const SERVER_MESSAGE_CODES = [
  // Errors of the project layer (ProjectError codes).
  'no-config', 'invalid-config', 'config-conflict', 'old-config', 'invalid-task',
  'duplicate-id', 'duplicate-task-file', 'path-outside-project', 'symlink-outside-project', 'task-file-missing',
  'task-not-found', 'task-file-unreadable', 'task-file-reserved', 'task-file-not-registered', 'task-file-exists', 'task-variant-invalid',
  'invalid-credential', 'credential-target', 'missing-credential',
  'invalid-provider', 'invalid-base-url', 'model-http', 'model-empty', 'model-too-large', 'model-json',
  'model-unreachable', 'model-timeout', 'model-list-missing', 'agent-missing', 'agent-signed-out', 'agent-start-failed', 'unsupported-action', 'unknown-input',
  'voiceover-macos', 'nvda-windows', 'at-driver-not-running', 'at-driver-start-failed', 'endpoint-not-loopback',
  'planner-model-invalid', 'plan-file-task', 'plan-file-invalid', 'browser-endpoint-missing', 'screen-reader-busy',
  // The dashboard server's own.
  'request-failed', 'invalid-input', 'invalid-json', 'request-too-large', 'loopback-only', 'origin-not-allowed', 'api-not-found',
  'get-required', 'bad-file-path', 'revision-required', 'connection-not-found', 'page-read-busy',
  'at-driver-session-failed', 'voiceover-cursor-unavailable', 'task-run-active', 'custom-key-per-connection', 'connection-key-env-required', 'suggest-model-missing',
  'suggest-failed', 'start-page-unreadable', 'run-id-required', 'report-not-ready', 'screenshot-missing', 'trace-missing',
  'batch-not-for-task', 'plan-changed', 'too-many-combinations', 'shutting-down', 'select-supported', 'retry-no-task-file',
  'retry-run-active', 'task-changed', 'experiment-not-found', 'run-not-found', 'delete-run-active', 'batch-running-elsewhere', 'browser-profile-busy', 'summary-not-ready',
  // Plan warnings.
  'analysis-key-missing', 'analysis-not-llm', 'warning-text',
  // Successful checks.
  'check-simulation-ok', 'check-at-driver-started', 'check-at-driver-ok',
] as const;
export type ServerMessageCode = (typeof SERVER_MESSAGE_CODES)[number];
/** A message as the server sends it. `code` is usually a ServerMessageCode; an unknown one is shown as the generic failure. */
export type ServerMessage = { code: string; params?: Record<string, string | number> };
export const isServerMessageCode = (code: unknown): code is ServerMessageCode => typeof code === 'string' && (SERVER_MESSAGE_CODES as readonly string[]).includes(code);
