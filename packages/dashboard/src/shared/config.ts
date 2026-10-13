import { z } from 'zod';
import type { Task } from '@rawstep/core/contracts';
import { idSchema as id, runRulesOverrideSchema, type Mode, type Model, type Permissions, type ProjectConfig } from '@rawstep/project/config';
import type { RunSpec } from '@rawstep/project/execution';

const ids = z.array(id).min(1).max(100).optional();
/** An experiment: tasks × modes × run profiles × repeats. Without `profileIds` each task runs with its own profile. */
export const planSchema = z.object({
  taskIds: z.array(id).min(1).max(100),
  modes: z.array(z.enum(['keyboard', 'screenreader'])).min(1).max(2),
  profileIds: ids,
  /** Run rules for this experiment only, over each profile's. */
  runRules: runRulesOverrideSchema.optional(),
  repeats: z.number().int().min(1).max(100),
  selected: z.array(z.string().max(500)).max(1000).optional(),
  revision: z.string().optional(),
  diagnoseStop: z.boolean().optional(),
}).strict();
export type PlanRequest = z.infer<typeof planSchema>;
/** `tasks` holds each task's JSON as written in its file (not resolved), so edits keep relative URLs and omitted defaults. */
export type ConfigView = { config: ProjectConfig; revision: string; credentialStatus: Record<string, boolean>; tasks: Record<string, unknown>; environmentPresets: Record<string, unknown>; capabilities: { keyboard: { keys: string[]; intents: string[] }; screenreader: Record<'simulation' | 'voiceover' | 'nvda', { keys: string[]; intents: string[] }> } };
/**
 * One run to make: a task in a mode with one run profile. `modelName` is the profile's executor for the mode and `plannerName`
 * its planner when the run plans; `reason` says why it cannot run, `warnings` what is worth knowing.
 */
export type Combination = {
  key: string; taskId: string; mode: Mode; repeat: number;
  profileId: string;
  structure: 'solo' | 'planned'; modelName?: string; plannerName?: string;
  supported: boolean; reason?: string; warnings: string[]; permissions: Permissions;
};
export type RunState = 'queued' | 'running' | 'success' | 'failure' | 'inconclusive' | 'cancelled' | 'interrupted';
export type RunRecord = Combination & {
  id: string; state: RunState; startedAt?: string; endedAt?: string; error?: string;
  /** Why a run could not start or failed without a recorded outcome: the error's code and its message, with keys and input values redacted. */
  errorDetail?: { code?: string; message: string };
  /** What the run was made with: the run spec (its task without secret values) and the task's name at the time. */
  snapshot: { taskName: string; spec: RunSpec };
  /** `stage` and `step` say how far a failed run got; nothing else of the recorded outcome (its raw error text) is kept. */
  outcome?: { status: string; reason?: string; steps?: number; stage?: string; step?: number };
  analysisStatus: 'pending' | 'complete' | 'failed' | 'skipped'; reportStatus: 'pending' | 'complete' | 'failed' | 'skipped';
  analysisError?: string; reportError?: string; analysisModel?: Model;
  analysisInstructions?: string; taskFile?: string;
  retryOf?: { experiment: string; run: string };
  diagnoseStop?: boolean;
};
export type RetryPreview = { revision: string; changedFields: string[]; original: RunSpec['task']; current: RunSpec['task'] };
export type Experiment = { id: string; createdAt: string; stopped: boolean; runs: RunRecord[]; request: PlanRequest };
/** Answer to deleting a task: the project as it is now, the task's file and whether Rawstep removed that file (a linked file elsewhere in the project is only unregistered). */
export type DeleteTaskResult = { view: ConfigView; file: string; fileRemoved: boolean };
/** The fixed texts a run's `error` holds when it ended without a recorded outcome, so a screen can tell the kinds of failure apart. */
export const RUN_ERROR = {
  restarted: '서버 재시작으로 중단되었습니다. 새 실행으로 재시도하세요.',
  storage: '실행 기록을 저장하지 못해 큐를 중단했습니다. 프로젝트 파일과 저장 공간을 확인하세요.',
  start: '실행 준비 또는 실행이 실패했습니다. 연결과 브라우저 설정을 확인하세요.',
} as const;
