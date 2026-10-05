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
export type ConfigView = { config: ProjectConfig; revision: string; credentialStatus: Record<string, boolean>; tasks: Record<string, Task>; environmentPresets: Record<string, unknown>; capabilities: { keyboard: { keys: string[]; intents: string[] }; screenreader: { keys: string[]; intents: string[] } } };
export type Combination = { key: string; taskId: string; modelId: string; promptId: string; profileId: string; repeat: number; supported: boolean; reason?: string; permissions: Permissions; permissionSource: 'profile' | 'task' };
export type RunState = 'queued' | 'running' | 'success' | 'failure' | 'inconclusive' | 'cancelled' | 'interrupted';
export type RunRecord = Combination & {
  id: string; state: RunState; startedAt?: string; endedAt?: string; error?: string;
  /** `profile` is the resolved page environment; `runProfile` names the run profile. */
  snapshot: { task: Task; taskName: string; model: Model; prompt: Prompt; mode: Mode; profile: unknown; globals: RunSettings; runProfile: { id: string; name: string } };
  outcome?: { status: string; reason?: string; steps?: number };
  analysisStatus: 'pending' | 'complete' | 'failed' | 'skipped'; reportStatus: 'pending' | 'complete' | 'failed' | 'skipped';
  analysisError?: string; reportError?: string; analysisModel?: Model;
  analysisInstructions?: string; taskFile?: string;
  retryOf?: { experiment: string; run: string };
  diagnoseStop?: boolean;
};
export type RetryPreview = { revision: string; changedFields: string[]; original: RunRecord['snapshot']['task']; current: RunRecord['snapshot']['task'] };
export type Experiment = { id: string; createdAt: string; stopped: boolean; runs: RunRecord[]; request: PlanRequest };
