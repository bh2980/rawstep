/**
 * The plan an orchestrated run follows, shaped like a spec-driven plan (Kiro, Spec Kit): success criteria (what the user must be
 * able to hear) → strategy and the assumptions it rests on → phases of numbered tasks that name the criteria they serve and the
 * assumptions they rely on. The planner drafts and revises it; Rawstep owns the document — task ids, statuses, the current task,
 * action counts, versions and history. The executor only ever sees one task, so everything it cannot keep track of lives here.
 */
export type TaskStatus = 'pending' | 'active' | 'done' | 'abandoned' | 'failed';
export type CriterionStatus = 'open' | 'met' | 'unmet';
export type AssumptionStatus = 'open' | 'held' | 'broken';
/** Why the executor asked for help: the completion cue never came, actions had no effect, or the task already looks done. */
export type HelpReason = 'no-cue' | 'no-effect' | 'already-done';
/** Why the plan was (re)written. `checkpoint`: a phase finished and the planner reviews its criteria before going on. */
export type PlanTrigger = 'start' | 'help' | 'failures' | 'no-change' | 'task-limit' | 'checkpoint' | 'plan-finished';
/**
 * How a task ended. `verified` compares the task's cue with what the screen reader said: the executor's "done" is a claim, not a
 * fact. A claim whose cue was not heard is turned down, so a task only ends `not-heard` in plans written before that rule;
 * `unchecked` means the task had no cue to compare.
 */
export type TaskEnding = { reason: 'done' | 'replaced' | 'limit'; step: number; verified?: 'heard' | 'not-heard' | 'unchecked' };
/** Something the user must be able to hear for the goal to count as reached, in the planner's words. */
export type Criterion = { id: string; text: string; status: CriterionStatus; addedIn: number };
/** An expectation from common UI conventions the plan rests on; running the plan shows whether it held. */
export type Assumption = { id: string; text: string; status: AssumptionStatus; addedIn: number; settledIn?: number };
export type PlanTask = {
  id: string;
  /** Position in the current version, like "2.1"; kept as it was when the task was retired. */
  number: string;
  goal: string;
  /** What the user hears when the task is done, in the planner's words. */
  done: string;
  /** The exact words the screen reader should say when the task is done; empty when they cannot be predicted. Rawstep checks a
   * "done" claim against them. */
  cue: string;
  /** "Done" claims Rawstep turned down because the cue was not heard. */
  rejected: number;
  /** Criteria this task works toward and assumptions it relies on. */
  serves: string[]; relies: string[];
  status: TaskStatus;
  /** Actions taken while this task was current. */
  actions: number;
  /** The plan version that added the task. */
  addedIn: number;
  ending?: TaskEnding;
};
export type PlanPhase = {
  id: string; number: string; title: string;
  /** Criteria the phase is meant to meet; checked at its checkpoint. */
  criteria: string[];
  tasks: PlanTask[];
  /** The plan version that reviewed the phase once its tasks were done. */
  checkpoint?: { version: number; step: number };
};
export type PlanRevision = {
  version: number;
  /** The runner step the revision was made before. */
  step: number;
  trigger: PlanTrigger; help?: HelpReason;
  /** The planner's own account of what differed from its expectation and what it changed. */
  rationale: string;
  added: string[]; abandoned: string[];
  /** Assumptions found wrong and criteria found met in this revision. */
  broken: string[]; met: string[];
};
export type PlanDocument = {
  goal: string; version: number;
  /** The planner judged every criterion met; the run stops and the independent verifier decides. */
  complete: boolean;
  criteria: Criterion[];
  strategy: string;
  assumptions: Assumption[];
  phases: PlanPhase[];
  /** Tasks dropped from the current plan, kept with their phase title so the history stays readable. */
  retired: (PlanTask & { phase: string })[];
  /** The task the executor works on now. */
  current?: string;
  revisions: PlanRevision[];
};
/**
 * What the planner returns. Criteria and assumptions carry the planner's own ids (C1…, A1…): reuse an id for the same item, use a
 * new one for a new item. Tasks reuse an existing task with `keep` = its id; tasks without `keep` are new.
 */
export type PlanDraft = {
  complete: boolean; rationale: string; strategy: string;
  criteria: { id: string; text: string; status?: CriterionStatus }[];
  assumptions: { id: string; text: string; status?: AssumptionStatus }[];
  phases: { title: string; criteria?: string[]; tasks: { keep?: string; goal: string; done: string; cue?: string; serves?: string[]; relies?: string[] }[] }[];
};

