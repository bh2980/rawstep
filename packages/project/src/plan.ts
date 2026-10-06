import { isLoopbackHostname } from '@rawstep/core/defaults';
import type { Task } from '@rawstep/core/contracts';
import { ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import { getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import {
  atEndpointOf, defaultInstructions, profileAnalysisModel, profileModel, resolveRunSettings,
  type MachineSettings, type ManagedTask, type Mode, type Model, type Permissions, type ProjectConfig, type Prompt, type RunProfile, type RunSettings,
} from './config.js';
import { ProjectError } from './errors.js';

/** What the selected backend can do: keyboard runs use the screenshot keyboard backend, screen reader runs the simulation or a native AT Driver. */
export function backendCapabilities(config: { machine: Pick<MachineSettings, 'backend'> }, mode: Mode) {
  return mode === 'keyboard' ? new ScreenshotKeyboardBackend().capabilities : config.machine.backend === 'simulation' ? new MockVoiceOverBackend().capabilities : getAtDriverProfile(config.machine.backend).capabilities;
}
/** Permissions for one run: the task's per-mode override, otherwise the run profile's, filtered by what the backend and task support. */
export function resolvePermissions(config: { machine: Pick<MachineSettings, 'backend'> }, profile: Pick<RunProfile, 'permissions'>, task: Task, mode: Mode, override: Permissions | null): Permissions {
  const p = structuredClone(override ?? profile.permissions[mode]), capabilities = backendCapabilities(config, mode);
  if (p.keys.some(k => !(capabilities.keys as readonly string[]).includes(k)) || p.intents.some(k => !capabilities.intents.includes(k))) throw new ProjectError('unsupported-action', 'This backend does not support one of the selected actions.');
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
/** The prompt a run uses when none is picked: the task's first for this mode, otherwise the built-in instructions. */
export function defaultPrompt(task: Pick<ManagedTask, 'modes'> | undefined, mode: Mode): Prompt {
  return task?.modes[mode].prompts[0] ?? { id: 'baseline', name: 'Default', version: '1', instructions: defaultInstructions[mode] };
}

export type RunCheckInput = {
  config: ProjectConfig;
  /** The resolved task file, for its input names. */
  task: Task;
  /** The task's entry in rawstep.config.json; absent for a task file that is not registered. */
  taskEntry?: Pick<ManagedTask, 'policy' | 'analysisInstructions' | 'modes'>;
  profile: RunProfile; mode: Mode;
  diagnoseStop?: boolean;
};
export type RunCheck = {
  settings: RunSettings; permissions: Permissions;
  /** The profile's decision model and analysis LLM, joined with their connections. */
  model?: Model; analysisModel?: Model;
  /** Why this combination cannot run; the other fields are still the best available values for display. */
  problem?: ProjectError;
};
/**
 * Everything that must hold before a run starts: permissions the backend supports, a model that can serve the mode,
 * and a host that can run the chosen screen reader. The first failure is reported as `problem`.
 */
export function checkRun({ config, task, taskEntry, profile, mode, diagnoseStop }: RunCheckInput): RunCheck {
  const settings = resolveRunSettings(config, taskEntry ?? {}, profile);
  const model = profileModel(config, profile), analysisModel = profileAnalysisModel(config, profile);
  let permissions = structuredClone(profile.permissions[mode]);
  const fail = (code: string, message: string): RunCheck => ({ settings, permissions, ...(model ? { model } : {}), ...(analysisModel ? { analysisModel } : {}), problem: new ProjectError(code, message) });
  try { permissions = resolvePermissions(config, profile, task, mode, taskEntry?.modes[mode].permissions ?? null); }
  catch (error) { return { settings, permissions, problem: error as ProjectError }; }
  if (!model) return fail('profile-without-model', 'This run profile has no model yet. Pick a connection and a model in the profile.');
  if (mode === 'keyboard' && (!model.inputs.includes('image') || model.maxImages < 2)) return fail('model-needs-images', 'Keyboard runs need a model that accepts the current and the previous image.');
  if (mode === 'screenreader' && !model.inputs.includes('text')) return fail('model-needs-text', 'Screen reader runs need a model that accepts text.');
  const choiceCount = permissions.keys.length + permissions.intents.length + (permissions.inputKeys?.length ?? 0) * (Number(permissions.typeText) + Number(permissions.replaceText)) + (settings.policy.modelGiveUp ? 3 : 1);
  if (choiceCount > model.maxChoices) return fail('too-many-choices', 'The selected actions give more candidates than the model supports.');
  if (model.kind === 'llm' && settings.policy.focusGate) return fail('focus-gate-llm', 'The probability-based focus gate works only with decision models. Turn it off in the run profile or the task settings.');
  if (mode === 'screenreader' && config.machine.backend === 'voiceover' && process.platform !== 'darwin') return fail('voiceover-macos', 'Run VoiceOver on macOS.');
  if (mode === 'screenreader' && config.machine.backend === 'nvda' && process.platform !== 'win32') return fail('nvda-windows', 'Run NVDA on Windows.');
  if (mode === 'screenreader' && config.machine.backend !== 'simulation') {
    const endpoint = new URL(atEndpointOf(config.machine));
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || !isLoopbackHostname(endpoint.hostname) || endpoint.username || endpoint.password) return fail('endpoint-not-loopback', 'Native screen reader runs need a loopback AT Driver WebSocket address on this host.');
  }
  const environment = resolveEnvironmentProfile(profile.environment);
  if (environment.browserZoom !== 1 || environment.nativeMagnifier === 'required' || environment.nativeHighContrast === 'required') return fail('environment-unsupported', 'Rawstep cannot apply native magnification or an OS contrast environment.');
  if (profile.analysisModel && !analysisModel) return fail('analysis-model-invalid', 'The profile\'s analysis model must be on an LLM connection.');
  if (diagnoseStop && mode !== 'keyboard') return fail('diagnose-keyboard-only', 'Stop diagnosis uses the last screenshot, so it works in keyboard mode only.');
  return { settings, permissions, model, ...(analysisModel ? { analysisModel } : {}) };
}
/** The check result of a run that must go ahead: throws the problem, otherwise returns the settings. */
export function assertRunnable(check: RunCheck): Omit<RunCheck, 'problem'> {
  if (check.problem) throw check.problem;
  const { problem: _problem, ...ready } = check; return ready;
}
