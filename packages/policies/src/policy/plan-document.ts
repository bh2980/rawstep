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
export type PlanTrigger = 'start' | 'help' | 'failures' | 'no-change' | 'task-limit' | 'low-confidence' | 'oscillation' | 'goal-heard' | 'checkpoint' | 'plan-finished';
/**
 * How a task ended. `verified` compares the task's cue with what the screen reader said: the executor's "done" is a claim, not a
 * fact. A claim whose cue was not heard is turned down, so a task only ends `not-heard` in plans written before that rule;
 * `unchecked` means the task had no cue to compare.
 */
export type TaskEnding = { reason: 'done' | 'replaced' | 'limit'; step: number; verified?: 'heard' | 'recognized' | 'not-heard' | 'unchecked' };
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
  /** The name words the user expects to hear when the task is done (a guess: the planner has not heard the item yet); empty when
   * they cannot be predicted. See `matchCue`. */
  cue: string;
  /** The role the user expects that item to have ("button", "link"…), when it can be told from common conventions. */
  cueRole?: CueRole;
  /** The state the item should be in when the task is done ("checked"…). */
  cueState?: CueState;
  /**
   * Whether the task ends by activating something (pressing a button, opening a disclosure, checking a box). A task that only
   * moves offers the executor no activation: a decision model otherwise presses items whose words resemble the goal. Unset: both.
   */
  activates?: boolean;
  /**
   * The movement actions the executor may use on this task (for example `heading.next`): the plan's navigation method, enforced.
   * A decision model otherwise ignores "move by headings" and pages item by item, or swings between next and previous. Unset: all.
   */
  moves?: string[];
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
  phases: { title: string; criteria?: string[]; tasks: { keep?: string; goal: string; done: string; cue?: string | DraftCue; activates?: boolean; moves?: string[]; serves?: string[]; relies?: string[] }[] }[];
};

const open = (t: PlanTask) => t.status === 'pending' || t.status === 'active';
export const planTasks = (doc: PlanDocument): PlanTask[] => doc.phases.flatMap(p => p.tasks);
export const currentTask = (doc: PlanDocument): PlanTask | undefined => planTasks(doc).find(t => t.id === doc.current);
export const phaseOf = (doc: PlanDocument, taskId: string): PlanPhase | undefined => doc.phases.find(p => p.tasks.some(t => t.id === taskId));

/**
 * Applies a planner draft. Kept tasks keep their id, status and action count; finished tasks the draft leaves out are retired
 * as they were; open tasks it leaves out are abandoned. Criteria and assumptions keep their id; a settled assumption stays
 * settled, and stays in the document when the draft leaves it out (the planner lists what the plan still relies on). Tasks are
 * renumbered by phase, and the first open task becomes current.
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
  const listed = new Set(assumptions.map(a => a.id));
  for (const old of doc?.assumptions ?? []) if (old.status !== 'open' && !listed.has(old.id)) assumptions.push(structuredClone(old));
  const phases: PlanPhase[] = draft.phases.map((phase, i) => ({ id: `p${version}.${i + 1}`, number: String(i + 1), title: phase.title, criteria: phase.criteria ?? [],
    ...(checkpointOf.get(phase.title) ? { checkpoint: checkpointOf.get(phase.title)! } : {}),
    tasks: phase.tasks.map((task, j): PlanTask => {
      const number = `${i + 1}.${j + 1}`, serves = task.serves ?? [], relies = task.relies ?? [];
      const old = task.keep !== undefined ? previous.get(task.keep) : undefined;
      if (old && !kept.has(old.id)) { kept.add(old.id); return { ...structuredClone(old), number, serves, relies, status: old.status === 'active' ? 'pending' : old.status }; }
      const id = `t${++next}`; added.push(id);
      return { id, number, goal: task.goal, done: task.done, ...draftCue(task.cue), ...(task.activates !== undefined ? { activates: task.activates } : {}), ...(task.moves?.length ? { moves: task.moves.map(move => move.replace(/^intent:/, '')) } : {}), serves, relies, status: 'pending', actions: 0, rejected: 0, addedIn: version };
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
/** Roles a cue may name, with the words a screen reader says for each (any one of the word groups). `text` is plain text: no role. */
const ROLE_WORDS = {
  button: [['button']], link: [['link']], checkbox: [['checkbox']], radio: [['radio']], heading: [['heading']], tab: [['tab']], image: [['image']],
  'text field': [['text', 'field'], ['edit', 'text'], ['search', 'field']], 'menu item': [['menu', 'item']], 'combo box': [['combo', 'box'], ['pop', 'up', 'button']], text: [],
} as const satisfies Record<string, readonly (readonly string[])[]>;
export type CueRole = keyof typeof ROLE_WORDS;
export const CUE_STATES = ['checked', 'unchecked', 'expanded', 'collapsed', 'selected'] as const;
export type CueState = typeof CUE_STATES[number];
/** A cue as the planner writes it: the name it expects to hear, and the role and state when it can tell them. */
export type DraftCue = { name: string; role?: string; state?: string };
const ROLE_ALIASES: Record<string, CueRole> = { 'radio button': 'radio', textbox: 'text field', 'text box': 'text field', 'search field': 'text field', input: 'text field',
  combobox: 'combo box', 'pop-up button': 'combo box', menuitem: 'menu item', 'plain text': 'text', paragraph: 'text', static: 'text' };
