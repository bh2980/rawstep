import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { runTask } from '@rawstep/browser/runner';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { DecisionClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, type DecisionProviderName } from '@rawstep/policies/systemone';
import { ScreenshotDecisionPolicy } from '@rawstep/policies/screenshot/policy';
import type { ScreenshotModelAdapter } from '@rawstep/policies/screenshot/model';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import type { DecisionPolicy, Task } from '@rawstep/core/contracts';
import type { RunTrace, TraceEvent } from '@rawstep/core/trace';
import { LlmChoiceClient, LlmScreenshotAdapter, LlmSpeechPolicy } from './llm.js';
import { type Mode, type Model, type Permissions, type Prompt, type RunSettings, resolveBaseURL, resolveRepetitionGuard } from './config.js';

/** Everything one run needs, resolved from the project: nothing here is looked up again while the run executes. */
export type RunSpec = {
  task: Task; model: Model; prompt: Prompt; mode: Mode;
  /** Run profile policy and machine settings in force for this run. */
  settings: RunSettings;
  /** The page environment: a profile name or object, resolved by @rawstep/browser/profiles. */
  environment: unknown;
  permissions: Permissions;
  /** Ask the model, after a keyboard run that stopped early, why (never an action or verdict). */
  diagnoseStop?: boolean;
};
export type RunExecution = { outDir: string; apiKey?: string; signal: AbortSignal; onEvent?: (event: TraceEvent) => void };
/** Runs one RunSpec; replaceable so callers can run without a browser or a model. */
export type RunExecutor = (spec: RunSpec, execution: RunExecution) => Promise<RunTrace>;

/** Builds the decision policy for the model's kind and runs the task on the backend the mode and machine settings select. */
export const executeRun: RunExecutor = async ({ task, model, prompt, mode, settings: globals, environment, permissions, diagnoseStop }, { outDir, apiKey, signal, onEvent }) => {
  const deadline = Date.now() + (task.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs);
  const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
  const { repetitionGuard: guardSetting, modelGiveUp, ...limits } = globals.policy;
  const early = { repetitionGuard: resolveRepetitionGuard(guardSetting, model), modelGiveUp };
  let policy: DecisionPolicy;
  let screenshotModel: ScreenshotModelAdapter | undefined;
  if (model.kind === 'llm') {
    const client = new LlmChoiceClient(model, prompt, apiKey);
    screenshotModel = new LlmScreenshotAdapter(client);
    policy = mode === 'keyboard' ? new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: undefined, model: screenshotModel }) : new LlmSpeechPolicy(client, limits.historyLimit, { modelGiveUp });
  } else {
    const client = new DecisionClient({ provider: model.provider as DecisionProviderName, baseURL: resolveBaseURL(model), modelId: model.modelId, apiKey, timeoutMs: model.timeoutMs,
      capabilities: { inputs: model.inputs, maxChoices: model.maxChoices, maxImages: model.maxImages } });
    await client.prepare({ signal: setupSignal });
    screenshotModel = new SystemOneScreenshotAdapter(client, prompt);
    policy = mode === 'keyboard' ? new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: limits.focusGate ? {} : undefined, model: screenshotModel })
      : new SystemOneSpeechPolicy(client, limits.historyLimit, prompt, { modelGiveUp });
  }
  const common = { policy, outDir, signal, allowedActions: permissions, ...(onEvent ? { onEvent } : {}),
    headless: mode === 'screenreader' && globals.backend !== 'simulation' ? false : globals.headless,
    browserExecutablePath: globals.browserExecutablePath || undefined };
  setupSignal.throwIfAborted();
  if (Date.now() >= deadline) throw new Error('The task time limit passed while preparing the run.');
  const resolvedTask = { ...task, mode, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(environment) };
  return mode === 'keyboard' ? runScreenshotTask(resolvedTask, { ...common, ...(diagnoseStop ? { stopReasonModel: screenshotModel, stopReasonTimeoutMs: Math.min(30000, model.timeoutMs) } : {}) }) : globals.backend === 'simulation'
    ? runMockVoiceOverTask(resolvedTask, { ...common, warn: () => {} })
    : runTask(resolvedTask, { ...common, backend: new AtDriverBackend({ profile: globals.backend, url: globals.atEndpoint }) });
};
