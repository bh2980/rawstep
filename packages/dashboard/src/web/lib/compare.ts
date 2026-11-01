import type { HintTarget } from '@rawstep/reports/hints';
import type { ComparedRun, RunResult, TaskFindings } from '../../shared/api.js';
import type { RunRecord } from '../../shared/config.js';
import { t } from '../i18n/index.js';
import { targetLabel } from '../i18n/labels.js';
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

/** What one side of a comparison (a batch, a task, or the runs picked) amounts to: only runs that left a result count. */
export type Side = { results: readonly RunResult[]; stuck: readonly HintTarget[] };

const sameTarget = (a: HintTarget, b: HintTarget) => a.role === b.role && a.name === b.name;
const unique = (targets: readonly HintTarget[]) => targets.reduce<HintTarget[]>((all, target) => all.some(other => sameTarget(other, target)) ? all : [...all, target], []);
const median = (values: readonly number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** A side made of one batch's findings: its finished runs and its stuck places. */
export const sideOfFindings = (findings: Pick<TaskFindings, 'results' | 'stuck'>): Side => ({ results: findings.results, stuck: findings.stuck.map(place => place.target) });

/** A side made of picked runs: the ones with a result, and every element their users got stuck on. */
export function sideOfRuns(runs: readonly ComparedRun[]): Side {
  return { results: runs.flatMap(run => run.result ? [run.result] : []), stuck: unique(runs.flatMap(run => run.stuck.map(item => item.target))) };
}

const reachedMoves = (side: Side) => side.results.flatMap(result => result.ending === 'reached' && result.steps !== null ? [result.steps] : []);
const reachedCount = (side: Side) => side.results.filter(result => result.ending === 'reached').length;
const longestStretch = (side: Side) => { const values = side.results.flatMap(result => result.stretch === null ? [] : [result.stretch]); return values.length ? Math.max(...values) : null; };

/** Up to three elements by name, then "and n more"; "none" when there are none. */
function listOf(targets: readonly HintTarget[]): string {
  if (!targets.length) return t('compareSummary.none');
  const names = targets.slice(0, 3).map(target => targetLabel(target)).join(', ');
  return targets.length > 3 ? t('compareSummary.more', { list: names, n: targets.length - 3 }) : names;
}

/**
 * What changed between two sides, as short sentences built only from their counts: how many runs reached the goal, what reaching it
 * cost, the longest stretch without a goal word, and which stuck places went away or appeared. It says nothing about which side is better.
 */
export function describeChange(first: Side, second: Side, labels: { first: string; second: string }): string[] {
  const empty = [first, second].flatMap((side, index) => side.results.length === 0 ? [index === 0 ? labels.first : labels.second] : []);
  if (empty.length) return [t('compareSummary.noRuns', { side: empty.join(', ') })];
  const lines: string[] = [t('compareSummary.reached', { a: reachedCount(first), aTotal: first.results.length, b: reachedCount(second), bTotal: second.results.length, first: labels.first, second: labels.second, count: first.results.length })];
  const a = median(reachedMoves(first)), b = median(reachedMoves(second));
  if (a !== null && b !== null) lines.push(a === b ? t('compareSummary.movesSame', { a: formatSteps(a) }) : t('compareSummary.moves', { a: formatSteps(a), b: formatSteps(b) }));
  else if (a !== null || b !== null) lines.push(t('compareSummary.movesOne', { side: a !== null ? labels.first : labels.second, n: formatSteps(a ?? b), ...countOf(a ?? b) }));
  const x = longestStretch(first), y = longestStretch(second);
  if (x !== null && y !== null && x !== y) lines.push(t('compareSummary.stretch', { a: x, b: y, count: y }));
  const gone = first.stuck.filter(target => !second.stuck.some(other => sameTarget(target, other))), added = second.stuck.filter(target => !first.stuck.some(other => sameTarget(target, other)));
  lines.push(gone.length || added.length ? t('compareSummary.stuck', { gone: listOf(gone), added: listOf(added) }) : first.stuck.length ? t('compareSummary.stuckSame') : t('compareSummary.stuckNone'));
  return lines;
}

/** What a group of runs shows when there is no before and after to set against each other: the same counts, once. */
export function describeSet(side: Side): string[] {
  if (side.results.length === 0) return [t('compareSummary.setNoRuns')];
  const moves = reachedMoves(side), lines: string[] = [t('compareSummary.setReached', { a: reachedCount(side), total: side.results.length, count: side.results.length })];
  if (moves.length) lines.push(moves.length > 1 && Math.min(...moves) !== Math.max(...moves)
    ? t('compareSummary.setMoves', { min: Math.min(...moves), max: Math.max(...moves), n: formatSteps(median(moves)) })
    : t('compareSummary.setMovesSame', { n: formatSteps(moves[0]), ...countOf(moves[0]) }));
  lines.push(side.stuck.length ? t('compareSummary.setStuck', { list: listOf(side.stuck) }) : t('compareSummary.setStuckNone'));
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