/** The planner's cue as task fields; a role or state Rawstep does not know is dropped (the name still counts). */
function draftCue(cue: string | DraftCue | undefined): Pick<PlanTask, 'cue' | 'cueRole' | 'cueState'> {
  if (!cue) return { cue: '' };
  if (typeof cue === 'string') return { cue: cue.trim() };
  const role = cue.role?.trim().toLowerCase(), state = cue.state?.trim().toLowerCase() as CueState | undefined;
  const known = role && (role in ROLE_WORDS ? role as CueRole : ROLE_ALIASES[role]);
  return { cue: cue.name.trim(), ...(known ? { cueRole: known } : {}), ...(state && CUE_STATES.includes(state) ? { cueState: state } : {}) };
}
/** The cue as one line, for the executor and the plan document: "Add to cart (button)". */
export function cueText(task: Pick<PlanTask, 'cue' | 'cueRole' | 'cueState'>): string {
  const extra = [task.cueRole, task.cueState].filter(Boolean).join(', ');
  return task.cue ? `${task.cue}${extra ? ` (${extra})` : ''}` : extra ? `(${extra})` : '';
}

const ROLE_TOKENS = new Set(['button', 'link', 'checkbox', 'radio', 'heading', 'tab', 'image', 'field', 'menu', 'combo', 'group', 'navigation', 'list', 'region', 'banner', 'search', 'edit']);
/** Words a screen reader adds to names: roles, states, levels, and small words that say nothing about which item it is. */
const NOT_NAME = new Set([...ROLE_TOKENS, ...CUE_STATES, 'level', 'item', 'items', 'text', 'up', 'pop', 'box', 'main', 'dimmed', 'visited',
  'the', 'and', 'for', 'with', 'your', 'you', 'this', 'that', 'of', 'to', 'on', 'in', 'a', 'an']);
const tokens = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Name words: numbers count ("Cart, 1 item"), except a heading's level number. */
const nameWords = (text: string) => new Set(tokens(text).filter((w, i, all) => (w.length > 1 || /\d/.test(w)) && !NOT_NAME.has(w) && all[i - 1] !== 'level')
  .map(w => w.replace(/(?<=..)s$/, '')));
/**
 * How one spoken item compares with a task's cue, the way a person listening would tell. The role and state must be the ones the
 * cue expects ("Cart (0), link" is not the "Add to cart" button; "Special offers, checked" is not "Order updates" checked). Then:
 * - `heard`: every cue name word was said, and either the cue named a role or the item says nothing beyond the cue's words;
 * - `candidate`: some cue name words were said: the cue was written before the item was heard, so its wording is a guess
 *   ("Email notifications for order updates" for "Order updates, unchecked, checkbox") and the planner is asked;
 * - `no`: otherwise. A cue with no name words (only "checked") is heard when all its words were said as words.
 */
