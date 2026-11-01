/**
 * A batch summed up per task and profile (`BatchSummary`), and two summaries compared with the spread between repeats in mind, so a
 * difference one run going the other way explains is called noise, not a change. Nothing here says which side is better: it says
 * what changed beyond noise. Pure and free of Node APIs, so the dashboard uses it too.
 */
import type { Hint, HintTarget } from '../hints/index.js';
import { isStuck, runEnding, type RunEnding } from '../endings/index.js';

export const SUMMARY_SCHEMA_VERSION = '1.0' as const;
/** How the runs of one task under one profile ended, a run that broke counted apart: it says nothing about the page. */
export type SummaryEndings = Record<RunEnding | 'error', number>;
/** A page element with how many of the cell's runs it came up in. */
export type SummaryPlace = { role: string; name?: string; runs: number };
/** One task under one profile. */
export type SummaryCell = {
  taskId: string; taskName: string; profileId: string; profileName: string;
  runs: number;
  endings: SummaryEndings;
  /** Moves of each run that reached the goal, in run order. */
  reachedMoves: number[];
  /** Where pressing did not respond as the user expected. */
  stuck: SummaryPlace[];
  /** Page findings (focus, announcements, dialogs…) by kind and element. */
  pageFindings: (SummaryPlace & { kind: string })[];
};
export type BatchSummary = {
  schemaVersion: typeof SUMMARY_SCHEMA_VERSION;
  batch: { id: string; createdAt: string; note?: string };
  cells: SummaryCell[];
};
/** A finished run as the summary reads it. */
export type SummaryRun = {
  taskId: string; taskName: string; profileId: string; profileName: string;
  outcome: { status: string; reason?: string; policyStopSource?: string } | undefined;
  hints: { steps: number; hints: readonly Hint[] };
};

const brokeRun = (outcome: SummaryRun['outcome']) => !outcome || outcome.status === 'aborted' || outcome.reason === 'error' || outcome.reason === 'trace-persistence-error';
const placeKey = (target: HintTarget | undefined) => target ? `${target.role}\u0000${target.name ?? ''}` : '';
/** Elements and how many runs each came up in, from one hint list per run. */
function places(perRun: readonly (readonly Hint[])[], pick: (hint: Hint) => boolean, keyOf: (hint: Hint) => string = hint => placeKey(hint.target)) {
  const counts = new Map<string, { hint: Hint; runs: number }>();
  for (const hints of perRun) for (const key of new Set(hints.filter(hint => hint.target && pick(hint)).map(keyOf))) {
    const hint = hints.find(h => h.target && pick(h) && keyOf(h) === key)!;
    counts.set(key, { hint, runs: (counts.get(key)?.runs ?? 0) + 1 });
  }
  return [...counts.values()];
}

/** Sums up a batch's runs per task and profile, in the order the runs come. */
export function buildBatchSummary(batch: BatchSummary['batch'], runs: readonly SummaryRun[]): BatchSummary {
  const cells: SummaryCell[] = [];
  const groups = new Map<string, SummaryRun[]>();
  for (const run of runs) { const key = `${run.taskId}\u0000${run.profileId}`; groups.set(key, [...groups.get(key) ?? [], run]); }
  for (const group of groups.values()) {
    const first = group[0]!, endings: SummaryEndings = { reached: 0, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 0 }, reachedMoves: number[] = [];
    for (const run of group) {
      if (brokeRun(run.outcome)) { endings.error++; continue; }
      const ended = runEnding(run.outcome, run.outcome!.policyStopSource)!;
      endings[ended.ending]++;
      if (ended.ending === 'reached') reachedMoves.push(run.hints.steps);
    }
    const counted = group.filter(run => !brokeRun(run.outcome)).map(run => run.hints.hints);
    const stuck = places(counted, hint => hint.kind === 'expectation-broken' && isStuck(hint)).map(({ hint, runs }) => ({ role: hint.target!.role, ...(hint.target!.name ? { name: hint.target!.name } : {}), runs }));
    const pageFindings = places(counted, hint => hint.source === 'page', hint => `${hint.kind}\u0000${placeKey(hint.target)}`)
      .map(({ hint, runs }) => ({ kind: hint.kind, role: hint.target!.role, ...(hint.target!.name ? { name: hint.target!.name } : {}), runs }));
    cells.push({ taskId: first.taskId, taskName: first.taskName, profileId: first.profileId, profileName: first.profileName, runs: group.length, endings, reachedMoves, stuck, pageFindings });
  }
  return { schemaVersion: SUMMARY_SCHEMA_VERSION, batch, cells };
}

