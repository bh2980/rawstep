import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { resolveTask } from '@rawstep/core/contracts';
import { hydrateScreenshots, type RunOutcome, type RunTrace, type TraceEvent } from '@rawstep/core/trace';
import { resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { analyzeTrace, writeReport, LlmTraceAnalyzer, type TraceAnalyzer } from '@rawstep/reports';
import { aggregateHints, extractHints, selectReference, writeHints, type HintFinding, type HintReport } from '@rawstep/reports/hints';
import { findByIdOrName, modelKeyEnv, modelKeyRequired, resolveBaseURL, taskProfile, type Mode, type Model, type ProjectConfig } from './config.js';
import { ProjectError } from './errors.js';
import { ProjectStore, atomicJson } from './store.js';
import { assertRunnable, checkRun, defaultPrompt, supportsMode } from './plan.js';
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
  /** A model id or name from the config. Defaults to the first decision model that supports the mode. */
  model?: string;
  /** A run profile id or name. Defaults to the task's profile, then the first profile. */
  profile?: string;
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
 * from rawstep.config.json or a path to a task JSON file; a file that is not registered runs with the first profile.
 * Reaching the goal is one signal in the hints, not a verdict, so a run that fails its goal still resolves.
 * It rejects on setup problems (no config, no usable model, a missing key) and on cancellation.
 *
 * `internals.execute` replaces the real browser and model run; it exists for tests.
 */
export async function runTask(task: string, options: RunTaskOptions = {}, internals: { execute?: RunExecutor } = {}): Promise<RunTaskResult> {
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const mode = options.mode ?? 'keyboard', repeat = options.repeat ?? 1;
  if (mode !== 'keyboard' && mode !== 'screenreader') throw new ProjectError('invalid-mode', `The mode must be keyboard or screenreader, not "${String(mode)}".`);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) throw new ProjectError('invalid-repeat', `The repeat count must be an integer from 1 to ${MAX_REPEAT}.`);
  const store = new ProjectStore(projectDir), { config } = await store.read();
  const { entry, task: source } = await loadTask(store, config, task, projectDir);
  const profile = options.profile !== undefined ? pick('profile', config.profiles, options.profile) : entry ? taskProfile(config, entry) : config.profiles[0]!;
  const model = options.model !== undefined ? pick('model', config.models, options.model) : config.models.find(m => supportsMode(m, mode));
  if (!model) throw new ProjectError('no-model', `No model in rawstep.config.json can run ${mode} mode. It needs the decision role${mode === 'keyboard' ? ' and image input' : ''}. Add one with \`rawstep ui\`.`);
  const prompt = defaultPrompt(entry, mode);
  const { settings, permissions } = assertRunnable(checkRun({ config, task: source, taskEntry: entry, model, profile, mode }));
  const apiKey = await requireKey(store, model);
  const spec: RunSpec = { task: source, model, prompt, mode, settings, environment: resolveEnvironmentProfile(profile.environment), permissions };
  const root = options.outDir ? resolve(options.outDir) : join(projectDir, '.rawstep', 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const signal = options.signal ?? new AbortController().signal, execute = internals.execute ?? executeRun;
  const cancelled = () => new ProjectError('cancelled', 'The run was cancelled. Traces written so far are kept.');
  const done: { outDir: string; trace: RunTrace }[] = [];
  for (let i = 1; i <= repeat; i++) {
    if (signal.aborted) throw cancelled();
    const outDir = join(root, `run-${i}`);
    const trace = await execute(spec, { outDir, apiKey, signal, ...(options.onEvent ? { onEvent: options.onEvent } : {}) });
    if (signal.aborted) throw cancelled();
    done.push({ outDir, trace });
  }
  // Hints are written once all repeats exist, so each run is compared with the fastest one that reached the goal.
  const reference = selectReference(done.map(d => d.trace));
  const referenceDir = reference ? done.find(d => d.trace === reference)?.outDir : undefined;
  const runs: RunTaskResult['runs'] = [];
  for (const { outDir, trace } of done) {
    const { hints } = await finalizeRun(trace, outDir, referenceDir ? { referenceDir } : {});
    runs.push({ runId: trace.runId, outDir, outcome: trace.outcome, hints: hints ?? extractHints(trace, reference ? { reference } : {}) });
  }
  return { runs, findings: aggregateHints(runs.map(r => r.hints)) };
}

/** The key a model needs (`undefined` for a server that takes none); a missing required key stops the run before anything starts. */
export async function requireKey(store: ProjectStore, model: Model): Promise<string | undefined> {
  const apiKey = await store.credential(model), env = modelKeyEnv(model);
  if (modelKeyRequired(model) && !apiKey) throw new ProjectError('missing-credential', env ? `The key ${env} for model "${model.name}" is not set. Add ${env}=... to .env.local or export it.` : `Model "${model.name}" needs a key, but no environment variable is named for it.`);
  return apiKey;
}

/** An analysis-role LLM from the config (by id or name; the first one by default) as a trace analyzer. */
export async function projectAnalyzer(projectDir: string, options: { model?: string; signal?: AbortSignal } = {}): Promise<{ analyzer: LlmTraceAnalyzer; modelName: string }> {
  const store = new ProjectStore(resolve(projectDir)), { config } = await store.read();
  const model = options.model !== undefined ? pick('model', config.models, options.model) : config.models.find(m => m.kind === 'llm' && m.roles.includes('analysis'));
  if (!model) throw new ProjectError('no-analysis-model', 'No model in rawstep.config.json has the analysis role. Add an LLM with that role in `rawstep ui`.');
  if (model.kind !== 'llm' || !model.roles.includes('analysis')) throw new ProjectError('analysis-model-invalid', `Model "${model.name}" cannot analyze runs. Choose an LLM with the analysis role.`);
  const apiKey = await requireKey(store, model);
  return { analyzer: new LlmTraceAnalyzer({ baseURL: resolveBaseURL(model), model: model.modelId, apiKey, timeoutMs: model.timeoutMs, ...(options.signal ? { signal: options.signal } : {}) }), modelName: model.name };
}