/**
 * Whether a spoken item is named as something in the goal, the way a listener who knows what they want notices it whatever they are
 * doing: at least two name words, every one of them in the goal ("Kimchi Fried Rice" while adding one Kimchi Fried Rice). A single
 * word ("Add") or a name with words the goal lacks ("Fried rice and kimbap") is not.
 */
export function goalNamed(goal: string, item: string): boolean {
  const wanted = nameWords(goal), named = nameWords(item);
  return named.size >= 2 && [...named].every(w => wanted.has(w));
}
export function matchCue(task: Pick<PlanTask, 'cue' | 'cueRole' | 'cueState'>, item: string): 'heard' | 'candidate' | 'no' {
  const said = tokens(item);
  if (task.cueRole) {
    const groups: readonly (readonly string[])[] = ROLE_WORDS[task.cueRole];
    const ok = groups.length ? groups.some(group => group.every(w => said.includes(w))) : !said.some(w => ROLE_TOKENS.has(w));
    if (!ok) {
      // Exactly the name in another role: the planner guessed the role ("a heading") but a listener who hears the name stops and
      // wonders, so the planner is asked. A different role with other words ("Cart (0), link" for the cart button) is not the item.
      const cue = nameWords(task.cue), named = nameWords(item);
      return cue.size && cue.size === named.size && [...cue].every(w => named.has(w)) ? 'candidate' : 'no';
    }
  }
  if (task.cueState && !said.includes(task.cueState)) return 'no';
  const cue = nameWords(task.cue), named = nameWords(item);
  if (!cue.size) {
    // A cue with only a role and state ("the unnamed button before Reviews") is heard on any item that has them.
    if (task.cueRole || task.cueState) return 'heard';
    const want = tokens(task.cue); return want.length && want.every(w => said.includes(w)) ? 'heard' : 'no';
  }
  // An item of the expected role with no name at all ("button") might be the one: a listener wonders, so the planner is asked.
  if (task.cueRole && !named.size) return 'candidate';
  const all = [...cue].every(w => named.has(w)), some = [...cue].some(w => named.has(w)), within = [...named].every(w => cue.has(w));
  if (all && (task.cueRole || within)) return 'heard';
  // Worth asking: the whole name among other words, or part of it with nothing that contradicts it ("Add" for "Add Kimchi Fried
  // Rice"). A name with words the cue lacks ("Add Sikhye to cart") is another item, however many words it shares.
  return all || (some && within) ? 'candidate' : 'no';
}
/**
 * Whether a task's completion cue was heard in any spoken line: its `cue`, else words quoted in its "done" (straight or curly
 * quotes). A task with neither cannot be checked.
 */
export function verifyCue(task: Pick<PlanTask, 'cue' | 'cueRole' | 'cueState' | 'done'>, heard: readonly string[]): NonNullable<TaskEnding['verified']> {
  const cues = task.cue || task.cueRole || task.cueState ? [task] : [...task.done.matchAll(/["“”']([^"“”']{2,})["“”']/g)].map(m => ({ cue: m[1]!.trim() })).filter(c => c.cue);
  if (!cues.length) return 'unchecked';
  return cues.some(cue => heard.some(line => matchCue(cue, line) === 'heard')) ? 'heard' : 'not-heard';
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
        `  - done: ${t.done}${t.cue ? ` · cue "${cueText(t)}"` : ''} · actions: ${t.actions}${t.rejected ? ` · claims turned down: ${t.rejected}` : ''}${t.ending?.verified ? ` · cue ${t.ending.verified}` : ''}`);
    }
    lines.push('');
  }
  if (doc.retired.length) lines.push('## Retired', '', ...doc.retired.map(t => `- ${box[t.status]} ${t.number} ${t.goal} (${t.phase}) · actions: ${t.actions}`), '');
  lines.push('## Revisions', '', ...doc.revisions.map(r => `- v${r.version} before step ${r.step} · ${r.trigger}${r.help ? `/${r.help}` : ''}${r.broken.length ? ` · broken ${r.broken.join(', ')}` : ''}${r.met.length ? ` · met ${r.met.join(', ')}` : ''}${r.rationale ? ` — ${r.rationale}` : ''}`), '');
  return lines.join('\n');
}
