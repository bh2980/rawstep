import type { Task } from '@rawstep/core/contracts';
import { closeBrowserSession, settlePage } from '@rawstep/browser/browser';
import type { MachineSettings } from '@rawstep/project/config';
import { MockVoiceOverBackend } from '@rawstep/screenreaders/mock-voiceover';
import type { ReachEstimate } from '../shared/api.js';
import { openStartPage } from './structure.js';

const MAX_STOPS = 600;
const SETTLE_MS = 1500;

/**
 * The words a run is looking for on its start page: the texts its completion checks expect and anything quoted in the goal
 * ('Thor Hammer', "Book Tickets"). Distances are measured to these.
 */
export function reachTargets(task: Pick<Task, 'goal' | 'verify'>): string[] {
  const found = new Set<string>();
  for (const rule of task.verify.all as unknown[]) {
    const r = rule as Record<string, unknown>;
    for (const key of ['textVisible', 'textVisibleExact']) if (typeof r[key] === 'string' && (r[key] as string).trim()) found.add((r[key] as string).trim());
  }
  for (const match of task.goal.matchAll(/['"‘“]([^'"’”]{2,80})['"’”]/g)) found.add(match[1]!.trim());
  return [...found].slice(0, 5);
}

/**
 * How far a screen reader run has to go on the task's start page, read with the simulated VoiceOver: how many objects `next`
 * passes on the whole page, and for each target text how many `next` (and, when it is in a heading, `heading.next`) presses it
 * takes to hear it. It measures the start page only; steps on later pages (a product page, the cart) come on top.
 */
export async function estimateReach(options: { task: Task; projectDir: string; machine: Pick<MachineSettings, 'headless' | 'browserExecutablePath'> }): Promise<ReachEstimate> {
  const session = await openStartPage({ url: options.task.url, projectDir: options.projectDir, machine: options.machine });
  try {
    await settlePage(session.page);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    const walk = async (intent: string, stop: string) => {
      const reader = new MockVoiceOverBackend();
      await reader.start();
      reader.attachSession(session);
      const heard = [(await reader.observe()).speech.join(' ')];
      let ended = false;
      for (let index = 0; index < MAX_STOPS && !ended; index++) {
        await reader.execute({ kind: 'intent', intent });
        const said = (await reader.observe()).speech.join(' ');
        if (said === stop) ended = true; else heard.push(said);
      }
      await reader.close();
      return { heard, ended };
    };
    const page = await walk('next', 'End of content'), byHeading = await walk('heading.next', 'No more headings');
    const lines = page.heard, headings = byHeading.heard;
    const at = (heard: string[], text: string) => { const index = heard.findIndex(line => line.toLowerCase().includes(text.toLowerCase())); return index < 0 ? undefined : index; };
    return {
      stops: lines.length, truncated: !page.ended,
      targets: reachTargets(options.task).map(text => ({ text, ...(at(lines, text) !== undefined ? { next: at(lines, text)! } : {}), ...(at(headings, text) !== undefined ? { heading: at(headings, text)! } : {}) })),
    };
  } finally { await closeBrowserSession(session); }
}
