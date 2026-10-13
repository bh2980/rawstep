import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { resolveTask } from '@rawstep/core/contracts';
import { hydrateScreenshots, type RunOutcome, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { analyzeTrace, writeReport, LlmTraceAnalyzer, type TraceAnalyzer } from '@rawstep/reports';
import { aggregateHints, extractHints, selectReference, writeHints, type HintFinding, type HintReport } from '@rawstep/reports/hints';
import { AT_DRIVER_COMMAND_ENV, findByIdOrName, modelKeyEnv, modelKeyRequired, profileConditions, projectAnalysisModel, firstProfile, type Mode, type Model, type ProjectConfig, type RunRules } from './config.js';
import { ProjectError } from './errors.js';
import { llmModelOf } from './llm.js';
import { ProjectStore, atomicJson } from './store.js';
import { assertRunnable, checkRun, loadPlanFile, runSpecOf } from './plan.js';
import { executeRun, type RunExecutor, type RunSpec } from './execution.js';

export type FinalizeOptions = {
  /** A run directory to compare the hints with (the fastest goal-reaching run of the task). */
  referenceDir?: string;
  /** Builds the analyzer; called inside the guarded block, so a failure leaves the run's results intact. Without one, analysis is the local deterministic summary. */
  createAnalyzer?: () => Promise<TraceAnalyzer | undefined>;
};
export type FinalizeResult = {
  hints?: HintReport;
  analysis: { status: 'complete' | 'failed'; error?: string; threw: boolean };
  report: { status: 'complete' | 'failed' };
};
/**
 * Writes the files that follow a finished run next to its trace: hints.json, analysis.json and report.html.
 * Nothing here can change the recorded outcome, and a failure in one step never stops the others.
 */
export async function finalizeRun(trace: RunTrace, outDir: string, options: FinalizeOptions = {}): Promise<FinalizeResult> {
  const hints = await writeHints(outDir, options.referenceDir ? { reference: options.referenceDir } : {}).then(({ report }) => report, () => undefined);
  const withHints = hints ? { hints } : {};
  try {
    const analysis = await analyzeTrace(trace, await options.createAnalyzer?.());
    await atomicJson(join(outDir, 'analysis.json'), analysis);
    await writeReport(await hydrateScreenshots(trace, outDir), analysis, outDir, withHints);
    return { ...(hints ? { hints } : {}), analysis: { status: analysis.status === 'failed' ? 'failed' : 'complete', ...(analysis.status === 'failed' ? { error: analysis.error ?? 'Analysis failed.' } : {}), threw: false }, report: { status: 'complete' } };
  } catch {
    try { await writeReport(await hydrateScreenshots(trace, outDir), undefined, outDir, withHints); return { ...(hints ? { hints } : {}), analysis: { status: 'failed', threw: true }, report: { status: 'complete' } }; }
    catch { return { ...(hints ? { hints } : {}), analysis: { status: 'failed', threw: true }, report: { status: 'failed' } }; }
  }
}

export type RunTaskOptions = {
  /** The directory holding rawstep.config.json. Defaults to the current directory. */
  projectDir?: string;
  /** The run profile by id or name; defaults to the task's, then the project's first. */
  profile?: string;
  /** Run rules for these runs only, over the profile's. */
  runRules?: Partial<RunRules>;
  /** Keyboard runs: ask the executor, after a run that stopped early, why (never an action or verdict). */
  diagnoseStop?: boolean;
  /** Defaults to 'keyboard'. */
  mode?: Mode;
  /** How many times to run the task (default 1). The runs are compared with each other. */
  repeat?: number;
  /** Where to write the runs, one `run-<n>` directory per repeat; a relative path resolves from the current directory. Defaults to `<projectDir>/.rawstep/runs/<timestamp>-<id>/`. */
  outDir?: string;
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
};
export type RunTaskResult = {
  /** The conditions the runs were made with, as recorded in each trace. */
  conditions: Record<string, unknown>;
  /** Things worth knowing that did not stop the runs (no analysis key, a planner unused in keyboard mode). */
  warnings: string[];
  runs: { runId: string; outDir: string; outcome: RunOutcome | undefined; hints: HintReport }[];
  /** Hints gathered across all runs by kind and page element. */
  findings: HintFinding[];
};
const MAX_REPEAT = 100;

/** A task id from rawstep.config.json, or a path to a task JSON file (relative paths resolve from the project directory). */
async function loadTask(store: ProjectStore, config: ProjectConfig, reference: string, projectDir: string) {
  const path = resolve(projectDir, reference);
  const entry = config.tasks.find(t => t.id === reference) ?? config.tasks.find(t => resolve(projectDir, t.file) === path);
  if (entry) return { entry, task: await store.task(entry.file) };
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const known = config.tasks.map(t => t.id).join(', ');
    throw new ProjectError('task-not-found', `"${reference}" is not a task id in rawstep.config.json and there is no task file at ${path}.${known ? ` Known tasks: ${known}.` : ''}`, 404);
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch (e) { throw new ProjectError('invalid-task', `${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  return { entry: undefined, task: resolveTask(json, dirname(path)) };
}

function pick<T extends { id: string; name: string }>(kind: string, list: readonly T[], reference: string): T {
  const found = findByIdOrName(list, reference);
  if (!found) throw new ProjectError(`${kind}-not-found`, `No ${kind} "${reference}" in rawstep.config.json.${list.length ? ` Available: ${list.map(i => `${i.name} (${i.id})`).join(', ')}.` : ''}`, 404);
  return found;
}

/**
 * Runs a task from the project in `projectDir` and reports where the runs got slow or took detours. `task` is a task id
 * from rawstep.config.json or a path to a task JSON file; a file that is not registered runs with the project's first profile.
 * Reaching the goal is one signal in the hints, not a verdict, so a run that fails its goal still resolves.
 * It rejects on setup problems (no config, no usable model, a missing key) and on cancellation.
 *
 * `internals.execute` replaces the real browser and model run; it exists for tests.
 */
export async function runTask(task: string, options: RunTaskOptions = {}, internals: { execute?: RunExecutor } = {}): Promise<RunTaskResult> {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const repeat = options.repeat ?? 1;
  if (options.mode !== undefined && options.mode !== 'keyboard' && options.mode !== 'screenreader') throw new ProjectError('invalid-mode', `The mode must be keyboard or screenreader, not "${String(options.mode)}".`);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) throw new ProjectError('invalid-repeat', `The repeat count must be an integer from 1 to ${MAX_REPEAT}.`);
  const store = new ProjectStore(projectDir), { config } = await store.read();
  const { entry, task: source } = await loadTask(store, config, task, projectDir);
  const profile = options.profile !== undefined ? pick('profile', config.profiles, options.profile) : firstProfile(config);
  // The profile says how the user reaches the page; --mode overrides it for this run.
  const mode = options.mode ?? profile.mode;
  const conditions = profileConditions(profile, mode);
  const check = assertRunnable(checkRun({ config, task: source, ...(entry ? { taskEntry: entry } : {}), runRules: options.runRules, mode, ...conditions, ...(options.diagnoseStop ? { diagnoseStop: true } : {}) }));
  const { settings, model, analysisModel, plannerModel } = check, warnings = [...check.warnings];
  const apiKey = await requireKey(store, model!);
  const plannerApiKey = plannerModel ? await requireKey(store, plannerModel) : undefined;
  // Analysis never blocks a run: without its key the runs get the rule-based analysis only.
  const analysisKey = analysisModel ? await store.credential(analysisModel) : undefined;
  const analyse = analysisModel && (analysisKey || !modelKeyRequired(analysisModel)) ? analysisModel : undefined;
  if (analysisModel && !analyse) warnings.push(`The key for the analysis model "${analysisModel.name}" is not set; the runs get the rule-based analysis only.`);
  const atDriverCommand = mode === 'screenreader' && conditions.atEnvironment.backend !== 'simulation' ? await store.localValue(AT_DRIVER_COMMAND_ENV) : undefined;
  const spec: RunSpec = { ...runSpecOf(source, mode, conditions, check, options.diagnoseStop), ...(check.plannerPlanFile ? { plannerPlan: await loadPlanFile(store, check.plannerPlanFile) } : {}) };
  const root = options.outDir ? resolve(options.outDir) : join(projectDir, '.rawstep', 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const signal = options.signal ?? new AbortController().signal, execute = internals.execute ?? executeRun;
  const cancelled = () => new ProjectError('cancelled', 'The run was cancelled. Traces written so far are kept.');
  const done: { outDir: string; trace: RunTrace }[] = [];
  for (let i = 1; i <= repeat; i++) {
    if (signal.aborted) throw cancelled();
    const outDir = join(root, `run-${i}`);
    const trace = await execute(spec, { outDir, apiKey, plannerApiKey, signal, atDriverCommand, browserProfileDir: join(projectDir, '.rawstep', 'browser-profile'), ...(options.onEvent ? { onEvent: options.onEvent } : {}) });
    if (signal.aborted) throw cancelled();
    done.push({ outDir, trace });
  }
  // Hints are written once all repeats exist, so each run is compared with the fastest one that reached the goal.
  const reference = selectReference(done.map(d => d.trace));
  const referenceDir = reference ? done.find(d => d.trace === reference)?.outDir : undefined;
  const runs: RunTaskResult['runs'] = [];
  for (const { outDir, trace } of done) {
    const { hints } = await finalizeRun(trace, outDir, { ...(referenceDir ? { referenceDir } : {}),
      ...(analyse ? { createAnalyzer: async () => llmAnalyzer(analyse, analysisKey, settings.analysisInstructions, signal) } : {}) });
    runs.push({ runId: trace.runId, outDir, outcome: trace.outcome, hints: hints ?? extractHints(trace, reference ? { reference } : {}) });
  }
  return { conditions: spec.conditions ?? {}, warnings, runs, findings: aggregateHints(runs.map(r => r.hints)) };
}
/** The key a model needs (`undefined` for a server that takes none); a missing required key stops the run before anything starts. */
export async function requireKey(store: ProjectStore, model: Model): Promise<string | undefined> {
  const apiKey = await store.credential(model), env = modelKeyEnv(model);
  if (modelKeyRequired(model) && !apiKey) throw new ProjectError('missing-credential', env ? `The key ${env} for "${model.name}" is not set. Add ${env}=... to .env.local or export it.` : `"${model.name}" needs a key, but no environment variable is named for it.`);
  return apiKey;
}
/** The trace analyzer of an LLM model. */
export function llmAnalyzer(model: Model, apiKey: string | undefined, instructions?: string, signal?: AbortSignal): LlmTraceAnalyzer {
  return new LlmTraceAnalyzer({ llm: llmModelOf(model, 'rawstep-analysis', apiKey), model: model.modelId || `${model.provider}-default`, timeoutMs: model.timeoutMs, ...(instructions ? { instructions } : {}), ...(signal ? { signal } : {}) });
}

/** The project's analysis LLM as a trace analyzer. */
export async function projectAnalyzer(projectDir: string, options: { signal?: AbortSignal } = {}): Promise<{ analyzer: LlmTraceAnalyzer; modelName: string }> {
  const store = new ProjectStore(resolve(projectDir)), { config } = await store.read();
  const model = projectAnalysisModel(config);
  if (!model) throw new ProjectError('no-analysis-model', 'The project has no analysis model. Pick an LLM for analysis in the project settings with `rawstep ui`.');
  const apiKey = await requireKey(store, model);
  return { analyzer: llmAnalyzer(model, apiKey, config.project.analysis.instructions, options.signal), modelName: model.name };
}
