import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { runTask } from '@rawstep/browser/runner';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { DecisionClient, SystemOneChoiceModel, SystemOneScreenshotAdapter, type DecisionProviderName } from '@rawstep/policies/systemone';
import { FixedPlanner, OrchestratedSpeechPolicy, orchestratedPrompt, renderPlanMarkdown, SpeechDecisionPolicy, type ChoiceModel, type PlanDraft, type Planner } from '@rawstep/policies/policy';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from './store.js';
import { LlmPlanner } from '@rawstep/policies/llm';
import { ScreenshotDecisionPolicy } from '@rawstep/policies/screenshot/policy';
import type { ScreenshotModelAdapter } from '@rawstep/policies/screenshot/model';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import type { DecisionPolicy, Task } from '@rawstep/core/contracts';
import type { RunTrace, TraceEvent } from '@rawstep/core/trace';
import { closeLlmModel, llmChoiceModel, llmModelOf, LlmScreenshotAdapter, prepareLlmModel } from './llm.js';
import { type AtBackend, type Executor, type Mode, type Model, type Permissions, type Prompt, type RunSettings, atEndpointOf, isPlanFollower, resolveBaseURL, resolveRepetitionGuard } from './config.js';
import { ensureAtDriver } from './atdriver.js';

/** Everything one run needs, resolved from the project: nothing here is looked up again while the run executes. */
export type RunSpec = {
  task: Task; mode: Mode;
  /** The executor for the mode, its instructions and how it reads the run. */
  model: Model; prompt: Prompt; executor: Pick<Executor, 'historyLimit' | 'focusGate' | 'latitude'>;
  /** This computer's settings, the run rules and the analysis instructions in force for this run. */
  settings: RunSettings;
  /** The page environment: a profile name or object, resolved by @rawstep/browser/profiles. */
  environment: unknown;
  /** Screen reader runs: the simulation or a native screen reader. */
  backend: AtBackend;
  /** The action set's actions for the mode. */
  permissions: Permissions;
  /** The conditions as recorded in the trace at `run.started`. */
  conditions?: Record<string, unknown>;
  /** Ask the model, after a keyboard run that stopped early, why (never an action or verdict). */
  diagnoseStop?: boolean;
  /** Screen reader runs of a planned combo: the LLM that writes the plan document for `model` to carry out, and its added instructions. */
  plannerModel?: Model; plannerInstructions?: string;
  /** Instead of a planner model: a plan written beforehand, as read from its file (see `loadPlanFile`). */
  plannerPlan?: { file: string; draft: PlanDraft; sha256: string };
};
export type RunExecution = {
  outDir: string; apiKey?: string; signal: AbortSignal; onEvent?: (event: TraceEvent) => void;
  /** The planner model's key, when `RunSpec.plannerModel` needs one. */
  plannerApiKey?: string | undefined;
  /** The command that starts the AT Driver server on this computer, for native screen reader runs when none is running yet. */
  atDriverCommand?: string | undefined;
  /** Where the kept browser profile lives when the machine setting `personCheck` is on (`<project>/.rawstep/browser-profile`). */
  browserProfileDir?: string | undefined;
};
/** Runs one RunSpec; replaceable so callers can run without a browser or a model. */
export type RunExecutor = (spec: RunSpec, execution: RunExecution) => Promise<RunTrace>;

