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
import { type Mode, type Model, type Permissions, type Prompt, type RunSettings, atEndpointOf, resolveBaseURL, resolveRepetitionGuard } from './config.js';
import { ensureAtDriver } from './atdriver.js';

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
export type RunExecution = {
  outDir: string; apiKey?: string; signal: AbortSignal; onEvent?: (event: TraceEvent) => void;
  /** The command that starts the AT Driver server on this computer, for native screen reader runs when none is running yet. */
  atDriverCommand?: string | undefined;
  /** Where the kept browser profile lives when the machine setting `personCheck` is on (`<project>/.rawstep/browser-profile`). */
  browserProfileDir?: string | undefined;
};
/** Runs one RunSpec; replaceable so callers can run without a browser or a model. */
export type RunExecutor = (spec: RunSpec, execution: RunExecution) => Promise<RunTrace>;

/** Builds the decision policy for the model's kind and runs the task on the backend the mode and machine settings select. */
export const executeRun: RunExecutor = async ({ task, model, prompt, mode, settings: globals, environment, permissions, diagnoseStop }, { outDir, apiKey, signal, onEvent, atDriverCommand, browserProfileDir }) => {
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
    if (mode === 'keyboard') {
      screenshotModel = new SystemOneScreenshotAdapter(client, prompt);
      policy = new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: limits.focusGate ? {} : undefined, model: screenshotModel });
    } else {
      policy = new SystemOneSpeechPolicy(client, limits.historyLimit, prompt, { modelGiveUp });
    }
  }
  const common = { policy, outDir, signal, allowedActions: permissions, ...(onEvent ? { onEvent } : {}),
    headless: mode === 'screenreader' && globals.backend !== 'simulation' ? false : globals.headless,
    browserExecutablePath: globals.browserExecutablePath || undefined,
    ...(globals.personCheck && browserProfileDir ? { personCheck: { userDataDir: browserProfileDir } } : {}) };
  setupSignal.throwIfAborted();
  if (Date.now() >= deadline) throw new Error('The task time limit passed while preparing the run.');
  const resolvedTask = { ...task, mode, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(environment) };
  if (mode === 'keyboard') return runScreenshotTask(resolvedTask, { ...common, ...(diagnoseStop ? { stopReasonModel: screenshotModel, stopReasonTimeoutMs: Math.min(30000, model.timeoutMs) } : {}) });
  // Screen reader runs keep a screenshot per step for people reading the run; the model never sees it.
  if (globals.backend === 'simulation') return runMockVoiceOverTask(resolvedTask, { ...common, diagnosticScreenshots: true, warn: () => {} });
  const url = atEndpointOf(globals), driver = await ensureAtDriver({ endpoint: url, command: atDriverCommand, signal: setupSignal });
  try { return await runTask(resolvedTask, { ...common, diagnosticScreenshots: true, backend: new AtDriverBackend({ profile: globals.backend, url }) }); }
  finally { await driver.stop(); }
};
