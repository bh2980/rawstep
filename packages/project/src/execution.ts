import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { runWithPolicy } from '@rawstep/browser/runner';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { FixedPlanner, OrchestratedSpeechPolicy, renderPlanMarkdown, type PlanDraft, type Planner } from '@rawstep/policies/policy';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectError } from './errors.js';
import { atomicJson } from './store.js';
import { LlmPlanner } from '@rawstep/policies/llm';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { usesKeptProfile, type Task } from '@rawstep/core/contracts';
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
  /** Where the kept browser profile lives for a task whose person passes bot checks in a launched browser (`<project>/.rawstep/browser-profile`). */
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
    // The task says what the site needs of the browser; where a Chrome of your own listens is this computer's to say.
    const browser = task.browser ?? { mode: 'launch' as const };
    const endpoint = browser.mode === 'connect' ? machine.browserEndpoint.trim() : '';
    if (browser.mode === 'connect' && !endpoint) throw new ProjectError('browser-endpoint-missing', 'This task runs in a Chrome you started yourself, but this computer has no address for it (machine.browserEndpoint).');
    const common = { policy, outDir, signal, allowedActions: permissions, confirmationGrace: rules.confirmationGrace, ...(onEvent ? { onEvent } : {}), ...(conditions ? { conditions } : {}),
      headless: backend !== 'simulation' ? false : machine.headless,
      browserExecutablePath: machine.browserExecutablePath || undefined,
      ...(endpoint ? { browserEndpoint: endpoint, ...(browser.copySignIn ? { copySignIn: true } : {}) } : machine.proxyServer.trim() ? { proxyServer: machine.proxyServer.trim() } : {}),
      ...(browser.personCheck && endpoint ? { personCheck: {} } : browser.personCheck && browserProfileDir ? { personCheck: { userDataDir: browserProfileDir } } : {}) };
    setupSignal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('The task time limit passed while preparing the run.');
    const resolvedTask = { ...task, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(environment) };
    // One Chrome profile cannot be open twice: runs that keep it take turns, across Rawstep processes too.
    const release = usesKeptProfile(browser) && browserProfileDir ? await lockBrowserProfile(browserProfileDir) : undefined;
    // Runs keep a screenshot per step for people reading the run; the model never sees it.
    try {
      if (backend === 'simulation') return await runMockVoiceOverTask(resolvedTask, { ...common, diagnosticScreenshots: true, warn: () => {} });
      const url = atEndpointOf(machine, backend), driver = await ensureAtDriver({ endpoint: url, command: atDriverCommand, signal: setupSignal });
      try { return await runWithPolicy(resolvedTask, { ...common, diagnosticScreenshots: true, backend: new AtDriverBackend({ profile: backend, url }) }); }
      finally { await driver.stop(); }
    } finally { await savePlan(policy, outDir); await release?.(); }
  }
};
/**
 * Takes the kept browser profile for one run: a lock file next to it names the process holding it. A lock whose process is gone is
 * taken over; one held by a live process stops this run with the reason, instead of Chrome's own failure to open the profile.
 */
export async function lockBrowserProfile(profileDir: string): Promise<() => Promise<void>> {
  const lock = profileDir + '.lock', self = JSON.stringify({ pid: process.pid, host: hostname() });
  await mkdir(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(lock, self, { flag: 'wx' }); return () => rm(lock, { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const holder: { pid?: number; host?: string } = await readFile(lock, "utf8").then(text => JSON.parse(text) as { pid?: number; host?: string }, () => ({}));
    let held = holder.host !== undefined && holder.host !== hostname();
    if (!held && typeof holder.pid === 'number') try { process.kill(holder.pid, 0); held = true; } catch (e) { held = (e as NodeJS.ErrnoException).code === 'EPERM'; }
    if (held) throw new ProjectError('browser-profile-busy', `The kept browser profile (.rawstep/browser-profile) is in use by another run (process ${holder.pid ?? '?'}). Runs whose person passes bot checks in a launched browser use it one at a time; wait for that run or stop it.`, 409);
    await rm(lock, { force: true });
  }
  throw new ProjectError('browser-profile-busy', 'The kept browser profile (.rawstep/browser-profile) could not be locked for this run.', 409);
}
/**
 * The final plan document next to the trace: plan.json for tools, plan.md as a readable checklist. The trace keeps every version
 * as policy evidence; these files are the end state. A failure to write them never changes the run.
 */
async function savePlan(policy: OrchestratedSpeechPolicy, outDir: string): Promise<void> {
  const doc = policy.planDocument();
  if (!doc) return;
  try { await atomicJson(join(outDir, 'plan.json'), doc); await writeFile(join(outDir, 'plan.md'), renderPlanMarkdown(doc)); } catch { /* the trace still holds every plan version */ }
}
