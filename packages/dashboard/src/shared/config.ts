import { z } from 'zod';
import type { Task } from '@rawstep/core/contracts';
import { idSchema as id, type Mode, type Model, type Permissions, type ProjectConfig, type Prompt, type RunSettings } from '@rawstep/project/config';

export const planSchema = z.object({
  taskIds: z.array(id).min(1).max(100), modelIds: z.array(id).min(1).max(100),
  promptIds: z.array(id).min(1).max(50), mode: z.enum(['keyboard', 'screenreader']),
  /** Profiles to compare; omitted means each task's own profile. */
  profileIds: z.array(id).min(1).max(100).optional(), repeats: z.number().int().min(1).max(100),
  selected: z.array(z.string().max(500)).max(1000).optional(),
  analysisModelId: id.optional(),
  revision: z.string().optional(),
  diagnoseStop: z.boolean().optional(),
}).strict();
export type PlanRequest = z.infer<typeof planSchema>;
/** `tasks` holds each task's JSON as written in its file (not resolved), so edits keep relative URLs and omitted defaults. */
export type ConfigView = { config: ProjectConfig; revision: string; credentialStatus: Record<string, boolean>; tasks: Record<string, unknown>; environmentPresets: Record<string, unknown>; capabilities: { keyboard: { keys: string[]; intents: string[] }; screenreader: { keys: string[]; intents: string[] } } };
export type Combination = { key: string; taskId: string; modelId: string; promptId: string; profileId: string; repeat: number; supported: boolean; reason?: string; permissions: Permissions; permissionSource: 'profile' | 'task' };
export type RunState = 'queued' | 'running' | 'success' | 'failure' | 'inconclusive' | 'cancelled' | 'interrupted';
export type RunRecord = Combination & {
  id: string; state: RunState; startedAt?: string; endedAt?: string; error?: string;
  /** `profile` is the resolved page environment; `runProfile` names the run profile. */
  snapshot: { task: Task; taskName: string; model: Model; prompt: Prompt; mode: Mode; profile: unknown; globals: RunSettings; runProfile: { id: string; name: string } };
  /** `stage` and `step` say how far a failed run got; nothing else of the recorded outcome (its raw error text) is kept. */
  outcome?: { status: string; reason?: string; steps?: number; stage?: string; step?: number };
  analysisStatus: 'pending' | 'complete' | 'failed' | 'skipped'; reportStatus: 'pending' | 'complete' | 'failed' | 'skipped';
  analysisError?: string; reportError?: string; analysisModel?: Model;
  analysisInstructions?: string; taskFile?: string;
  retryOf?: { experiment: string; run: string };
  diagnoseStop?: boolean;
};
export type RetryPreview = { revision: string; changedFields: string[]; original: RunRecord['snapshot']['task']; current: RunRecord['snapshot']['task'] };
export type Experiment = { id: string; createdAt: string; stopped: boolean; runs: RunRecord[]; request: PlanRequest };
/** Answer to deleting a task: the project as it is now, the task's file and whether Rawstep removed that file (a linked file elsewhere in the project is only unregistered). */
export type DeleteTaskResult = { view: ConfigView; file: string; fileRemoved: boolean };
/** The fixed texts a run's `error` holds when it ended without a recorded outcome, so a screen can tell the kinds of failure apart. */
export const RUN_ERROR = {
  restarted: '서버 재시작으로 중단되었습니다. 새 실행으로 재시도하세요.',
  storage: '실행 기록을 저장하지 못해 큐를 중단했습니다. 프로젝트 파일과 저장 공간을 확인하세요.',
  start: '실행 준비 또는 실행이 실패했습니다. 연결과 브라우저 설정을 확인하세요.',
} as const;
