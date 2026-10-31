import { isLoopbackHostname } from '@rawstep/core/defaults';
import type { Task } from '@rawstep/core/contracts';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import { getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { planFileSchema } from '@rawstep/policies/policy';
import {
  atEndpointOf, comboPlanner, isFilePlanner, planFileOf, projectAnalysisModel, resolveRunSettings, type LlmPlannerChoice,
  type ActionSet, type AtBackend, type Conditions, type ManagedTask, type Model, type Permissions,
  type ProjectConfig, type RunRulesOverride, type RunSettings,
} from './config.js';
import { ProjectError } from './errors.js';
import type { RunSpec } from './execution.js';
import type { ProjectStore } from './store.js';

/** What a backend can do: the simulation or a native screen reader over AT Driver. */
export function backendCapabilities(backend: AtBackend) {
  return backend === 'simulation' ? new MockVoiceOverBackend().capabilities : getAtDriverProfile(backend).capabilities;
}
/** An action set's actions, filtered by what the backend and the task support. Throws when an action is not available there. */
export function resolvePermissions(backend: AtBackend, actionSet: Pick<ActionSet, 'actions'>, task: Task): Permissions {
  const p = structuredClone(actionSet.actions), capabilities = backendCapabilities(backend);
  const missing = [...p.keys.filter(k => !(capabilities.keys as readonly string[]).includes(k)), ...p.intents.filter(k => !capabilities.intents.includes(k))];
  if (missing.length) throw new ProjectError('unsupported-action', `This assistive technology does not support: ${missing.join(', ')}.`);
  const keys = Object.keys(task.input ?? {});
  const requested = p.inputKeys ?? keys;
  if (requested.some(k => !keys.includes(k))) throw new ProjectError('unknown-input', 'The selected input name is not in the task.');
  p.inputKeys = capabilities.textEntry && (p.typeText || p.replaceText) ? requested : [];
  p.typeText &&= capabilities.textEntry; p.replaceText &&= capabilities.replaceText;
  return p;
}
/** The conditions of one run: its profile and the parts read off it (see `profileConditions`). */
export type RunConditions = Conditions;
export type RunCheckInput = RunConditions & {
  config: ProjectConfig;
  /** The resolved task file, for its input names. */
  task: Task;
  /** The task's entry in rawstep.config.json; absent for a task file that is not registered. */
  taskEntry?: Pick<ManagedTask, 'analysisInstructions'> & Partial<Pick<ManagedTask, 'file'>>;
  /** Run rules for these runs only, over the profile's. */
  runRules?: RunRulesOverride | undefined;
};
export type RunCheck = {
  settings: RunSettings;
  /** The action set's actions, filtered by the backend and the task. */
  permissions: Permissions;
  /** The planner and its added instructions. */
  plannerModel?: Model; plannerInstructions?: string;
  /** Instead of a planner model: the project-relative plan file this task reads (a profile with a file planner). */
  plannerPlanFile?: string;
  /** The project's LLM that explains the run. Never blocks a run. */
  analysisModel?: Model;
  /** Things worth knowing that do not stop the run (an analysis model that is not an LLM). */
  warnings: string[];
  /** Why this combination cannot run; the other fields are still the best available values for display. */
  problem?: ProjectError;
};
/**
 * Everything that must hold before a run starts, checked condition by condition: the profile has a planner, the action set fits
 * the assistive technology and the task, the page environment can be applied, the host can run the screen reader. The first
 * failure is reported as `problem`. Analysis never blocks a run.
 */
export function checkRun({ config, task, taskEntry, runRules, profile, combo, actionSet, pageEnvironment, atEnvironment }: RunCheckInput): RunCheck {
  const settings = resolveRunSettings(config, taskEntry ?? {}, profile, runRules);
  const backend = atEnvironment.backend;
  const analysisModel = projectAnalysisModel(config);
  const plannerModel = comboPlanner(config, combo);
  const filePlanner = isFilePlanner(combo.planner) ? combo.planner : undefined;
  // Only `{task}` needs the task's file name; a constant plan path works for any task, registered or not.
  const plannerPlanFile = !filePlanner ? undefined : !filePlanner.planFile.includes('{task}') ? filePlanner.planFile : taskEntry?.file ? planFileOf(filePlanner, { file: taskEntry.file }) : undefined;
  const warnings: string[] = [];
  let permissions = structuredClone(actionSet.actions);
  const models = { ...(analysisModel ? { analysisModel } : {}),
    ...(plannerModel ? { plannerModel, plannerInstructions: (combo.planner as LlmPlannerChoice).instructions } : {}), ...(plannerPlanFile ? { plannerPlanFile } : {}) };
  const fail = (code: string, message: string): RunCheck => ({ settings, permissions, ...models, warnings, problem: new ProjectError(code, message) });
  try { permissions = resolvePermissions(backend, actionSet, task); }
  catch (error) { return { settings, permissions, ...models, warnings, problem: error as ProjectError }; }
  if (filePlanner && !plannerPlanFile) return fail('plan-file-task', 'A plan file needs a task file to fill in {task}.');
  if (!plannerModel && !plannerPlanFile) return fail('planner-model-invalid', 'Runs plan, so the profile needs a planner: a model on an LLM connection or a plan file.');
  if (backend === 'voiceover' && process.platform !== 'darwin') return fail('voiceover-macos', 'Run VoiceOver on macOS.');
  if (backend === 'nvda' && process.platform !== 'win32') return fail('nvda-windows', 'Run NVDA on Windows.');
  if (backend !== 'simulation') {
    const endpoint = new URL(atEndpointOf(config.machine, backend));
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || !isLoopbackHostname(endpoint.hostname) || endpoint.username || endpoint.password) return fail('endpoint-not-loopback', 'Native screen reader runs need a loopback AT Driver WebSocket address on this host.');
  }
  const environment = resolveEnvironmentProfile(pageEnvironment.profile);
  if (environment.browserZoom !== 1 || environment.nativeMagnifier === 'required' || environment.nativeHighContrast === 'required') return fail('environment-unsupported', 'Rawstep cannot apply native magnification or an OS contrast environment.');
  if (config.project.analysis.model && !analysisModel) warnings.push('The analysis model is not on an LLM connection, so the run is analysed by rules only.');
  return { settings, permissions, ...models, warnings };
}
/** The check result of a run that must go ahead: throws the problem, otherwise returns the settings. */
export function assertRunnable(check: RunCheck): Omit<RunCheck, 'problem'> {
  if (check.problem) throw check.problem;
  const { problem: _problem, ...ready } = check; return ready;
}
/**
 * The conditions as a run records them at `run.started`: enough to tell two runs apart by content, not by name — the profile, the
 * role models, the resolved actions, both environments and the rules.
 */