const open = (t: PlanTask) => t.status === 'pending' || t.status === 'active';
export const planTasks = (doc: PlanDocument): PlanTask[] => doc.phases.flatMap(p => p.tasks);
export const currentTask = (doc: PlanDocument): PlanTask | undefined => planTasks(doc).find(t => t.id === doc.current);
export const phaseOf = (doc: PlanDocument, taskId: string): PlanPhase | undefined => doc.phases.find(p => p.tasks.some(t => t.id === taskId));

/**
 * Applies a planner draft. Kept tasks keep their id, status and action count; finished tasks the draft leaves out are retired
 * as they were; open tasks it leaves out are abandoned. Criteria and assumptions keep their id; a settled assumption stays
 * settled. Tasks are renumbered by phase, and the first open task becomes current.
 */
export function applyDraft(doc: PlanDocument | undefined, draft: PlanDraft, at: { goal: string; step: number; trigger: PlanTrigger; help?: HelpReason }): PlanDocument {
  const version = (doc?.version ?? 0) + 1;
  const previous = new Map((doc ? planTasks(doc) : []).map(t => [t.id, t]));
  const titleOf = new Map((doc?.phases ?? []).flatMap(p => p.tasks.map(t => [t.id, p.title] as const)));
  const checkpointOf = new Map((doc?.phases ?? []).filter(p => p.checkpoint).map(p => [p.title, p.checkpoint!] as const));
  let next = doc ? Math.max(0, ...[...planTasks(doc), ...doc.retired].map(t => Number(t.id.slice(1)) || 0)) : 0;
  const kept = new Set<string>(), added: string[] = [];
  const criteria: Criterion[] = draft.criteria.map(c => { const old = doc?.criteria.find(o => o.id === c.id);
    return { id: c.id, text: c.text, status: c.status ?? old?.status ?? 'open', addedIn: old?.addedIn ?? version }; });
  const assumptions: Assumption[] = draft.assumptions.map(a => { const old = doc?.assumptions.find(o => o.id === a.id);
    const status = old && old.status !== 'open' ? old.status : a.status ?? 'open';
    return { id: a.id, text: a.text, status, addedIn: old?.addedIn ?? version, ...(old?.settledIn ? { settledIn: old.settledIn } : status !== 'open' ? { settledIn: version } : {}) }; });
  const phases: PlanPhase[] = draft.phases.map((phase, i) => ({ id: `p${version}.${i + 1}`, number: String(i + 1), title: phase.title, criteria: phase.criteria ?? [],
    ...(checkpointOf.get(phase.title) ? { checkpoint: checkpointOf.get(phase.title)! } : {}),
    tasks: phase.tasks.map((task, j): PlanTask => {
      const number = `${i + 1}.${j + 1}`, serves = task.serves ?? [], relies = task.relies ?? [];
      const old = task.keep !== undefined ? previous.get(task.keep) : undefined;
      if (old && !kept.has(old.id)) { kept.add(old.id); return { ...structuredClone(old), number, serves, relies, status: old.status === 'active' ? 'pending' : old.status }; }
      const id = `t${++next}`; added.push(id);
      return { id, number, goal: task.goal, done: task.done, cue: task.cue?.trim() ?? '', serves, relies, status: 'pending', actions: 0, rejected: 0, addedIn: version };
    }) })).filter(p => p.tasks.length);
  const retired = [...(doc?.retired ?? [])], abandoned: string[] = [];
  for (const [id, task] of previous) {
    if (kept.has(id)) continue;
    const dropped = open(task) ? { ...task, status: 'abandoned' as const, ending: { reason: 'replaced' as const, step: at.step } } : task;
    if (open(task)) abandoned.push(id);
    retired.push({ ...structuredClone(dropped), phase: titleOf.get(id) ?? '' });
  }
  const before = new Map([...(doc?.criteria ?? []), ...(doc?.assumptions ?? [])].map(x => [x.id, x.status]));
  const broken = assumptions.filter(a => a.status === 'broken' && before.get(a.id) !== 'broken').map(a => a.id);
  const met = criteria.filter(c => c.status === 'met' && before.get(c.id) !== 'met').map(c => c.id);
  const result: PlanDocument = { goal: at.goal, version, complete: draft.complete, criteria, strategy: draft.strategy, assumptions, phases, retired,
    revisions: [...(doc?.revisions ?? []), { version, step: at.step, trigger: at.trigger, ...(at.help ? { help: at.help } : {}), rationale: draft.rationale, added, abandoned, broken, met }] };
  return activateNext(result);
}
/** Makes the first open task current (and active); none left means the plan has run out. */
export function activateNext(doc: PlanDocument): PlanDocument {
  const task = planTasks(doc).find(open);
  if (task) task.status = 'active';
  if (task) doc.current = task.id; else delete doc.current;
  return doc;
}
/** Ends the current task as done and moves on. */
export function finishCurrent(doc: PlanDocument, step: number, verified: TaskEnding['verified']): PlanTask | undefined {
  const task = currentTask(doc);
  if (!task) return undefined;
  task.status = 'done'; task.ending = { reason: 'done', step, ...(verified ? { verified } : {}) };
  activateNext(doc);
  return task;
}
/** Whether a phase's tasks are all finished and it has not been reviewed yet. */
export const needsCheckpoint = (phase: PlanPhase | undefined): boolean => !!phase && !phase.checkpoint && phase.tasks.every(t => !open(t));
/** Records that the planner reviewed a phase. */
export function markCheckpoint(doc: PlanDocument, phaseTitle: string, step: number): void {
  const phase = doc.phases.find(p => p.title === phaseTitle);
  if (phase) phase.checkpoint = { version: doc.version, step };
}
/** Ends the current task as failed when the run gives up on it. */
export function failCurrent(doc: PlanDocument, step: number): void {
  const task = currentTask(doc);
  if (task) { task.status = 'failed'; task.ending = { reason: 'limit', step }; }
}
/**
 * Whether a task's completion cue was heard: its `cue`, else words quoted in its "done" (straight or curly quotes). Matching
 * ignores case and spacing. A task with neither cannot be checked.
 */
