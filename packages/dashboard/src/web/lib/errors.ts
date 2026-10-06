import { ApiError } from '../api.js';
import { t } from '../i18n/index.js';
import type { RouteChange } from '../hooks/useRoute.js';
import { RUN_ERROR, type RunRecord } from '../../shared/config.js';

/**
 * Five kinds of trouble, kept apart because each asks for a different next step:
 * setup (a setting or input cannot be used), start (a run did not get going), runtime (it stopped part-way),
 * data (a file or record could not be read or written) and connection (the local service cannot be reached).
 */
export type ErrorKind = 'setup' | 'start' | 'runtime' | 'data' | 'connection';

/** What the error screen says. Every text is the dashboard's own or a message the server already made safe; provider text never reaches it. */
export type ErrorView = {
  kind: ErrorKind;
  /** What happened, in one sentence. */
  what: string;
  /** The recorded cause in its own words (keys and input values redacted), when there is one. */
  cause?: string;
  /** How far it got. */
  progress?: string;
  /** What a person can do next. */
  next: string;
  /** Where to go for that, when there is a page for it. */
  link?: { to: RouteChange; label: string };
  /** Codes and the server's fixed message, shown only when asked for. */
  raw?: string;
};

const START_STAGES = ['initialization', 'backend-start', 'browser-start'] as const;
const RUNTIME_STAGES = ['observation', 'policy', 'action', 'settling', 'verification'] as const;
type Stage = (typeof START_STAGES)[number] | (typeof RUNTIME_STAGES)[number];
const isStart = (stage: string | undefined): stage is (typeof START_STAGES)[number] => (START_STAGES as readonly (string | undefined)[]).includes(stage);
const isRuntime = (stage: string | undefined): stage is (typeof RUNTIME_STAGES)[number] => (RUNTIME_STAGES as readonly (string | undefined)[]).includes(stage);
/** The words for a stage: what stopped and what to do. */
const stageText = (stage: Stage) => ({ what: t(`errors.stage.${stage}.what`), next: t(`errors.stage.${stage}.next`) });

const goMachine: ErrorView['link'] = { to: { view: 'settings' }, label: t('errors.go.machine') };
const goModels: ErrorView['link'] = { to: { view: 'connections' }, label: t('errors.go.models') };
const goProfiles: ErrorView['link'] = { to: { view: 'profiles' }, label: t('errors.go.profiles') };

/** The recorded codes of a run's end, for the "원본 오류 보기" block: the state, reason, stage, action number and the server's own message. */
export function rawRunRecord(run: Pick<RunRecord, 'state' | 'outcome' | 'error' | 'errorDetail'>): string {
  const { outcome } = run;
  return [
    `state: ${run.state}`, outcome?.status ? `status: ${outcome.status}` : '', outcome?.reason ? `reason: ${outcome.reason}` : '',
    outcome?.stage ? `stage: ${outcome.stage}` : '', outcome?.step !== undefined ? `step: ${outcome.step}` : '', run.error ? `message: ${run.error}` : '',
    run.errorDetail?.code ? `code: ${run.errorDetail.code}` : '', run.errorDetail ? `cause: ${run.errorDetail.message}` : '',
  ].filter(Boolean).join('\n');
}

const progressOf = (run: Pick<RunRecord, 'outcome'>): string => {
  const recorded = run.outcome?.steps ?? run.outcome?.step;
  return recorded ? t('errors.run.progressSteps', { n: recorded }) : t('errors.run.progressNone');
};

/**
 * Tells a run that went wrong from one that simply ended: a limit, a stop the model chose or a goal that was not reached are outcomes
 * and return nothing. A run that stopped on an error, could not start, lost its records or was cut off becomes an error view.
 */
