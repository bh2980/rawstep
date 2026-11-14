import type { Task } from '@rawstep/core/contracts';
import { MockVoiceOverBackend } from './backend.js';
import { runWithPolicy, type RunOptions } from '@rawstep/core/runner';
import { webSurface, type WebSurfaceOptions } from '@rawstep/browser/surface';
import type { RunTrace } from '@rawstep/core/trace';

export const MOCK_VOICEOVER_WARNING = 'Simulated VoiceOver DOM-navigation profile. Output is synthesized from Chromium accessibility semantics; no native VoiceOver speech is captured or validated.';
/** The simulation reads Chromium's page, so it always runs on a web page: `browser` sets up that page (headless unless it says otherwise). */
export type MockVoiceOverRunOptions = Omit<RunOptions, 'backend' | 'surface'> & { browser?: WebSurfaceOptions; warn?: (message: string) => void };

/** Explicit browser-backed simulation; never selected by the native run command. */
export function runMockVoiceOverTask(task: Task, { browser, warn, ...options }: MockVoiceOverRunOptions): Promise<RunTrace> {
  (warn ?? (message => process.stderr.write(`[simulation] ${message}\n`)))(MOCK_VOICEOVER_WARNING);
  // The runner hands the opened session to the backend through attachSession.
  return runWithPolicy(task, { ...options, backend: new MockVoiceOverBackend(), surface: webSurface({ ...browser, headless: browser?.headless ?? true }) });
}
