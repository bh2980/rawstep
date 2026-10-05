import { ScreenshotReplayPolicy, screenshotReplayTaskHash, assertScreenshotReplayTaskSafety, type ScreenshotReplay } from '@rawstep/policies/screenshot/replay';
import { join } from 'node:path';
import { hydrateScreenshots, writeJsonAtomic } from '@rawstep/core/trace';
import { diagnoseScreenshotStop } from '@rawstep/policies/screenshot/stop-reason';
import type { ScreenshotModelAdapter } from '@rawstep/policies/screenshot/model';
import type { Task } from '@rawstep/core/contracts';
import { runTask, type RunOptions } from '../runner/index.js';
import type { RunTrace } from '@rawstep/core/trace';
import { ScreenshotKeyboardBackend } from './backend.js';
export * from './backend.js';

export type ScreenshotRunOptions = Omit<RunOptions, 'backend'> & {stopReasonModel?:ScreenshotModelAdapter;stopReasonTimeoutMs?:number;warn?:(message:string)=>void};
/** Screenshot-only keyboard exploration. */
export async function runScreenshotTask(task: Task, options: ScreenshotRunOptions): Promise<RunTrace> {
  if (task.mode && task.mode !== 'keyboard') throw new Error('Screenshot runs require task mode keyboard.');
  const backend = new ScreenshotKeyboardBackend();
  const trace = await runTask({ ...task, mode: 'keyboard' }, { ...options, backend, headless: options.headless ?? true });
  if(options.stopReasonModel){
    const report=await diagnoseScreenshotStop(await hydrateScreenshots(trace,options.outDir),{model:options.stopReasonModel,timeoutMs:options.stopReasonTimeoutMs,signal:options.signal});
    try{await writeJsonAtomic(join(options.outDir,'stop-reason.json'),report)}catch{options.warn?.('Stop-reason analysis could not be persisted; the original run outcome is unchanged.')}
  }
  return trace;
}

/** Replays reviewed keyboard paths while retaining the runner's independent verification and guards. */
export async function runScreenshotReplay(task: Task, replay: ScreenshotReplay, options: Omit<ScreenshotRunOptions, 'policy' | 'stopReasonModel' | 'verifier' | 'profile'>): Promise<RunTrace> {
  if (Object.hasOwn(options, 'verifier') || Object.hasOwn(options, 'profile')) throw new Error('Replay uses the task profile and built-in independent verifier; overrides are not allowed.');
  assertScreenshotReplayTaskSafety(task);
  if (Object.keys(task.input ?? {}).length || screenshotReplayTaskHash(task) !== replay.taskSha256) throw new Error('Replay task contract changed; export a newly reviewed scenario.');
  return runScreenshotTask(task, { ...options, policy: new ScreenshotReplayPolicy(replay) });
}
