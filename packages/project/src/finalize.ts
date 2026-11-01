import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readTrace, type RunTrace } from '@rawstep/core/trace';
import { analyzeTrace, writeReport, LlmTraceAnalyzer, type TraceAnalyzer } from '@rawstep/reports';
import { selectReference, writeHints, type HintReport } from '@rawstep/reports/hints';
import { modelKeyEnvNames, modelKeyRequired, projectAnalysisModel, type Model } from './config.js';
import { ProjectError } from './errors.js';
import { llmModelOf } from './llm.js';
import { ProjectStore, atomicJson } from './store.js';

export type FinalizeOptions = {
  /** A run directory to compare the hints with (the fastest goal-reaching run of the task). */
  referenceDir?: string;
  /** Builds the analyzer; called inside the guarded block, so a failure leaves the run's results intact. Without one, analysis is the local deterministic summary. */
  createAnalyzer?: () => Promise<TraceAnalyzer | undefined>;
  /** The task's name in the project, for the report's heading. */
  taskName?: string;
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
  const withHints = { ...(hints ? { hints } : {}), ...(options.taskName ? { taskName: options.taskName } : {}) };
  try {
    const analysis = await analyzeTrace(trace, await options.createAnalyzer?.());
    await atomicJson(join(outDir, 'analysis.json'), analysis);
    await writeReport(trace, analysis, outDir, withHints);
    return { ...(hints ? { hints } : {}), analysis: { status: analysis.status === 'failed' ? 'failed' : 'complete', ...(analysis.status === 'failed' ? { error: analysis.error ?? 'Analysis failed.' } : {}), threw: false }, report: { status: 'complete' } };
  } catch {
    try { await writeReport(trace, undefined, outDir, withHints); return { ...(hints ? { hints } : {}), analysis: { status: 'failed', threw: true }, report: { status: 'complete' } }; }
    catch { return { ...(hints ? { hints } : {}), analysis: { status: 'failed', threw: true }, report: { status: 'failed' } }; }
  }
}

/**
 * Repeats of one task under one profile, run one by one (the dashboard's queue), compared once the last has finished: each run's
 * hints and report are written again against the fastest run that reached the goal, as `runTask` does, keeping its analysis.
 */
export async function compareRepeats(outDirs: readonly string[], options: { taskName?: string } = {}): Promise<void> {
  const runs = (await Promise.all(outDirs.map(async outDir => ({ outDir, trace: await readTrace(outDir).catch(() => undefined) }))))
    .filter((run): run is { outDir: string; trace: RunTrace } => !!run.trace);
  const reference = runs.length > 1 ? selectReference(runs.map(run => run.trace)) : undefined;
  if (!reference) return;
  const referenceDir = runs.find(run => run.trace === reference)!.outDir;
  for (const { outDir, trace } of runs) {
    const hints = await writeHints(outDir, { reference: referenceDir }).then(({ report }) => report, () => undefined);
    if (!hints) continue;
    const analysis = await readFile(join(outDir, 'analysis.json'), 'utf8').then(text => JSON.parse(text), () => undefined);
    await writeReport(trace, analysis, outDir, { hints, ...(options.taskName ? { taskName: options.taskName } : {}) }).catch(() => {});
  }
}

/** The key a model needs (`undefined` for a server that takes none); a missing required key stops the run before anything starts. */
export async function requireKey(store: ProjectStore, model: Model): Promise<string | undefined> {
  const apiKey = await store.credential(model), [env, ...standard] = modelKeyEnvNames(model);
  if (modelKeyRequired(model) && !apiKey) throw new ProjectError('missing-credential', env ? `The key ${env} for "${model.name}" is not set. Add ${env}=... to .env.local or export it${standard.length ? ` (${standard.join(' or ')} also works)` : ''}.` : `"${model.name}" needs a key, but no environment variable is named for it.`);
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
