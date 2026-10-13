import { z } from 'zod';
import type { PlanDocument, PlanDraft } from './plan-document.js';
import type { Planner, PlanRequest, PlanResult } from './orchestration.js';

const ref = z.string().regex(/^[A-Z][0-9]{1,3}$/);
/** A plan draft as a planner returns it and as a plan file holds it: criteria, assumptions, phases of tasks with their cues. */
export const planDraftSchema = z.object({
  complete: z.boolean(),
  rationale: z.string().max(2000),
  strategy: z.string().max(500),
  criteria: z.array(z.object({ id: ref, text: z.string().min(1).max(300), status: z.enum(['open', 'met', 'unmet']).optional() }).strict()).max(10),
  assumptions: z.array(z.object({ id: ref, text: z.string().min(1).max(300), status: z.enum(['open', 'held', 'broken']).optional() }).strict()).max(10),
  phases: z.array(z.object({
    title: z.string().min(1).max(200),
    criteria: z.array(ref).max(10).optional(),
    tasks: z.array(z.object({ keep: z.string().max(20).optional(), goal: z.string().min(1).max(300), done: z.string().min(1).max(300), cue: z.string().max(120), activates: z.boolean().optional(), moves: z.array(z.string().min(1).max(40)).max(6).optional(),
      serves: z.array(ref).max(10).optional(), relies: z.array(ref).max(10).optional() }).strict()).max(8),
  }).strict()).max(6),
}).strict();
/** A plan file: the draft a run starts from, `complete` and `rationale` optional (a person writing a plan has neither to say). */
export const planFileSchema = planDraftSchema.extend({ complete: z.literal(false).default(false), rationale: z.string().max(2000).default('') });

/**
 * A plan written beforehand — by a person, or by a planner model and saved — that never changes during the run. It holds the plan
 * still, so a run measures how the executor carries out these tasks rather than how well a planner plans. When Rawstep would ask
 * for a new plan (actions failing, changing nothing, running long, low executor confidence), the stuck task is abandoned and the
 * next one starts: that abandonment is the finding. When no task is left the run ends and the run's own checks decide the outcome.
 */
export class FixedPlanner implements Planner {
  constructor(readonly draft: PlanDraft, readonly source: { file: string; sha256: string }) {}
  async plan(request: PlanRequest): Promise<PlanResult> {
    const result = (draft: PlanDraft): PlanResult => ({ draft, model: { id: this.source.file, runtime: 'fixed-plan' }, prompt: { id: 'rawstep-fixed-plan', version: this.source.sha256.slice(0, 12), sha256: this.source.sha256 } });
    if (request.trigger === 'start' || !request.document) return result(structuredClone(this.draft));
    const doc = request.document;
    const kept = (drop?: string): PlanDraft => ({
      ...structuredClone(this.draft), complete: false,
      rationale: drop ? `Fixed plan: task ${drop} was abandoned after "${request.trigger}"; the plan does not change, so the next task starts.` : 'Fixed plan: unchanged.',
      phases: doc.phases.map(phase => ({ title: phase.title, criteria: [...phase.criteria],
        tasks: phase.tasks.filter(task => task.id !== drop).map(task => ({ keep: task.id, goal: task.goal, done: task.done, cue: task.cue, ...(task.activates !== undefined ? { activates: task.activates } : {}), ...(task.moves ? { moves: [...task.moves] } : {}), serves: [...task.serves], relies: [...task.relies] })) })),
    });
    if (request.trigger === 'checkpoint') return result(kept());
    const open = openTasks(doc);
    // Nothing left to try: the plan has run its course; the run's checks decide whether the goal was reached.
    if (request.trigger === 'plan-finished' || open.length <= (doc.current ? 1 : 0)) return result({ ...kept(doc.current), complete: true, rationale: 'Fixed plan: every task has been tried; the run\'s checks decide the outcome.' });
    return result(kept(doc.current));
  }
}
const openTasks = (doc: PlanDocument) => doc.phases.flatMap(phase => phase.tasks).filter(task => task.status === 'pending' || task.status === 'active');
