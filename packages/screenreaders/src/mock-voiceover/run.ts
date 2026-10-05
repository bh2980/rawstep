import type { Task } from '@rawstep/core/contracts';
import { MockVoiceOverBackend } from './backend.js';
import { runTask, type RunOptions } from '@rawstep/browser/runner';
import type { RunTrace } from '@rawstep/core/trace';

export const MOCK_VOICEOVER_WARNING = 'Simulated VoiceOver DOM-navigation profile. Output is synthesized from Chromium accessibility semantics; no native VoiceOver speech is captured or validated.';
export type MockVoiceOverRunOptions = Omit<RunOptions, 'backend'> & { warn?: (message: string) => void };

/** Explicit browser-backed simulation; never selected by the native run command. */
export function runMockVoiceOverTask(task: Task, options: MockVoiceOverRunOptions): Promise<RunTrace> {
  (options.warn ?? (message => process.stderr.write(`[simulation] ${message}\n`)))(MOCK_VOICEOVER_WARNING);
  // The runner hands the opened session to the backend through attachSession.
  return runTask(task, { ...options, backend: new MockVoiceOverBackend(), headless: options.headless ?? true });
}
