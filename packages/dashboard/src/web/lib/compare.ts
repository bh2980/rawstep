import type { HintTarget } from '@rawstep/reports/hints';
import { compareSummaries, SUMMARY_SCHEMA_VERSION, type BatchSummary, type SummaryCell } from '@rawstep/reports/compare';
import { isMeasured, median } from '@rawstep/reports/endings';
import type { ComparedRun, RunResult, TaskFindings } from '../../shared/api.js';
import type { RunRecord } from '../../shared/config.js';
import { t } from '../i18n/index.js';
import { targetLabel } from '../i18n/labels.js';
import { describeCellChange, noChangeText } from './batchSummary.js';
import { countOf, formatSteps } from './format.js';
import { runStartedAt, type RunRef } from './runs.js';

/** The most runs set side by side: more would not fit as columns. */
export const MAX_COMPARE = 8;

/** The parts of a run's recorded conditions, without the profile itself (its name may change while nothing that matters does). */
export const CONDITION_PARTS = ['combo', 'actionSet', 'pageEnvironment', 'atEnvironment', 'runRules'] as const;
export type ConditionPart = (typeof CONDITION_PARTS)[number];

const partOf = (run: Pick<RunRecord, 'snapshot'>, part: ConditionPart) => JSON.stringify((run.snapshot.spec.conditions as Record<string, unknown> | undefined)?.[part] ?? null);

/** Which parts of the recorded conditions differ between the runs of two groups (a part counts when the groups hold different sets of values). */
export function differingParts(a: readonly Pick<RunRecord, 'snapshot'>[], b: readonly Pick<RunRecord, 'snapshot'>[]): ConditionPart[] {
  return CONDITION_PARTS.filter(part => {
    const x = new Set(a.map(run => partOf(run, part))), y = new Set(b.map(run => partOf(run, part)));
    return x.size !== y.size || [...x].some(value => !y.has(value));
  });
}

/** Which parts of the recorded conditions are not the same in every one of these runs. */
export function varyingParts(runs: readonly Pick<RunRecord, 'snapshot'>[]): ConditionPart[] {
  return CONDITION_PARTS.filter(part => new Set(runs.map(run => partOf(run, part))).size > 1);
}

/** One run of a side: its result and the elements its user got stuck on. */
export type SideRun = { result: RunResult; stuck: readonly HintTarget[] };
/** What one side of a comparison (a batch, a task, or the runs picked) holds: the runs that left a result. */
export type Side = readonly SideRun[];

const sameTarget = (a: HintTarget, b: HintTarget) => a.role === b.role && a.name === b.name;
const unique = (targets: readonly HintTarget[]) => targets.reduce<HintTarget[]>((all, target) => all.some(other => sameTarget(other, target)) ? all : [...all, target], []);

/** A side made of one batch's findings: its finished runs, each with the stuck places it met. */
export const sideOfFindings = (findings: Pick<TaskFindings, 'results' | 'stuck'>): Side =>
  findings.results.map(result => ({ result, stuck: unique(result.stuck.flatMap(item => findings.stuck[item.place] ? [findings.stuck[item.place]!.target] : [])) }));

/** A side made of picked runs: the ones with a result, each with every element its user got stuck on. */
export function sideOfRuns(runs: readonly ComparedRun[]): Side {
  return runs.flatMap(run => run.result ? [{ result: run.result, stuck: unique(run.stuck.map(item => item.target)) }] : []);
}

const reachedMoves = (side: Side) => side.flatMap(({ result }) => result.ending === 'reached' && result.steps !== null ? [result.steps] : []);
const reachedCount = (side: Side) => side.filter(({ result }) => result.ending === 'reached').length;
/** The M of "reached N of M": the runs that said something about the user, as everywhere else. A run that was not measured is not in it. */
const measuredCount = (side: Side) => side.filter(({ result }) => isMeasured(result)).length;
const stuckPlaces = (side: Side) => unique(side.flatMap(run => run.stuck));

/** Up to three elements by name, then "and n more"; "none" when there are none. */
function listOf(targets: readonly HintTarget[]): string {
  if (!targets.length) return t('compareSummary.none');
  const names = targets.slice(0, 3).map(target => targetLabel(target)).join(', ');
  return targets.length > 3 ? t('compareSummary.more', { list: names, n: targets.length - 3 }) : names;
}

/**
 * A side as the cells of a batch summary: one per run profile (results of different users are never mixed), or one for the whole
 * side when the runs were picked by hand. Results hold no run that broke, so no cell has an error.
 */
function cellsOf(side: Side, byProfile: boolean, profileName: (id: string) => string): SummaryCell[] {
  const groups = new Map<string, SideRun[]>();
  for (const run of side) { const key = byProfile ? run.result.profileId : ''; groups.set(key, [...groups.get(key) ?? [], run]); }
  return [...groups].map(([profileId, runs]) => {
    const endings: SummaryCell['endings'] = { reached: 0, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 0 };
    for (const { result } of runs) endings[result.ending]++;
    return {
      taskId: 'side', taskName: '', profileId, profileName: profileId ? profileName(profileId) : '', runs: runs.length, endings, reachedMoves: reachedMoves(runs),
      stuck: stuckPlaces(runs).map(target => ({ role: target.role, ...(target.name ? { name: target.name } : {}), runs: runs.filter(run => run.stuck.some(other => sameTarget(other, target))).length })),
      pageFindings: [],
    };
  });
}

