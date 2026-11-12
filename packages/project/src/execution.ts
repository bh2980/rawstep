import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { runWithPolicy } from '@rawstep/browser/runner';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { FixedPlanner, OrchestratedSpeechPolicy, renderPlanMarkdown, type PlanDraft, type Planner } from '@rawstep/policies/policy';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectError } from './errors.js';
import { atomicJson } from './store.js';
import { LlmPlanner } from '@rawstep/policies/llm';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { usesKeptProfile, type Task } from '@rawstep/core/contracts';
import type { RunTrace, TraceEvent } from '@rawstep/core/trace';
import { closeLlmModel, llmModelOf, prepareLlmModel } from './llm.js';
import { type AtBackend, type Model, type Permissions, type RunSettings, atEndpointOf, browserOpenOf } from './config.js';
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
  /** Who plans: every run has exactly one planner. */
  planner: RunPlanner;
};
/** A plan written beforehand, as read from its file (see `loadPlanFile`): its content and fingerprint, so a run records exactly the plan it ran with. */
export type PlanFile = { file: string; draft: PlanDraft; sha256: string };
/**
 * A run's planner, one or the other: the LLM that writes the plan document Rawstep carries out (with its added instructions), or a
 * plan file read beforehand. A spec cannot be without one, or with both.
 */
export type RunPlanner = { model: Model; instructions: string; plan?: undefined } | { plan: PlanFile; model?: undefined; instructions?: undefined };
export type RunExecution = {
  outDir: string; signal: AbortSignal; onEvent?: (event: TraceEvent) => void;
  /** The planner model's key, when `RunSpec.planner` is a model that needs one. */
  plannerApiKey?: string | undefined;
  /** The command that starts the AT Driver server on this computer, for native screen reader runs when none is running yet. */
  atDriverCommand?: string | undefined;
  /** Where the kept browser profile lives for a task whose person passes bot checks in a launched browser (`<project>/.rawstep/browser-profile`). */
  browserProfileDir?: string | undefined;
  /** Where the lock of this computer's native screen reader is kept; `~/.rawstep` when not given (tests give their own folder). */
  screenReaderLockDir?: string | undefined;
};
/** Runs one RunSpec; replaceable so callers can run without a browser or a model. */
export type RunExecutor = (spec: RunSpec, execution: RunExecution) => Promise<RunTrace>;

