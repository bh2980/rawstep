import { isLoopbackHostname } from '@rawstep/core/defaults';
import type { Task } from '@rawstep/core/contracts';
import { ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import { getAtDriverProfile } from '@rawstep/screenreaders/at-driver';
import { createHash } from 'node:crypto';
import {
  agentExecutor, agentPlanner, atEndpointOf, projectAnalysisModel, resolveRunSettings,
  type Agent, type Environment, type MachineSettings, type ManagedTask, type Mode, type Model, type Permissions, type ProjectConfig, type Prompt, type RunSettings,
} from './config.js';
import { ProjectError } from './errors.js';

/** What the selected backend can do: keyboard runs use the screenshot keyboard backend, screen reader runs the simulation or a native AT Driver. */
export function backendCapabilities(config: { machine: Pick<MachineSettings, 'backend'> }, mode: Mode) {
  return mode === 'keyboard' ? new ScreenshotKeyboardBackend().capabilities : config.machine.backend === 'simulation' ? new MockVoiceOverBackend().capabilities : getAtDriverProfile(config.machine.backend).capabilities;
}
/** Permissions for one run: the task's per-mode override, otherwise the agent's, filtered by what the backend and task support. */
export function resolvePermissions(config: { machine: Pick<MachineSettings, 'backend'> }, agent: Pick<Agent, 'permissions'>, task: Task, mode: Mode, override: Permissions | null): Permissions {
  const p = structuredClone(override ?? agent.permissions[mode]), capabilities = backendCapabilities(config, mode);
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
/**
 * The executor's instructions as a run records them: identified by agent and mode, versioned by their content, so two runs with
 * different wording never share an ID and version.
 */
export function executorPrompt(agent: Pick<Agent, 'id' | 'name' | 'executors'>, mode: Mode): Prompt | undefined {
  const executor = agent.executors[mode];
  if (!executor) return undefined;
  return { id: `${agent.id}.${mode}`, name: agent.name, version: createHash('sha256').update(executor.instructions).digest('hex').slice(0, 12), instructions: executor.instructions };
}

export type RunCheckInput = {
  config: ProjectConfig;
  /** The resolved task file, for its input names. */
  task: Task;
  /** The task's entry in rawstep.config.json; absent for a task file that is not registered. */
  taskEntry?: Pick<ManagedTask, 'policy' | 'analysisInstructions' | 'permissions'>;
  agent: Agent; environment: Environment; mode: Mode;
  diagnoseStop?: boolean;
};
export type RunCheck = {
  settings: RunSettings; permissions: Permissions;
  /** The agent's executor for the mode and its instructions, and the project's analysis LLM, joined with their connections. */
  model?: Model; prompt?: Prompt; analysisModel?: Model;
  /** The agent's planner LLM and its added instructions, for screen reader runs only: keyboard runs decide without a planner. */
  plannerModel?: Model; plannerInstructions?: string;
  /** Why this combination cannot run; the other fields are still the best available values for display. */
  problem?: ProjectError;
};
/**
 * Everything that must hold before a run starts: permissions the backend supports, an executor that can serve the mode,
 * and a host that can run the chosen screen reader. The first failure is reported as `problem`.
 */
export function checkRun({ config, task, taskEntry, agent, environment: environmentEntry, mode, diagnoseStop }: RunCheckInput): RunCheck {
  const settings = resolveRunSettings(config, taskEntry ?? {}, agent);
  const model = agentExecutor(config, agent, mode), prompt = executorPrompt(agent, mode), analysisModel = projectAnalysisModel(config);
  const plannerModel = mode === 'screenreader' ? agentPlanner(config, agent) : undefined;
  let permissions = structuredClone(agent.permissions[mode]);
  const models = { ...(model ? { model } : {}), ...(prompt ? { prompt } : {}), ...(analysisModel ? { analysisModel } : {}),
    ...(plannerModel ? { plannerModel, plannerInstructions: agent.planner!.instructions } : {}) };
  const fail = (code: string, message: string): RunCheck => ({ settings, permissions, ...models, problem: new ProjectError(code, message) });
  try { permissions = resolvePermissions(config, agent, task, mode, taskEntry?.permissions?.[mode] ?? null); }
  catch (error) { return { settings, permissions, problem: error as ProjectError }; }
  if (!model) return fail('agent-without-executor', mode === 'keyboard' ? 'This agent has no keyboard executor yet. Pick a model that takes images for keyboard mode in the agent.' : 'This agent has no screen reader executor yet. Pick a model for screen reader mode in the agent.');
  if (mode === 'keyboard' && (!model.inputs.includes('image') || model.maxImages < 2)) return fail('model-needs-images', 'Keyboard runs need a model that accepts the current and the previous image.');
  if (mode === 'screenreader' && !model.inputs.includes('text')) return fail('model-needs-text', 'Screen reader runs need a model that accepts text.');
  const choiceCount = permissions.keys.length + permissions.intents.length + (permissions.inputKeys?.length ?? 0) * (Number(permissions.typeText) + Number(permissions.replaceText)) + (settings.policy.modelGiveUp ? 3 : 1) + (plannerModel ? 2 : 0);
  if (choiceCount > model.maxChoices) return fail('too-many-choices', 'The selected actions give more candidates than the model supports.');
  if (model.kind === 'llm' && settings.policy.focusGate) return fail('focus-gate-llm', 'The probability-based focus gate works only with decision models. Turn it off in the agent or the task settings.');
  if (mode === 'screenreader' && config.machine.backend === 'voiceover' && process.platform !== 'darwin') return fail('voiceover-macos', 'Run VoiceOver on macOS.');
  if (mode === 'screenreader' && config.machine.backend === 'nvda' && process.platform !== 'win32') return fail('nvda-windows', 'Run NVDA on Windows.');
  if (mode === 'screenreader' && config.machine.backend !== 'simulation') {
    const endpoint = new URL(atEndpointOf(config.machine));
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || !isLoopbackHostname(endpoint.hostname) || endpoint.username || endpoint.password) return fail('endpoint-not-loopback', 'Native screen reader runs need a loopback AT Driver WebSocket address on this host.');
  }
  const environment = resolveEnvironmentProfile(environmentEntry.profile);
  if (environment.browserZoom !== 1 || environment.nativeMagnifier === 'required' || environment.nativeHighContrast === 'required') return fail('environment-unsupported', 'Rawstep cannot apply native magnification or an OS contrast environment.');
  if (config.analysis.model && !analysisModel) return fail('analysis-model-invalid', 'The project\'s analysis model must be on an LLM connection.');
  if (mode === 'screenreader' && agent.planner && !plannerModel) return fail('planner-model-invalid', 'The agent\'s planner must be on an LLM connection.');
  if (diagnoseStop && mode !== 'keyboard') return fail('diagnose-keyboard-only', 'Stop diagnosis uses the last screenshot, so it works in keyboard mode only.');
  return { settings, permissions, ...models };
}
/** The check result of a run that must go ahead: throws the problem, otherwise returns the settings. */
export function assertRunnable(check: RunCheck): Omit<RunCheck, 'problem'> {
  if (check.problem) throw check.problem;
  const { problem: _problem, ...ready } = check; return ready;
}