/** Builds the decision policy for the model's kind and runs the task on the backend the mode and machine settings select. */
export const executeRun: RunExecutor = async ({ task, model, prompt, executor, mode, settings, environment, backend, permissions, conditions, diagnoseStop, plannerModel, plannerInstructions, plannerPlan }, { outDir, apiKey, plannerApiKey, signal, onEvent, atDriverCommand, browserProfileDir }) => {
  // With a planner the decision model carries out one small step at a time and asks for a new plan when stuck.
  const plannerLlm = mode === 'screenreader' && plannerModel ? llmModelOf(plannerModel, 'rawstep-planner', plannerApiKey) : undefined;
  const fixedPlan = mode === 'screenreader' && plannerPlan ? plannerPlan : undefined;
  const chooser = model.kind === 'llm' ? llmChoiceModel(model, plannerLlm || fixedPlan ? orchestratedPrompt(prompt, settings.runRules.taskControl) : prompt, apiKey) : undefined;
  // Agent CLIs start before the task's clock (an adapter download is not the task) and end with the run.
  try {
    if (plannerLlm) await prepareLlmModel(plannerLlm, plannerModel!.name, signal);
    if (chooser) await prepareLlmModel(chooser.llm, model.name, signal);
    return await runWith(plannerLlm ? new LlmPlanner(plannerLlm, plannerInstructions, executor.latitude) : fixedPlan ? new FixedPlanner(fixedPlan.draft, { file: fixedPlan.file, sha256: fixedPlan.sha256 }) : undefined);
  } finally {
    await Promise.all([plannerLlm && closeLlmModel(plannerLlm), chooser && closeLlmModel(chooser.llm)]);
  }

  async function runWith(planner: Planner | undefined): Promise<RunTrace> {
    const deadline = Date.now() + (task.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs);
    const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
    const { machine, runRules: rules } = settings;
    const early = { repetitionGuard: resolveRepetitionGuard(rules.repetitionGuard, model, mode), modelGiveUp: rules.modelGiveUp };
    const limits = { maxStateVisits: rules.maxStateVisits, maxUnchangedTransitions: rules.maxUnchangedTransitions, historyLimit: executor.historyLimit };
    const speechOptions = { ...early, maxUnchangedTransitions: rules.maxUnchangedTransitions, historyLimit: executor.historyLimit };
    const speechPolicy = (choice: ChoiceModel | 'follow-plan'): DecisionPolicy => planner
      ? new OrchestratedSpeechPolicy(planner, choice, { ...speechOptions, maxReplans: rules.maxReplans, stepActionLimit: rules.stepActionLimit, failureLimit: rules.failureLimit, noChangeLimit: rules.noChangeLimit,
        taskControl: rules.taskControl, confidenceFloor: rules.confidenceFloor, survey: rules.survey, executorLatitude: executor.latitude })
      : choice === 'follow-plan' ? (() => { throw new Error('Following the plan needs a plan.'); })() : new SpeechDecisionPolicy(choice, speechOptions);
    let policy: DecisionPolicy;
    let screenshotModel: ScreenshotModelAdapter | undefined;
    // A combo that follows its plan has no executor model: Rawstep carries out the plan's tasks itself.
    if (isPlanFollower(model)) {
      if (mode !== 'screenreader' || !planner) throw new Error('Following the plan works in planned screen reader runs only.');
      policy = speechPolicy('follow-plan');
    } else if (chooser) {
      screenshotModel = new LlmScreenshotAdapter(chooser);
      policy = mode === 'keyboard' ? new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: undefined, model: screenshotModel }) : speechPolicy(chooser);
    } else {
      const client = new DecisionClient({ provider: model.provider as DecisionProviderName, baseURL: resolveBaseURL(model), modelId: model.modelId, apiKey, timeoutMs: model.timeoutMs,
        capabilities: { inputs: model.inputs, maxChoices: model.maxChoices, maxImages: model.maxImages } });
      await client.prepare({ signal: setupSignal });
      if (mode === 'keyboard') {
        screenshotModel = new SystemOneScreenshotAdapter(client, prompt);
        policy = new ScreenshotDecisionPolicy({ ...limits, ...early, focusGate: executor.focusGate ? {} : undefined, model: screenshotModel });
      } else {
        policy = speechPolicy(new SystemOneChoiceModel(client, planner ? orchestratedPrompt(prompt, rules.taskControl) : prompt));
      }
    }
    const endpoint = machine.browserEndpoint.trim();
    const common = { policy, outDir, signal, allowedActions: permissions, confirmationGrace: rules.confirmationGrace, ...(onEvent ? { onEvent } : {}), ...(conditions ? { conditions } : {}),
      headless: mode === 'screenreader' && backend !== 'simulation' ? false : machine.headless,
      browserExecutablePath: machine.browserExecutablePath || undefined,
      ...(endpoint ? { browserEndpoint: endpoint } : {}),
      ...(machine.personCheck && endpoint ? { personCheck: {} } : machine.personCheck && browserProfileDir ? { personCheck: { userDataDir: browserProfileDir } } : {}) };
    setupSignal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('The task time limit passed while preparing the run.');
    const resolvedTask = { ...task, mode, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(environment) };
    if (mode === 'keyboard') return await runScreenshotTask(resolvedTask, { ...common, ...(diagnoseStop ? { stopReasonModel: screenshotModel, stopReasonTimeoutMs: Math.min(30000, model.timeoutMs) } : {}) });
    // Screen reader runs keep a screenshot per step for people reading the run; the model never sees it.
    try {
      if (backend === 'simulation') return await runMockVoiceOverTask(resolvedTask, { ...common, diagnosticScreenshots: true, warn: () => {} });
      const url = atEndpointOf(machine, backend), driver = await ensureAtDriver({ endpoint: url, command: atDriverCommand, signal: setupSignal });
      try { return await runTask(resolvedTask, { ...common, diagnosticScreenshots: true, backend: new AtDriverBackend({ profile: backend, url }) }); }
      finally { await driver.stop(); }
    } finally { if (policy instanceof OrchestratedSpeechPolicy) await savePlan(policy, outDir); }
  }
};
/**
 * The final plan document next to the trace: plan.json for tools, plan.md as a readable checklist. The trace keeps every version
 * as policy evidence; these files are the end state. A failure to write them never changes the run.
 */
async function savePlan(policy: OrchestratedSpeechPolicy, outDir: string): Promise<void> {
  const doc = policy.planDocument();
  if (!doc) return;
  try { await atomicJson(join(outDir, 'plan.json'), doc); await writeFile(join(outDir, 'plan.md'), renderPlanMarkdown(doc)); } catch { /* the trace still holds every plan version */ }
}
