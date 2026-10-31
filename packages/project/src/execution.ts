import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { runTask } from '@rawstep/browser/runner';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { FixedPlanner, OrchestratedSpeechPolicy, renderPlanMarkdown, type PlanDraft, type Planner } from '@rawstep/policies/policy';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from './store.js';
import { LlmPlanner } from '@rawstep/policies/llm';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import type { Task } from '@rawstep/core/contracts';
import type { RunTrace, TraceEvent } from '@rawstep/core/trace';
import { closeLlmModel, llmModelOf, prepareLlmModel } from './llm.js';
import { type AtBackend, type Model, type Permissions, type RunSettings, atEndpointOf } from './config.js';
import { ensureAtDriver } from './atdriver.js';

/** Everything one run needs, resolved from the project: nothing here is looked up again while the run executes. */
export type RunSpec = {
  task: Task;
  /** This computer's settings, the run rules and the analysis instructions in force for this run. */
  settings: RunSettings;
  /** The page environment: a profile name or object, resolved by @rawstep/browser/profiles. */
  environment: unknown;
  /** The simulation or a native screen reader. */
  backend: AtBackend;
  /** The action set's actions. */
  permissions: Permissions;
  /** The conditions as recorded in the trace at `run.started`. */
  conditions?: Record<string, unknown>;
  /** The LLM that writes the plan document Rawstep carries out, and its added instructions. */
  plannerModel?: Model; plannerInstructions?: string;
  /** Instead of a planner model: a plan written beforehand, as read from its file (see `loadPlanFile`). */
  plannerPlan?: { file: string; draft: PlanDraft; sha256: string };
};
export type RunExecution = {
  outDir: string; signal: AbortSignal; onEvent?: (event: TraceEvent) => void;
  /** The planner model's key, when `RunSpec.plannerModel` needs one. */
  plannerApiKey?: string | undefined;
  /** The command that starts the AT Driver server on this computer, for native screen reader runs when none is running yet. */
  atDriverCommand?: string | undefined;
  /** Where the kept browser profile lives when the machine setting `personCheck` is on (`<project>/.rawstep/browser-profile`). */
  browserProfileDir?: string | undefined;
};
/** Runs one RunSpec; replaceable so callers can run without a browser or a model. */
export type RunExecutor = (spec: RunSpec, execution: RunExecution) => Promise<RunTrace>;

/** Builds the plan policy and runs the task on the backend the profile and machine settings select. */
export const executeRun: RunExecutor = async ({ task, settings, environment, backend, permissions, conditions, plannerModel, plannerInstructions, plannerPlan }, { outDir, plannerApiKey, signal, onEvent, atDriverCommand, browserProfileDir }) => {
  const plannerLlm = plannerModel ? llmModelOf(plannerModel, 'rawstep-planner', plannerApiKey) : undefined;
  // Agent CLIs start before the task's clock (an adapter download is not the task) and end with the run.
  try {
    if (plannerLlm) await prepareLlmModel(plannerLlm, plannerModel!.name, signal);
    const planner = plannerLlm ? new LlmPlanner(plannerLlm, plannerInstructions) : plannerPlan ? new FixedPlanner(plannerPlan.draft, { file: plannerPlan.file, sha256: plannerPlan.sha256 }) : undefined;
    if (!planner) throw new Error('A run needs a plan: a planner model or a plan file.');
    return await runWith(planner);
  } finally {
    if (plannerLlm) await closeLlmModel(plannerLlm);
  }

  async function runWith(planner: Planner): Promise<RunTrace> {
    const deadline = Date.now() + (task.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs);
    const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]);
    const { machine, runRules: rules } = settings;
    const policy = new OrchestratedSpeechPolicy(planner, { repetitionGuard: rules.repetitionGuard, maxUnchangedTransitions: rules.maxUnchangedTransitions,
      maxPlannerCalls: rules.maxPlannerCalls, reviewEvery: rules.reviewEvery, stepActionLimit: rules.stepActionLimit, failureLimit: rules.failureLimit, noChangeLimit: rules.noChangeLimit,
      plannerHistoryLimit: rules.plannerHistoryLimit, survey: rules.survey });
    const endpoint = machine.browserEndpoint.trim();
    const common = { policy, outDir, signal, allowedActions: permissions, confirmationGrace: rules.confirmationGrace, ...(onEvent ? { onEvent } : {}), ...(conditions ? { conditions } : {}),
      headless: backend !== 'simulation' ? false : machine.headless,
      browserExecutablePath: machine.browserExecutablePath || undefined,
      ...(endpoint ? { browserEndpoint: endpoint } : {}),
      ...(machine.personCheck && endpoint ? { personCheck: {} } : machine.personCheck && browserProfileDir ? { personCheck: { userDataDir: browserProfileDir } } : {}) };
    setupSignal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('The task time limit passed while preparing the run.');
    const resolvedTask = { ...task, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(environment) };
    // Runs keep a screenshot per step for people reading the run; the model never sees it.
    try {
      if (backend === 'simulation') return await runMockVoiceOverTask(resolvedTask, { ...common, diagnosticScreenshots: true, warn: () => {} });
      const url = atEndpointOf(machine, backend), driver = await ensureAtDriver({ endpoint: url, command: atDriverCommand, signal: setupSignal });
      try { return await runTask(resolvedTask, { ...common, diagnosticScreenshots: true, backend: new AtDriverBackend({ profile: backend, url }) }); }
      finally { await driver.stop(); }
    } finally { await savePlan(policy, outDir); }
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