/** Checks that a parsed file is a batch summary this Rawstep reads. */
export function validateBatchSummary(value: unknown): BatchSummary {
  const v = value as Partial<BatchSummary> | undefined;
  if (!v || typeof v !== 'object' || v.schemaVersion !== SUMMARY_SCHEMA_VERSION || !v.batch || !Array.isArray(v.cells)) throw new Error(`Not a Rawstep batch summary (schemaVersion ${SUMMARY_SCHEMA_VERSION}).`);
  for (const cell of v.cells) if (!cell || typeof cell.taskId !== 'string' || typeof cell.profileId !== 'string' || !Array.isArray(cell.reachedMoves) || !cell.endings) throw new Error('A batch summary cell is not in the right format.');
  return v as BatchSummary;
}

/** What can change between two summaries; a gate (`--fail-on`) picks the ones that fail a CI job. */
export type ChangeKind = 'reach-drop' | 'reach-rise' | 'moves-up' | 'moves-down' | 'stuck-new' | 'stuck-gone' | 'cell-new' | 'cell-gone';
export type Change = { kind: ChangeKind; taskId: string; taskName: string; profileId: string; profileName: string; text: string; place?: SummaryPlace };
/** How a cell compares: changed beyond noise, within noise, or too few runs on a side to tell. */
export type CellComparison = {
  taskId: string; taskName: string; profileId: string; profileName: string;
  base?: SummaryCell; head?: SummaryCell;
  reach: 'changed' | 'within-noise' | 'too-few-runs' | 'missing';
  moves: 'changed' | 'within-noise' | 'too-few-runs' | 'missing';
  /** The moves a head median can fall in and still be noise, from the base's repeats. */
  movesBand?: [number, number];
  changes: Change[];
};
export type SummaryComparison = { base: BatchSummary['batch']; head: BatchSummary['batch']; cells: CellComparison[]; changes: Change[] };
/** Noise rules; the defaults are what `rawstep compare` uses. */
export type NoiseRules = {
  /** Repeats a side needs before its reach rate is judged. */
  minRuns: number;
  /** The base's range of moves is widened by this share of its median, or by `movesSlack` moves, whichever is more, before a head median counts as changed. */
  movesShare: number; movesSlack: number;
  /** A stuck place counts as new when it came up in at least this share of the head's runs and in none of the base's (gone: the other way). */
  stuckShare: number;
};
export const DEFAULT_NOISE: Readonly<NoiseRules> = Object.freeze({ minRuns: 2, movesShare: 0.2, movesSlack: 3, stuckShare: 0.5 });