/** Builds the plan policy and runs the task on the backend the profile and machine settings select. */
export const executeRun: RunExecutor = async ({ task, settings, environment, backend, permissions, conditions, planner: plannedBy }, { outDir, plannerApiKey, signal, onEvent, atDriverCommand, browserProfileDir, screenReaderLockDir }) => {
  const plannerLlm = plannedBy.model ? llmModelOf(plannedBy.model, 'rawstep-planner', plannerApiKey) : undefined;
  // Agent CLIs start before the task's clock (an adapter download is not the task) and end with the run.
  try {
    if (plannerLlm) await prepareLlmModel(plannerLlm, plannedBy.model!.name, signal);
    return await runWith(plannerLlm ? new LlmPlanner(plannerLlm, plannedBy.instructions) : new FixedPlanner(plannedBy.plan!.draft, { file: plannedBy.plan!.file, sha256: plannedBy.plan!.sha256 }));
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
    const opened = browserOpenOf(machine, browser.mode === 'connect'), endpoint = 'cdpEndpoint' in opened ? opened.cdpEndpoint : '';
    if (browser.mode === 'connect' && !endpoint) throw new ProjectError('browser-endpoint-missing', 'This task runs in a Chrome you started yourself, but this computer has no address for it (machine.browserEndpoint).');
    const common = { policy, outDir, signal, allowedActions: permissions, confirmationGrace: rules.confirmationGrace, silentPressWaitMs: RAWSTEP_DEFAULTS.silentPressWaitMs, ...(onEvent ? { onEvent } : {}), ...(conditions ? { conditions } : {}),
      headless: backend !== 'simulation' ? false : machine.headless,
      ...('cdpEndpoint' in opened ? { browserEndpoint: opened.cdpEndpoint, ...(browser.copySignIn ? { copySignIn: true } : {}) }
        : { browserExecutablePath: opened.executablePath, ...(opened.proxyServer ? { proxyServer: opened.proxyServer } : {}) }),
      ...(browser.personCheck && endpoint ? { personCheck: {} } : browser.personCheck && browserProfileDir ? { personCheck: { userDataDir: browserProfileDir } } : {}) };
    setupSignal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('The task time limit passed while preparing the run.');
    const resolvedTask = { ...task, timeoutMs: Math.max(1, deadline - Date.now()), profile: resolveEnvironmentProfile(environment) };
    // One Chrome profile cannot be open twice: runs that keep it take turns, across Rawstep processes too.
    const release = usesKeptProfile(browser) && browserProfileDir ? await lockBrowserProfile(browserProfileDir) : undefined;
    // Runs keep a screenshot per step for people reading the run; the model never sees it.
    let releaseReader: (() => Promise<void>) | undefined;
    try {
      if (backend === 'simulation') return await runMockVoiceOverTask(resolvedTask, { ...common, diagnosticScreenshots: true, warn: () => {} });
      // One desktop has one screen reader: native runs take turns across Rawstep processes too. Held around the AT Driver server as
      // well, so the run that started the server never stops it under another run.
      releaseReader = await lockScreenReader(screenReaderLockDir);
      const url = atEndpointOf(machine, backend), driver = await ensureAtDriver({ endpoint: url, command: atDriverCommand, signal: setupSignal });
      try { return await runWithPolicy(resolvedTask, { ...common, diagnosticScreenshots: true, backend: new AtDriverBackend({ profile: backend, url }) }); }
      finally { await driver.stop(); }
    } finally { await savePlan(policy, outDir); await releaseReader?.(); await release?.(); }
  }
};
/**
 * Takes something only one run can have, for one run: a lock file names the process holding it. A lock whose process is gone is
 * taken over; one held by a live process stops this run with `busy`'s reason. Returns what releases it.
 */
async function lockFile(lock: string, busy: (holder: string) => ProjectError): Promise<() => Promise<void>> {
  const self = JSON.stringify({ pid: process.pid, host: hostname() });
  await mkdir(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(lock, self, { flag: 'wx' }); return () => rm(lock, { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const holder: { pid?: number; host?: string } = await readFile(lock, "utf8").then(text => JSON.parse(text) as { pid?: number; host?: string }, () => ({}));
    let held = holder.host !== undefined && holder.host !== hostname();
    if (!held && typeof holder.pid === 'number') try { process.kill(holder.pid, 0); held = true; } catch (e) { held = (e as NodeJS.ErrnoException).code === 'EPERM'; }
    if (held) throw busy(`process ${holder.pid ?? '?'}`);
    await rm(lock, { force: true });
  }
  throw busy('another process');
}
/**
 * Takes the kept browser profile for one run, so a second run stops with the reason instead of Chrome's own failure to open the
 * profile.
 */
export function lockBrowserProfile(profileDir: string): Promise<() => Promise<void>> {
  return lockFile(profileDir + '.lock', holder => new ProjectError('browser-profile-busy', `The kept browser profile (.rawstep/browser-profile) is in use by another run (${holder}). Runs whose person passes bot checks in a launched browser use it one at a time; wait for that run or stop it.`, 409));
}
/**
 * Takes this computer's native screen reader for one run. A screen reader speaks on one desktop and takes its keys from it, so two
 * runs at once would press into each other's page and hear each other's speech: this is per computer and user, not per project.
 */
export function lockScreenReader(dir = join(homedir(), '.rawstep')): Promise<() => Promise<void>> {
  return lockFile(join(dir, 'native-screen-reader.lock'), holder => new ProjectError('screen-reader-busy', `This computer's screen reader is in use by another Rawstep run (${holder}). Native screen reader runs go one at a time; wait for that run or stop it.`, 409));
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
