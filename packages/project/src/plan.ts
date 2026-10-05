import { isLoopbackHostname } from '@rawstep/core/defaults';
import type { Task } from '@rawstep/core/contracts';
import { ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import { getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import {
  connectionProtocols, defaultInstructions, resolveRunSettings,
  type Connection, type MachineSettings, type ManagedTask, type Mode, type Model, type Permissions, type ProjectConfig, type Prompt, type RunProfile, type RunSettings,
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
/** Whether a model can take decisions in this mode at all: it has the decision role, the inputs the mode feeds it and a protocol that serves the mode. */
export function supportsMode(model: Model, mode: Mode): boolean {
  if (!model.roles.includes('decision')) return false;
  if (mode === 'keyboard') return model.inputs.includes('image') && model.maxImages >= 2 && model.protocol !== 'vercel-evaluation';
  return model.inputs.includes('text') && model.protocol !== 'choose';
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
  model: Model; profile: RunProfile; prompt: Prompt; mode: Mode;
  analysisModel?: Model; diagnoseStop?: boolean;
};
export type RunCheck = {
  settings: RunSettings; permissions: Permissions; connection: Connection;
  /** Why this combination cannot run; the other fields are still the best available values for display. */
  problem?: ProjectError;
};
/**
 * Everything that must hold before a run starts: permissions the backend supports, a model that can serve the mode,
 * a matching protocol and a host that can run the chosen screen reader. The first failure is reported as `problem`.
 */
export function checkRun({ config, task, taskEntry, model, profile, prompt, mode, analysisModel, diagnoseStop }: RunCheckInput): RunCheck {
  const settings = resolveRunSettings(config, taskEntry ?? {}, profile);
  const connection = config.connections.find(c => c.id === model.connectionId);
  let permissions = structuredClone(profile.permissions[mode]);
  const fail = (code: string, message: string): RunCheck => ({ settings, permissions, connection: connection!, problem: new ProjectError(code, message) });
  if (!connection) return fail('model-connection-missing', 'The model refers to a connection that does not exist.');
  try { permissions = resolvePermissions(config, profile, task, mode, taskEntry?.modes[mode].permissions ?? null); }
  catch (error) { return { settings, permissions, connection, problem: error as ProjectError }; }
  if (!model.roles.includes('decision')) return fail('analysis-only-model', 'This model is only for analysis.');
  if (mode === 'keyboard' && (!model.inputs.includes('image') || model.maxImages < 2)) return fail('model-needs-images', 'Keyboard runs need a model that accepts the current and the previous image.');
  if (mode === 'screenreader' && !model.inputs.includes('text')) return fail('model-needs-text', 'Screen reader runs need a model that accepts text.');
  if (!connectionProtocols[connection.provider].includes(model.protocol) || (model.protocol === 'chat') !== (model.family === 'LLM')) return fail('protocol-mismatch', "The model's calling protocol does not match its connection type. Register the model again.");
  if (model.protocol === 'vercel-evaluation' && mode === 'keyboard') return fail('vercel-text-only', 'The Vercel evaluation adapter accepts text only.');
  const choiceCount = permissions.keys.length + permissions.intents.length + (permissions.inputKeys?.length ?? 0) * (Number(permissions.typeText) + Number(permissions.replaceText)) + 3;
  if (choiceCount > model.maxChoices) return fail('too-many-choices', 'The selected actions give more candidates than the model supports.');
  if (model.protocol === 'choose' && mode !== 'keyboard') return fail('choose-keyboard-only', '/choose models run in keyboard mode only.');
  if (!model.promptEditable && prompt.instructions !== defaultInstructions.keyboard) return fail('prompt-not-editable', 'This /choose server does not support changing the prompt.');
  if (model.family === 'LLM' && settings.policy.focusGate) return fail('focus-gate-llm', 'The probability-based focus gate works only with SystemOne models. Turn it off in the run profile or the task settings.');
  if (mode === 'screenreader' && config.machine.backend === 'voiceover' && process.platform !== 'darwin') return fail('voiceover-macos', 'Run VoiceOver on macOS.');
  if (mode === 'screenreader' && config.machine.backend === 'nvda' && process.platform !== 'win32') return fail('nvda-windows', 'Run NVDA on Windows.');
  if (mode === 'screenreader' && config.machine.backend !== 'simulation') {
    const endpoint = new URL(config.machine.atEndpoint);
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || !isLoopbackHostname(endpoint.hostname) || endpoint.username || endpoint.password) return fail('endpoint-not-loopback', 'Native screen reader runs need a loopback AT Driver WebSocket address on this host.');
  }
  const environment = resolveEnvironmentProfile(profile.environment);
  if (environment.browserZoom !== 1 || environment.nativeMagnifier === 'required' || environment.nativeHighContrast === 'required') return fail('environment-unsupported', 'Rawstep cannot apply native magnification or an OS contrast environment.');
  if (analysisModel && (analysisModel.family !== 'LLM' || !analysisModel.roles.includes('analysis'))) return fail('analysis-model-invalid', 'Choose an LLM model with the analysis role.');
  if (diagnoseStop && mode !== 'keyboard') return fail('diagnose-keyboard-only', 'Stop diagnosis uses the last screenshot, so it works in keyboard mode only.');
  return { settings, permissions, connection };
}
/** The check result of a run that must go ahead: throws the problem, otherwise returns the settings. */
export function assertRunnable(check: RunCheck): Omit<RunCheck, 'problem'> {
  if (check.problem) throw check.problem;
  const { problem: _problem, ...ready } = check; return ready;
}