/** Runs that said something about the user: reached, gave up, or said done when it was not. Not measured and broken runs did not. */
const counted = (cell: SummaryCell) => cell.endings.reached + cell.endings['gave-up'] + cell.endings.mistaken;
const median = (values: readonly number[]) => { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const placeName = (place: SummaryPlace) => `${place.role}${place.name ? ` "${place.name}"` : ''}`;

/**
 * Compares a head summary with a base one, cell by cell (task × profile). Reach: judged when both sides have `minRuns` measured runs
 * (reached, gave up or said done: a run that was not measured or broke says nothing about the user);
 * a change in the reached share that one run going the other way explains (1 / the smaller side's runs) is noise. Moves: judged when
 * both sides have two runs that reached the goal; the head's median outside the base's range widened by `movesShare` or `movesSlack`
 * is a change. Stuck places: new when in `stuckShare` of the head's runs and none of the base's, gone the other way.
 */
export function compareSummaries(base: BatchSummary, head: BatchSummary, rules: Partial<NoiseRules> = {}): SummaryComparison {
  const r = { ...DEFAULT_NOISE, ...rules };
  const key = (cell: SummaryCell) => `${cell.taskId}\u0000${cell.profileId}`;
  const baseCells = new Map(base.cells.map(cell => [key(cell), cell])), headCells = new Map(head.cells.map(cell => [key(cell), cell]));
  const cells: CellComparison[] = [];
  for (const id of new Set([...baseCells.keys(), ...headCells.keys()])) {
    const b = baseCells.get(id), h = headCells.get(id), named = (h ?? b)!;
    const who = { taskId: named.taskId, taskName: named.taskName, profileId: named.profileId, profileName: named.profileName };
    const change = (kind: ChangeKind, text: string, place?: SummaryPlace): Change => ({ kind, ...who, text, ...(place ? { place } : {}) });
    if (!b || !h) {
      cells.push({ ...who, ...(b ? { base: b } : {}), ...(h ? { head: h } : {}), reach: 'missing', moves: 'missing', changes: [change(b ? 'cell-gone' : 'cell-new', b ? 'Not run in this batch.' : 'Not in the baseline.')] });
      continue;
    }
    const changes: Change[] = [];
    const nb = counted(b), nh = counted(h);
    let reach: CellComparison['reach'] = 'too-few-runs';
    if (nb >= r.minRuns && nh >= r.minRuns) {
      const before = b.endings.reached / nb, after = h.endings.reached / nh;
      // One run going the other way on the smaller side is noise.
      if (Math.abs(after - before) > 1 / Math.min(nb, nh) + 1e-9) {
        reach = 'changed';
        changes.push(change(after < before ? 'reach-drop' : 'reach-rise', `Reached the goal in ${h.endings.reached} of ${nh} runs, against ${b.endings.reached} of ${nb} in the baseline.`));
      } else reach = 'within-noise';
    }
    let moves: CellComparison['moves'] = 'too-few-runs', movesBand: [number, number] | undefined;
    if (b.reachedMoves.length >= 2 && h.reachedMoves.length >= 2) {
      const low = Math.min(...b.reachedMoves), high = Math.max(...b.reachedMoves), slack = Math.max(r.movesSlack, median(b.reachedMoves) * r.movesShare);
      movesBand = [Math.max(0, Math.floor(low - slack)), Math.ceil(high + slack)];
      const m = median(h.reachedMoves);
      if (m < movesBand[0] || m > movesBand[1]) {
        moves = 'changed';
        changes.push(change(m > movesBand[1] ? 'moves-up' : 'moves-down', `Reaching the goal took a median of ${m} moves, outside the baseline's ${movesBand[0]}–${movesBand[1]} (its runs: ${low}–${high}).`));
      } else moves = 'within-noise';
    }
    const inBase = new Map(b.stuck.map(place => [placeName(place), place])), inHead = new Map(h.stuck.map(place => [placeName(place), place]));
    for (const [name, place] of inHead) if (!inBase.has(name) && nh && place.runs / nh >= r.stuckShare) changes.push(change('stuck-new', `New stuck place: ${name}, in ${place.runs} of ${nh} runs.`, place));
    for (const [name, place] of inBase) if (!inHead.has(name) && nb && place.runs / nb >= r.stuckShare) changes.push(change('stuck-gone', `Stuck place no longer seen: ${name} (was in ${place.runs} of ${nb} runs).`, place));
    cells.push({ ...who, base: b, head: h, reach, moves, ...(movesBand ? { movesBand } : {}), changes });
  }
  return { base: base.batch, head: head.batch, cells, changes: cells.flatMap(cell => cell.changes) };
}

/** The gate names `--fail-on` takes and the changes each one catches. */
export const GATES: Readonly<Record<string, readonly ChangeKind[]>> = Object.freeze({ reach: ['reach-drop'], moves: ['moves-up'], stuck: ['stuck-new'], missing: ['cell-gone'] });
/** The changes a gate catches; an unknown gate name throws with the known ones. */
export function gatedChanges(comparison: SummaryComparison, gates: readonly string[]): Change[] {
  const unknown = gates.filter(gate => !Object.hasOwn(GATES, gate));
  if (unknown.length) throw new Error(`Unknown gate ${unknown.join(', ')}. Use ${Object.keys(GATES).join(', ')}.`);
  const kinds = new Set(gates.flatMap(gate => GATES[gate]!));
  return comparison.changes.filter(change => kinds.has(change.kind));
}

const xml = (text: string) => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
const md = (text: string) => text.replace(/[|\\]/g, c => `\\${c}`).replace(/\n/g, ' ');
/** "2 of 3 reached · median 14 moves (12–16)": a cell in a few words. */
export function cellText(cell: SummaryCell): string {
  const n = counted(cell), others = (['gave-up', 'mistaken', 'unmeasured'] as const).filter(e => cell.endings[e]).map(e => `${e === 'gave-up' ? 'gave up' : e === 'mistaken' ? 'said done, not reached' : 'not measured'} ${cell.endings[e]}`);
  const moves = cell.reachedMoves.length ? ` · median ${median(cell.reachedMoves)} moves${Math.min(...cell.reachedMoves) !== Math.max(...cell.reachedMoves) ? ` (${Math.min(...cell.reachedMoves)}–${Math.max(...cell.reachedMoves)})` : ''}` : '';
  return `${n ? `reached ${cell.endings.reached} of ${n}` : 'nothing measured'}${others.length ? ` · ${others.join(' · ')}` : ''}${cell.endings.error ? ` · ${cell.endings.error} ended on an error` : ''}${moves}`;
}
/**
 * A summary, and a comparison when there is a baseline, as Markdown for a CI job summary (GitHub's step summary): a table per task and
 * profile, then the changes beyond noise with the ones the gates caught marked.
 */
export function summaryMarkdown(summary: BatchSummary, comparison?: SummaryComparison, gates: readonly string[] = []): string {
  const caught = new Set(comparison ? gatedChanges(comparison, gates) : []);
  const lines = ['## Rawstep', '', summary.batch.note ? `Batch: ${md(summary.batch.note)}` : `Batch ${summary.batch.id}`, ''];
  lines.push('| Task | Profile | Result | Against the baseline |', '| --- | --- | --- | --- |');
  for (const cell of summary.cells) {
    const compared = comparison?.cells.find(c => c.taskId === cell.taskId && c.profileId === cell.profileId);
    const against = !comparison ? '' : !compared ? '' : compared.changes.length ? compared.changes.map(change => `${caught.has(change) ? '**' : ''}${md(change.text)}${caught.has(change) ? '**' : ''}`).join('<br>')
      : compared.reach === 'too-few-runs' ? 'too few runs to tell' : 'no change beyond noise';
    lines.push(`| ${md(cell.taskName)} | ${md(cell.profileName)} | ${md(cellText(cell))} | ${against} |`);
  }
  for (const gone of comparison?.cells.filter(c => !c.head) ?? []) lines.push(`| ${md(gone.taskName)} | ${md(gone.profileName)} | not run | ${caught.size && gone.changes.some(c => caught.has(c)) ? '**in the baseline, not run now**' : 'in the baseline, not run now'} |`);
  lines.push('');
  if (comparison) lines.push(caught.size ? `${caught.size} change${caught.size > 1 ? 's' : ''} caught by --fail-on ${gates.join(',')} (in bold).` : `Nothing caught by --fail-on ${gates.join(',') || '(none)'}.`);
  lines.push('Rawstep reports friction, not pass or fail: differences within the spread between repeats are noise.');
  return lines.join('\n') + '\n';
}
/**
 * JUnit XML, one test case per task and profile. A case fails when a gate caught a change in it, errors when a run ended on an error,
 * and is skipped when nothing was measured; otherwise it passes with its result as output.
 */
export function junitXml(summary: BatchSummary, comparison?: SummaryComparison, gates: readonly string[] = []): string {
  const caught = comparison ? gatedChanges(comparison, gates) : [];
  const cases = summary.cells.map(cell => {
    const mine = caught.filter(change => change.taskId === cell.taskId && change.profileId === cell.profileId);
    const name = `${xml(cell.taskName)} · ${xml(cell.profileName)}`, out = `<system-out>${xml(cellText(cell))}</system-out>`;
    if (mine.length) return `    <testcase classname="rawstep" name="${name}"><failure message="${xml(mine.map(c => c.text).join(' '))}"/>${out}</testcase>`;
    if (cell.endings.error) return `    <testcase classname="rawstep" name="${name}"><error message="${cell.endings.error} run(s) ended on an error (says nothing about the page)"/>${out}</testcase>`;
    if (!counted(cell)) return `    <testcase classname="rawstep" name="${name}"><skipped message="not measured"/>${out}</testcase>`;
    return `    <testcase classname="rawstep" name="${name}">${out}</testcase>`;
  });
  const failures = cases.filter(c => c.includes('<failure')).length, errors = cases.filter(c => c.includes('<error')).length, skipped = cases.filter(c => c.includes('<skipped')).length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="rawstep" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">\n${cases.join('\n')}\n  </testsuite>\n</testsuites>\n`;
}