/**
 * What changed between two sides beyond the spread between repeats, as sentences. The first side is the baseline. It is judged by the
 * batch summary's own comparison (`compareSummaries`: its noise rules, its counting) and worded with its words, so the same two
 * batches read the same here as on the batch summary page: there is one engine, not a second one with rules of its own. It says
 * nothing about which side is better. With `byProfile`, each run profile is compared with itself and named.
 */
export function describeChange(first: Side, second: Side, labels: { first: string; second: string }, options: { byProfile?: boolean; profileName?: (id: string) => string } = {}): string[] {
  const empty = [first, second].flatMap((side, index) => side.length === 0 ? [index === 0 ? labels.first : labels.second] : []);
  if (empty.length) return [t('compareSummary.noRuns', { side: empty.join(', ') })];
  const summary = (id: string, side: Side): BatchSummary => ({ schemaVersion: SUMMARY_SCHEMA_VERSION, batch: { id, createdAt: '' }, cells: cellsOf(side, options.byProfile === true, options.profileName ?? (id => id)) });
  const cells = compareSummaries(summary('first', first), summary('second', second)).cells.map(cell => ({ cell, change: describeCellChange(cell) }));
  const sides = t('compareSummary.sides', { first: labels.first, second: labels.second });
  const changed = cells.filter(item => item.change.status === 'changed');
  if (!changed.length) return [sides, noChangeText(cells.some(item => item.change.status === 'noise') ? 'noise' : 'few')];
  return [sides, ...changed.flatMap(({ cell, change }) => change.sentences.map(sentence => cells.length > 1 && cell.profileName ? `${cell.profileName}: ${sentence}` : sentence))];
}

/** What a group of runs shows when there is no before and after to set against each other: the same counts, once. */
export function describeSet(side: Side): string[] {
  if (side.length === 0) return [t('compareSummary.setNoRuns')];
  const moves = reachedMoves(side), stuck = stuckPlaces(side), lines: string[] = [t('compareSummary.setReached', { a: reachedCount(side), total: measuredCount(side), count: measuredCount(side) })];
  if (moves.length) lines.push(moves.length > 1 && Math.min(...moves) !== Math.max(...moves)
    ? t('compareSummary.setMoves', { min: Math.min(...moves), max: Math.max(...moves), n: formatSteps(median(moves)) })
    : t('compareSummary.setMovesSame', { n: formatSteps(moves[0]), ...countOf(moves[0]) }));
  lines.push(stuck.length ? t('compareSummary.setStuck', { list: listOf(stuck) }) : t('compareSummary.setStuckNone'));
  return lines;
}

/** A run picked for comparison with everything the view needs to name it. */
export type CompareRun = { ref: RunRef; taskName: string; compared: ComparedRun | undefined };
export type CompareGroup = { key: string; label: string; items: CompareRun[] };

/**
 * The picked runs, oldest first, split into the sides to set against each other: by task when they come from several tasks (a task
 * made before a fix and one made after), otherwise by batch. One group means there is nothing to set against, and the runs are only described.
 */
export function groupRuns(items: readonly CompareRun[]): { by: 'task' | 'batch'; groups: CompareGroup[] } {
  const sorted = [...items].sort((a, b) => runStartedAt(a.ref) - runStartedAt(b.ref) || a.ref.run.repeat - b.ref.run.repeat);
  const byTask = new Set(sorted.map(item => item.ref.run.taskId)).size > 1, by = byTask ? 'task' : 'batch';
  const groups = new Map<string, CompareGroup>();
  for (const item of sorted) {
    const key = byTask ? item.ref.run.taskId : item.ref.experiment.id, group = groups.get(key);
    if (group) group.items.push(item); else groups.set(key, { key, label: item.taskName, items: [item] });
  }
  const list = [...groups.values()];
  // Runs of one task picked from the history say nothing of a change in between, so they are earlier and later, not before and
  // after; tasks are named.
  if (!byTask) list.forEach((group, index) => { group.label = list.length === 2 ? t(index === 0 ? 'compareSummary.earlier' : 'compareSummary.later') : group.label; });
  return { by, groups: list };
}

/** The sentences at the top of a comparison of picked runs. */
export function describeRuns(items: readonly CompareRun[]): string[] {
  const { groups } = groupRuns(items), side = (group: CompareGroup) => sideOfRuns(group.items.flatMap(item => item.compared ? [item.compared] : []));
  if (groups.length === 2) return describeChange(side(groups[0]!), side(groups[1]!), { first: groups[0]!.label, second: groups[1]!.label });
  return describeSet(sideOfRuns(items.flatMap(item => item.compared ? [item.compared] : [])));
}

/** What differs between the picked runs that could explain a difference in the numbers: the profile, the task's goal and the rest of the conditions. */
export type CompareDifferences = { profiles: string[]; goals: string[]; parts: ConditionPart[] };
export function compareDifferences(items: readonly { run: RunRecord; profile: string }[]): CompareDifferences {
  const goals = [...new Set(items.map(item => String(item.run.snapshot.spec.task.goal ?? '').trim()))];
  const profiles = [...new Set(items.map(item => item.profile))];
  return { profiles: profiles.length > 1 ? profiles : [], goals: goals.length > 1 ? goals : [], parts: varyingParts(items.map(item => item.run)) };
}
