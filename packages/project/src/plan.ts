import { isLoopbackHostname } from '@rawstep/core/defaults';
import type { Task } from '@rawstep/core/contracts';
import { ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import { getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { planFileSchema } from '@rawstep/policies/policy';
import {
  atEndpointOf, comboAnalysis, comboExecutor, comboPlanner, executorModel, followsPlan, isFilePlanner, planFileOf, resolveRunSettings, type LlmPlannerChoice,
  type ActionSet, type AtBackend, type AtEnvironment, type Combo, type ManagedTask, type Mode, type Model, type PageEnvironment, type Permissions,
  type Preset, type ProjectConfig, type Prompt, type RunSettings,
} from './config.js';
import { ProjectError } from './errors.js';
import type { RunSpec } from './execution.js';
import type { ProjectStore } from './store.js';

/** What a backend can do: keyboard runs use the screenshot keyboard backend, screen reader runs the simulation or a native AT Driver. */
export function backendCapabilities(backend: AtBackend, mode: Mode) {
  return mode === 'keyboard' ? new ScreenshotKeyboardBackend().capabilities : backend === 'simulation' ? new MockVoiceOverBackend().capabilities : getAtDriverProfile(backend).capabilities;
}
/** One mode of an action set, filtered by what the backend and the task support. Throws when an action is not available there. */
export function resolvePermissions(backend: AtBackend, actionSet: Pick<ActionSet, 'keyboard' | 'screenreader'>, task: Task, mode: Mode): Permissions {
  const p = structuredClone(actionSet[mode]), capabilities = backendCapabilities(backend, mode);
  const missing = [...p.keys.filter(k => !(capabilities.keys as readonly string[]).includes(k)), ...p.intents.filter(k => !capabilities.intents.includes(k))];
  if (missing.length) throw new ProjectError('unsupported-action', `This assistive technology does not support: ${missing.join(', ')}.`);
  const keys = Object.keys(task.input ?? {});
  const requested = p.inputKeys ?? keys;
  if (requested.some(k => !keys.includes(k))) throw new ProjectError('unknown-input', 'The selected input name is not in the task.');
  p.inputKeys = capabilities.textEntry && (p.typeText || p.replaceText) ? requested : [];
  p.typeText &&= capabilities.textEntry; p.replaceText &&= capabilities.replaceText;
  return p;
}
/** Whether a model can take decisions in this mode: it takes the inputs the mode feeds it (keyboard mode sends two images). */
export function supportsMode(model: Pick<Model, 'inputs' | 'maxImages'>, mode: Mode): boolean {
  return mode === 'keyboard' ? model.inputs.includes('image') && model.maxImages >= 2 : model.inputs.includes('text');
}
/** The modes a combo can run: those it has an executor for that takes what the mode sends. */
export function comboModes(config: Pick<ProjectConfig, 'connections'>, combo: Pick<Combo, 'executors'> & Partial<Pick<Combo, 'structure'>>): Mode[] {
  return (['screenreader', 'keyboard'] as const).filter(mode => { const model = comboExecutor(config, combo, mode); return !!model && supportsMode(model, mode); });
}
/**
 * The executor's instructions as a run records them: identified by combo and mode, versioned by their content, so two runs with
 * different wording never share an ID and version.
 */
export function executorPrompt(combo: Pick<Combo, 'id' | 'name' | 'executors'> & Partial<Pick<Combo, 'structure'>>, mode: Mode): Prompt | undefined {
  if (followsPlan(combo, mode)) return { id: `${combo.id}.${mode}.follow-plan`, name: combo.name, version: 'follow-plan', instructions: '' };
  const executor = executorModel(combo, mode);
  if (!executor) return undefined;
  return { id: `${combo.id}.${mode}`, name: combo.name, version: createHash('sha256').update(executor.instructions).digest('hex').slice(0, 12), instructions: executor.instructions };
}

/** The conditions of one run. */
export type RunConditions = { combo: Combo; actionSet: ActionSet; pageEnvironment: PageEnvironment; atEnvironment: AtEnvironment; preset?: Preset | undefined };
export type RunCheckInput = RunConditions & {
  config: ProjectConfig;
  /** The resolved task file, for its input names. */
  task: Task;
  /** The task's entry in rawstep.config.json; absent for a task file that is not registered. */
  taskEntry?: Pick<ManagedTask, 'runRules' | 'analysisInstructions'> & Partial<Pick<ManagedTask, 'file'>>;
  mode: Mode;
  diagnoseStop?: boolean;
};
export type RunCheck = {
  settings: RunSettings;
  /** The action set's actions for the mode, filtered by the backend and the task. */
  permissions: Permissions;
  /** The executor for the mode and its instructions. */
  model?: Model; prompt?: Prompt;
  /** The planner and its added instructions: screen reader runs of a planned combo only. */
  plannerModel?: Model; plannerInstructions?: string;
  /** Instead of a planner model: the project-relative plan file this task reads (screen reader runs of a combo with a file planner). */
  plannerPlanFile?: string;
  /** The LLM that explains the run (the combo's, else the project's). Never blocks a run. */
  analysisModel?: Model;
  /** Things worth knowing that do not stop the run (a planned combo in keyboard mode, an analysis model that is not an LLM). */
  warnings: string[];
  /** Why this combination cannot run; the other fields are still the best available values for display. */
  problem?: ProjectError;
};
/**
 * Everything that must hold before a run starts, checked condition by condition: the combo can serve the mode, the action set fits
 * the assistive technology and the task, the page environment can be applied, the host can run the screen reader. The first
 * failure is reported as `problem`. Analysis never blocks a run.
 */
export function checkRun({ config, task, taskEntry, combo, actionSet, pageEnvironment, atEnvironment, preset, mode, diagnoseStop }: RunCheckInput): RunCheck {
  const settings = resolveRunSettings(config, taskEntry ?? {}, preset);
  const backend: AtBackend = mode === 'screenreader' ? atEnvironment.backend : 'simulation';
  const model = comboExecutor(config, combo, mode), prompt = executorPrompt(combo, mode), analysisModel = comboAnalysis(config, combo);
  const plannerModel = mode === 'screenreader' ? comboPlanner(config, combo) : undefined;
  const filePlanner = mode === 'screenreader' && combo.structure === 'planned' && isFilePlanner(combo.planner) ? combo.planner : undefined;
  // Only `{task}` needs the task's file name; a constant plan path works for any task, registered or not.
  const plannerPlanFile = !filePlanner ? undefined : !filePlanner.planFile.includes('{task}') ? filePlanner.planFile : taskEntry?.file ? planFileOf(filePlanner, { file: taskEntry.file }) : undefined;
  const warnings: string[] = [];
  if (combo.structure === 'planned' && mode === 'keyboard') warnings.push('Keyboard runs do not use the planner yet; the keyboard executor decides alone.');
  let permissions = structuredClone(actionSet[mode]);
  const models = { ...(model ? { model } : {}), ...(prompt ? { prompt } : {}), ...(analysisModel ? { analysisModel } : {}),
    ...(plannerModel ? { plannerModel, plannerInstructions: (combo.planner as LlmPlannerChoice).instructions } : {}), ...(plannerPlanFile ? { plannerPlanFile } : {}) };
  const fail = (code: string, message: string): RunCheck => ({ settings, permissions, ...models, warnings, problem: new ProjectError(code, message) });
  try { permissions = resolvePermissions(backend, actionSet, task, mode); }
  catch (error) { return { settings, permissions, ...models, warnings, problem: error as ProjectError }; }
  if (!model) return fail('combo-without-executor', mode === 'keyboard' ? 'This model combo has no keyboard executor yet. Pick a model that takes images for keyboard mode.' : 'This model combo has no screen reader executor yet. Pick a model for screen reader mode.');
  if (mode === 'keyboard' && !supportsMode(model, 'keyboard')) return fail('model-needs-images', 'Keyboard runs need an executor that accepts the current and the previous image.');
  if (mode === 'screenreader' && !supportsMode(model, 'screenreader')) return fail('model-needs-text', 'Screen reader runs need an executor that accepts text.');
  if (filePlanner && !plannerPlanFile) return fail('plan-file-task', 'A plan file needs a task file to fill in {task}.');
  // Following the plan only moves and presses: a task that has to type into a named input cannot be carried out that way.
  if (followsPlan(combo, mode) && permissions.inputKeys?.length) return fail('follow-plan-text-entry', 'Following the plan cannot type into inputs yet. Pick an executor model for this task, or an action set without text entry.');
  if (followsPlan(combo, mode) && settings.runRules.taskControl === 'executor') return fail('follow-plan-task-control', 'Following the plan needs Rawstep to decide when tasks are done. Set task control to Rawstep.');
  if (combo.structure === 'planned' && mode === 'screenreader' && !plannerModel && !plannerPlanFile) return fail('planner-model-invalid', 'The model combo plans, so its planner must be a model on an LLM connection or a plan file.');
  // The executor's own task choices ("done" and three help reasons) exist only when it controls the tasks.
  const planChoices = (plannerModel || plannerPlanFile) && settings.runRules.taskControl === 'executor' ? 4 : 0, stops = settings.runRules.modelGiveUp ? 3 : 1;
  const choiceCount = permissions.keys.length + permissions.intents.length + (permissions.inputKeys?.length ?? 0) * (Number(permissions.typeText) + Number(permissions.replaceText)) + stops + planChoices;
  if (choiceCount > model.maxChoices) return fail('too-many-choices', 'The action set gives more candidates than the executor supports.');
  if (mode === 'keyboard' && executorModel(combo, 'keyboard')?.focusGate && model.kind === 'llm') return fail('focus-gate-llm', 'The probability-based focus judgement works only with decision models. Turn it off in the keyboard executor.');
  if (backend === 'voiceover' && process.platform !== 'darwin') return fail('voiceover-macos', 'Run VoiceOver on macOS.');
  if (backend === 'nvda' && process.platform !== 'win32') return fail('nvda-windows', 'Run NVDA on Windows.');
  if (backend !== 'simulation') {
    const endpoint = new URL(atEndpointOf(config.machine, backend));
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || !isLoopbackHostname(endpoint.hostname) || endpoint.username || endpoint.password) return fail('endpoint-not-loopback', 'Native screen reader runs need a loopback AT Driver WebSocket address on this host.');
  }
  const environment = resolveEnvironmentProfile(pageEnvironment.profile);
  if (environment.browserZoom !== 1 || environment.nativeMagnifier === 'required' || environment.nativeHighContrast === 'required') return fail('environment-unsupported', 'Rawstep cannot apply native magnification or an OS contrast environment.');
  if (diagnoseStop && mode !== 'keyboard') return fail('diagnose-keyboard-only', 'Stop diagnosis uses the last screenshot, so it works in keyboard mode only.');
  if ((combo.analysis || config.project.analysis.model) && !analysisModel) warnings.push('The analysis model is not on an LLM connection, so the run is analysed by rules only.');
  return { settings, permissions, ...models, warnings };
}
/** The check result of a run that must go ahead: throws the problem, otherwise returns the settings. */
export function assertRunnable(check: RunCheck): Omit<RunCheck, 'problem'> {
  if (check.problem) throw check.problem;
  const { problem: _problem, ...ready } = check; return ready;
}
/**
 * The conditions as a run records them at `run.started`: enough to tell two runs apart by content, not by name — the combo's
 * structure and role models, the resolved actions, both environments and the rules. Task-only copies say what they came from.
 */
export function conditionsRecord(c: RunConditions, check: Omit<RunCheck, 'problem'>): Record<string, unknown> {
  const origin = (item: { owner?: string | undefined; copiedFrom?: string | undefined }) => ({ ...(item.owner ? { owner: item.owner } : {}), ...(item.copiedFrom ? { copiedFrom: item.copiedFrom } : {}) });
  return {
    combo: { id: c.combo.id, name: c.combo.name, structure: c.combo.structure, ...(followsPlan(c.combo, 'screenreader') ? { followPlan: true } : {}), ...origin(c.combo), ...(check.model ? { executor: check.model.name } : {}),
      ...(check.prompt ? { prompt: { id: check.prompt.id, version: check.prompt.version } } : {}), ...(check.plannerModel ? { planner: check.plannerModel.name } : check.plannerPlanFile ? { planFile: check.plannerPlanFile } : {}),
      ...(check.analysisModel ? { analysis: check.analysisModel.name } : {}) },
    actionSet: { id: c.actionSet.id, name: c.actionSet.name, ...origin(c.actionSet), permissions: structuredClone(check.permissions) },
    pageEnvironment: { id: c.pageEnvironment.id, name: c.pageEnvironment.name, ...origin(c.pageEnvironment), profile: structuredClone(c.pageEnvironment.profile) },
    atEnvironment: { id: c.atEnvironment.id, name: c.atEnvironment.name, backend: c.atEnvironment.backend },
    runRules: structuredClone(check.settings.runRules), ...(c.preset ? { preset: { id: c.preset.id, name: c.preset.name } } : {}),
  };
}
/** The run spec of a check that passed. */
export function runSpecOf(task: Task, mode: Mode, c: RunConditions, check: Omit<RunCheck, 'problem'>, diagnoseStop?: boolean): RunSpec {
  // A combo that follows its plan has no executor settings of its own for the mode: the defaults stand in, and nothing is left to decide.
  const executor = executorModel(c.combo, mode);
  return { task, mode, model: check.model!, prompt: check.prompt!,
    executor: { historyLimit: executor?.historyLimit ?? RAWSTEP_DEFAULTS.policy.historyLimit, focusGate: executor?.focusGate ?? false, latitude: executor?.latitude ?? 'none' },
    settings: check.settings, environment: resolveEnvironmentProfile(c.pageEnvironment.profile), backend: c.atEnvironment.backend, permissions: check.permissions,
    conditions: conditionsRecord(c, check), ...(diagnoseStop ? { diagnoseStop } : {}),
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
