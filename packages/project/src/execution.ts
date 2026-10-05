import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { runTask } from '@rawstep/browser/runner';
import { createHash } from 'node:crypto';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { SystemOneHttpClient, OpenRouterSystemOneClient, VercelEvaluationClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, type SystemOneClient } from '@rawstep/policies/systemone';
import { ScreenshotDecisionPolicy } from '@rawstep/policies/screenshot/policy';
import { validateModelResponse, type ScreenshotModelAdapter } from '@rawstep/policies/screenshot/model';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import type { DecisionPolicy, Task } from '@rawstep/core/contracts';
import type { RunTrace, TraceEvent } from '@rawstep/core/trace';
import { LlmChoiceClient, LlmScreenshotAdapter, LlmSpeechPolicy } from './llm.js';
import { boundedJson } from './discover.js';
import { type Connection, type Mode, type Model, type Permissions, type Prompt, type RunSettings, defaultInstructions, resolveRepetitionGuard } from './config.js';

/** Everything one run needs, resolved from the project: nothing here is looked up again while the run executes. */
export type RunSpec = {
  task: Task; model: Model; connection: Connection; prompt: Prompt; mode: Mode;
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

/** Builds the decision policy for the model's protocol and runs the task on the backend the mode and machine settings select. */
export const executeRun: RunExecutor = async ({ task, model, connection, prompt, mode, settings: globals, environment, permissions, diagnoseStop }, { outDir, apiKey, signal, onEvent }) => {
  const deadline = Date.now() + (task.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs);
  const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
  const { repetitionGuard: guardSetting, modelGiveUp, ...limits } = globals.policy;
  const early = { repetitionGuard: resolveRepetitionGuard(guardSetting, model), modelGiveUp };
  let policy: DecisionPolicy;
  let screenshotModel: ScreenshotModelAdapter | undefined;
  if (model.protocol === 'chat') {
    const client = new LlmChoiceClient(connection, model, prompt, apiKey);
    screenshotModel = new LlmScreenshotAdapter(client);
    policy = mode === 'keyboard' ? new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: undefined, model: screenshotModel }) : new LlmSpeechPolicy(client, limits.historyLimit, { modelGiveUp });
  } else if (model.protocol === 'choose') {
    const fetchChoice = async (request: object, inner: AbortSignal) => {
      const value = await boundedJson(await fetch(connection.baseURL.replace(/\/$/, '') + '/choose', {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([inner, AbortSignal.timeout(connection.timeoutMs)]),
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}) },
        body: JSON.stringify(request),
      }));
      if (apiKey && JSON.stringify(value).includes(apiKey)) throw new Error('The model response contained the credential.');
      return value;
    };
    let adapter: ScreenshotModelAdapter = { choose: async (request, {signal: inner}) => {
      const response = await fetchChoice(request, inner); validateModelResponse(response, request.choices); return response;
    } };
    if (model.promptEditable) {
      adapter = { choose: async (request, { signal: inner }) => {
        const response = await fetchChoice({ ...request, promptControl: 'client-v1', instructions: prompt.instructions, prompt: { id: prompt.id, version: prompt.version } }, inner);
        validateModelResponse(response, request.choices);
        if (response.model.id !== model.modelId) throw new Error('The local server changed its model ID.');
        const hash = createHash('sha256').update(JSON.stringify({ instructions: prompt.instructions, choices: request.choices.map(c => ({ id: c.id, label: c.label })) })).digest('hex');
        if (response.prompt?.id !== prompt.id || response.prompt.version !== prompt.version || response.prompt.sha256 !== hash) throw new Error('The server did not return proof that it applied the requested prompt.');
        return response;
      } };
    } else {
      if (prompt.instructions !== defaultInstructions.keyboard) throw new Error('This /choose server does not support changing the prompt.');
      const original = adapter;
      adapter = { choose: async (r, o) => { const answer = await original.choose(r, o); if (answer.model.id !== model.modelId) throw new Error('The local server changed its model ID.'); return answer; } };
    }
    screenshotModel = adapter;
    policy = new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: limits.focusGate ? {} : undefined, model: adapter });
  } else {
    const opts = { baseURL: connection.baseURL, model: model.modelId, apiKey, timeoutMs: connection.timeoutMs };
    const capabilities = { inputs: model.inputs, maxChoices: model.maxChoices, maxImages: model.maxImages };
    const client: SystemOneClient = model.protocol === 'openrouter-decisions' ? new OpenRouterSystemOneClient({ ...opts, capabilities })
      : model.protocol === 'vercel-evaluation' ? new VercelEvaluationClient(opts) : new SystemOneHttpClient({ ...opts, capabilities });
    await client.prepare?.({ signal: setupSignal });
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
  return mode === 'keyboard' ? runScreenshotTask(resolvedTask, { ...common, ...(diagnoseStop ? { stopReasonModel: screenshotModel, stopReasonTimeoutMs: Math.min(30000, connection.timeoutMs) } : {}) }) : globals.backend === 'simulation'
    ? runMockVoiceOverTask(resolvedTask, { ...common, warn: () => {} })
    : runTask(resolvedTask, { ...common, backend: new AtDriverBackend({ profile: globals.backend, url: globals.atEndpoint }) });
};