export function describeRunFailure(run: Pick<RunRecord, 'state' | 'outcome' | 'error' | 'errorDetail' | 'taskId'>): ErrorView | undefined {
  const view = failureView(run);
  return view && run.errorDetail ? { ...view, cause: run.errorDetail.message } : view;
}
function failureView(run: Pick<RunRecord, 'state' | 'outcome' | 'error' | 'errorDetail' | 'taskId'>): ErrorView | undefined {
  const reason = run.outcome?.reason, stage = run.outcome?.stage, raw = rawRunRecord(run);
  if (run.error === RUN_ERROR.storage || reason === 'trace-persistence-error') {
    return { kind: 'data', what: t('errors.run.dataWhat'), progress: progressOf(run), next: t('errors.run.dataNext'), raw };
  }
  if (run.error === RUN_ERROR.restarted) return { kind: 'runtime', what: t('errors.run.restartedWhat'), progress: progressOf(run), next: t('errors.run.restartedNext'), raw };
  if (reason === 'access-blocked') return { kind: 'start', what: t('errors.run.blockedWhat'), progress: t('errors.run.progressNone'), next: t('errors.run.blockedNext'), raw };
  if (reason === 'unsupported-profile') return { kind: 'setup', what: t('errors.run.profileWhat'), progress: t('errors.run.progressNone'), next: t('errors.run.profileNext'), link: goProfiles, raw };
  if (reason === 'unsupported-pattern') return { kind: 'setup', what: t('errors.run.patternWhat'), progress: progressOf(run), next: t('errors.run.patternNext'), raw };
  if (reason === 'error' && isStart(stage)) {
    return { kind: 'start', ...stageText(stage), progress: t('errors.run.progressNone'), link: stage === 'browser-start' || stage === 'backend-start' ? goMachine : undefined, raw };
  }
  if (reason === 'error' && isRuntime(stage)) {
    return { kind: 'runtime', ...stageText(stage), progress: progressOf(run), link: stage === 'policy' ? goModels : stage === 'verification' ? { to: { task: run.taskId, tab: 'check' }, label: t('errors.go.check') } : undefined, raw };
  }
  if (reason === 'error') return { kind: 'runtime', what: t('errors.run.unknownWhat'), progress: progressOf(run), next: t('errors.run.unknownNext'), raw };
  // The executor threw before a trace existed: the run never started.
  if (run.state === 'failure' && !run.outcome && run.error) return { kind: 'start', what: t('errors.run.startWhat'), progress: t('errors.run.progressNone'), next: t('errors.run.startNext'), link: goMachine, raw };
  if (run.state === 'interrupted') return { kind: 'runtime', what: t('errors.run.interruptedWhat'), progress: progressOf(run), next: t('errors.run.restartedNext'), raw };
  return undefined;
};

/** The analysis or the report of a finished run could not be written. The run's own outcome stands. */
export function describeAfterRunFailure(run: Pick<RunRecord, 'analysisError' | 'reportError' | 'analysisStatus' | 'reportStatus'>): ErrorView | undefined {
  const message = run.analysisStatus === 'failed' ? run.analysisError : run.reportStatus === 'failed' ? run.reportError : undefined;
  if (!message && run.analysisStatus !== 'failed' && run.reportStatus !== 'failed') return undefined;
  return { kind: 'data', what: run.analysisStatus === 'failed' ? t('errors.after.analysisWhat') : t('errors.after.reportWhat'), progress: t('errors.after.progress'), next: t('errors.after.next'), ...(message ? { raw: message } : {}) };
}

/** The kind of trouble an API failure is, unless the caller knows better (a failed start, a failed read). */
export function errorKindOf(error: unknown, hint?: ErrorKind): ErrorKind {
  if (error instanceof ApiError && error.status === 0) return 'connection';
  if (hint) return hint;
  return error instanceof ApiError && error.status >= 500 ? 'data' : 'setup';
}

/** An API failure as an error view. The message is the server's already-sanitized text. */
export function describeApiError(error: unknown, hint?: ErrorKind): ErrorView {
  const message = error instanceof Error ? error.message : t('apiErrors.requestFailed'), kind = errorKindOf(error, hint);
  const status = error instanceof ApiError ? error.status : undefined, raw = status ? `status: ${status}\nmessage: ${message}` : `message: ${message}`;
  switch (kind) {
    case 'connection': return { kind, what: t('errors.api.connectionWhat'), progress: t('errors.api.connectionProgress'), next: t('errors.api.connectionNext'), raw };
    case 'start': return { kind, what: message, progress: t('errors.api.startProgress'), next: t('errors.api.startNext'), link: goModels, raw };
    case 'data': return { kind, what: message, progress: t('errors.api.dataProgress'), next: t('errors.api.dataNext'), raw };
    case 'runtime': return { kind, what: message, next: t('errors.api.dataNext'), raw };
    case 'setup': return { kind, what: message, progress: status === 409 ? t('errors.api.conflictProgress') : t('errors.api.setupProgress'), next: status === 409 ? t('errors.api.conflictNext') : t('errors.api.setupNext'), raw };
  }
}

/** The local service cannot be reached: the live connection dropped. */
export function connectionLostView(): ErrorView {
  return { kind: 'connection', what: t('errors.api.connectionWhat'), progress: t('errors.api.connectionProgress'), next: t('errors.api.connectionNext'), raw: t('errors.api.connectionRaw') };
}

/** Something that should have been read from the project could not be: the screen keeps what it had and says what is missing. */
export function dataFailureView(what: string, message?: string): ErrorView {
  return { kind: 'data', what, progress: t('errors.api.dataProgress'), next: t('errors.api.dataNext'), ...(message ? { raw: `message: ${message}` } : {}) };
}
