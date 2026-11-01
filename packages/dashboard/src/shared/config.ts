import { z } from 'zod';
import type { Task } from '@rawstep/core/contracts';
import { idSchema as id, runRulesOverrideSchema, type Model, type Permissions, type ProjectConfig } from '@rawstep/project/config';
import type { RunSpec } from '@rawstep/project/execution';
import type { ServerMessage } from './messages.js';

/** Batches are the project's (`@rawstep/project/experiment`), shared with the CLI; the dashboard uses them as they are. */
export { planSchema, RUN_ERROR, type BatchOwner, type Combination, type Experiment, type PlanRequest, type RetryPreview, type RunRecord, type RunState } from '@rawstep/project/experiment';
/** `tasks` holds each task's JSON as written in its file (not resolved), so edits keep relative URLs and omitted defaults. */
export type ConfigView = { config: ProjectConfig; revision: string; credentialStatus: Record<string, boolean>; tasks: Record<string, unknown>; environmentPresets: Record<string, unknown>; capabilities: Record<'simulation' | 'voiceover' | 'nvda', { keys: string[]; intents: string[] }> };
/** Answer to deleting a task: the project as it is now, the task's file and whether Rawstep removed that file (a linked file elsewhere in the project is only unregistered). */
export type DeleteTaskResult = { view: ConfigView; file: string; fileRemoved: boolean };