export function conditionsRecord(c: RunConditions, check: Omit<RunCheck, 'problem'>): Record<string, unknown> {
  return {
    profile: { id: c.profile.id, name: c.profile.name },
    combo: { id: c.combo.id, name: c.combo.name, ...(check.plannerModel ? { planner: check.plannerModel.name } : check.plannerPlanFile ? { planFile: check.plannerPlanFile } : {}),
      ...(check.analysisModel ? { analysis: check.analysisModel.name } : {}) },
    actionSet: { id: c.actionSet.id, name: c.actionSet.name, permissions: structuredClone(check.permissions) },
    pageEnvironment: { id: c.pageEnvironment.id, name: c.pageEnvironment.name, profile: structuredClone(c.pageEnvironment.profile) },
    atEnvironment: { id: c.atEnvironment.id, name: c.atEnvironment.name, backend: c.atEnvironment.backend },
    runRules: structuredClone(check.settings.runRules),
  };
}
/** The run spec of a check that passed. */
export function runSpecOf(task: Task, c: RunConditions, check: Omit<RunCheck, 'problem'>): RunSpec {
  return { task, settings: check.settings, environment: resolveEnvironmentProfile(c.pageEnvironment.profile), backend: c.atEnvironment.backend, permissions: check.permissions,
    conditions: conditionsRecord(c, check),
    ...(check.plannerModel ? { plannerModel: check.plannerModel, plannerInstructions: check.plannerInstructions ?? '' } : {}) };
}
/**
 * The plan file a check named, read and validated, for the run spec (content and fingerprint, so a run records exactly the plan it
 * ran with). Throws `plan-file-invalid` when the file is missing or is not a plan draft.
 */
export async function loadPlanFile(store: Pick<ProjectStore, 'file'>, path: string): Promise<NonNullable<RunSpec['plannerPlan']>> {
  let text: string;
  try { text = await readFile(await store.file(path, true), 'utf8'); }
  catch { throw new ProjectError('plan-file-invalid', `The plan file ${path} cannot be read.`); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProjectError('plan-file-invalid', `The plan file ${path} is not JSON.`); }
  const result = planFileSchema.safeParse(parsed);
  if (!result.success || !result.data.phases.some(phase => phase.tasks.length)) throw new ProjectError('plan-file-invalid', `The plan file ${path} is not a plan with tasks (phases of tasks with goal, done and cue).`);
  return { file: path, draft: result.data, sha256: createHash('sha256').update(text).digest('hex') };
}
