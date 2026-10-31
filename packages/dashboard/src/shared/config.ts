import { z } from 'zod';
import type { Task } from '@rawstep/core/contracts';
import { idSchema as id, runRulesOverrideSchema, type Model, type Permissions, type ProjectConfig } from '@rawstep/project/config';
import type { RunSpec } from '@rawstep/project/execution';
import type { ServerMessage } from './messages.js';

/** An experiment: tasks × run profiles × repeats. */
export const planSchema = z.object({
  taskIds: z.array(id).min(1).max(100),
  profileIds: z.array(id).min(1).max(100),
  /** Run rules for this experiment only, over each profile's. */
  runRules: runRulesOverrideSchema.optional(),
  repeats: z.number().int().min(1).max(100),
  selected: z.array(z.string().max(500)).max(1000).optional(),
  revision: z.string().optional(),
  /** What this batch of runs is for, in the person's words ("made Add to cart a button"); shown wherever the batch is picked. */
  note: z.string().trim().max(200).optional(),
}).strict();
export type PlanRequest = z.infer<typeof planSchema>;
/** `tasks` holds each task's JSON as written in its file (not resolved), so edits keep relative URLs and omitted defaults. */
export type ConfigView = { config: ProjectConfig; revision: string; credentialStatus: Record<string, boolean>; tasks: Record<string, unknown>; environmentPresets: Record<string, unknown>; capabilities: Record<'simulation' | 'voiceover' | 'nvda', { keys: string[]; intents: string[] }> };
/**
 * One run to make: a task with one run profile. `plannerName` is its planner (the model, or the plan file);
 * `reason` says why it cannot run, `warnings` what is worth knowing.
 */
export type Combination = {
  key: string; taskId: string; repeat: number;
  profileId: string;
  plannerName?: string;
  supported: boolean; reason?: ServerMessage; warnings: ServerMessage[]; permissions: Permissions;
};
export type RunState = 'queued' | 'running' | 'success' | 'failure' | 'inconclusive' | 'cancelled' | 'interrupted';
export type RunRecord = Combination & {
  id: string; state: RunState; startedAt?: string; endedAt?: string; error?: string;
  /** Why a run could not start or failed without a recorded outcome: the error's code and its message, with keys and input values redacted. */
  errorDetail?: { code?: string; message: string };
  /** What the run was made with: the run spec (its task without secret values) and the task's name at the time. */
  snapshot: { taskName: string; spec: RunSpec };
  /**
   * `stage` and `step` say how far a failed run got, `stopSource` who ended a run that stopped itself (the user giving up, a limit);
   * nothing else of the recorded outcome (its raw error text) is kept.
   */
  outcome?: { status: string; reason?: string; steps?: number; stage?: string; step?: number; stopSource?: string };
  analysisStatus: 'pending' | 'complete' | 'failed' | 'skipped'; reportStatus: 'pending' | 'complete' | 'failed' | 'skipped';
  /** Codes (`analysis-failed`, `report-failed`) or the analyzer's own recorded error text; shown only with the raw record. */
  analysisError?: string; reportError?: string; analysisModel?: Model;
  analysisInstructions?: string; taskFile?: string;
  retryOf?: { experiment: string; run: string };
};
export type RetryPreview = { revision: string; changedFields: string[]; original: RunSpec['task']; current: RunSpec['task'] };
export type Experiment = { id: string; createdAt: string; stopped: boolean; runs: RunRecord[]; request: PlanRequest };
/** Answer to deleting a task: the project as it is now, the task's file and whether Rawstep removed that file (a linked file elsewhere in the project is only unregistered). */
export type DeleteTaskResult = { view: ConfigView; file: string; fileRemoved: boolean };
/**
 * The codes a run's `error` holds when it ended without a recorded outcome, so a screen can tell the kinds of failure apart. They are
 * codes, not sentences: the dashboard words them in the reader's language.
 */
export const RUN_ERROR = {
  restarted: 'run-restarted',
  storage: 'run-storage',
  start: 'run-start',
} as const;