export function verifyCue(task: Pick<PlanTask, 'cue' | 'done'>, heard: readonly string[]): NonNullable<TaskEnding['verified']> {
  const quoted = task.cue ? [task.cue] : [...task.done.matchAll(/["“”']([^"“”']{2,})["“”']/g)].map(m => m[1]!.trim()).filter(Boolean);
  if (!quoted.length) return 'unchecked';
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const said = heard.map(norm).join('\n');
  return quoted.some(q => said.includes(norm(q))) ? 'heard' : 'not-heard';
}
/** One line per task for the executor: where the run is, without the planner's free-form reasoning. */
export function planOutline(doc: PlanDocument): { number: string; phase: string; task: string; status: TaskStatus }[] {
  return doc.phases.flatMap(p => p.tasks.map(t => ({ number: t.number, phase: p.title, task: t.goal, status: t.status })));
}

const box: Record<TaskStatus, string> = { pending: '[ ]', active: '[~]', done: '[x]', abandoned: '[-]', failed: '[!]' };
const mark: Record<CriterionStatus | AssumptionStatus, string> = { open: '?', met: '✓', unmet: '✕', held: '✓', broken: '✕' };
/** The plan as a readable checklist (plan.md), in the spirit of a spec-driven tasks file. */
export function renderPlanMarkdown(doc: PlanDocument): string {
  const lines = [`# ${doc.goal}`, '', `Plan v${doc.version}${doc.complete ? ' · complete' : ''}`, '', '## Success criteria', '',
    ...doc.criteria.map(c => `- ${mark[c.status]} ${c.id} ${c.text}`), '', '## Strategy', '', doc.strategy || '-', '', '## Assumptions', '',
    ...doc.assumptions.map(a => `- ${mark[a.status]} ${a.id} ${a.text}${a.settledIn ? ` (v${a.settledIn})` : ''}`), '', '## Tasks', ''];
  for (const phase of doc.phases) {
    lines.push(`### ${phase.number}. ${phase.title}${phase.criteria.length ? ` — ${phase.criteria.join(', ')}` : ''}${phase.checkpoint ? ` · checkpoint v${phase.checkpoint.version}` : ''}`, '');
    for (const t of phase.tasks) {
      const refs = [...t.serves, ...t.relies].join(', ');
      lines.push(`- ${box[t.status]} ${t.number} ${t.goal}${refs ? ` _(${refs})_` : ''}${doc.current === t.id ? ' ← current' : ''}`,
        `  - done: ${t.done}${t.cue ? ` · cue "${t.cue}"` : ''} · actions: ${t.actions}${t.rejected ? ` · claims turned down: ${t.rejected}` : ''}${t.ending?.verified ? ` · cue ${t.ending.verified}` : ''}`);
    }
    lines.push('');
  }
  if (doc.retired.length) lines.push('## Retired', '', ...doc.retired.map(t => `- ${box[t.status]} ${t.number} ${t.goal} (${t.phase}) · actions: ${t.actions}`), '');
  lines.push('## Revisions', '', ...doc.revisions.map(r => `- v${r.version} before step ${r.step} · ${r.trigger}${r.help ? `/${r.help}` : ''}${r.broken.length ? ` · broken ${r.broken.join(', ')}` : ''}${r.met.length ? ` · met ${r.met.join(', ')}` : ''}${r.rationale ? ` — ${r.rationale}` : ''}`), '');
  return lines.join('\n');
}
