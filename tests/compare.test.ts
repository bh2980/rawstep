import { describe, expect, it } from 'vitest';
import { goalUnconfirmed, runEnding, runMoves } from '@rawstep/reports/endings';
import { buildBatchSummary, cellText, compareSummaries, gatedChanges, junitXml, notComparedText, summaryMarkdown, uncheckedCells, validateBatchSummary, type BatchSummary, type SummaryCell, type SummaryRun } from '@rawstep/reports/compare';
import type { Hint } from '@rawstep/reports/hints';

const batch = (id: string, note?: string) => ({ id, createdAt: '2026-11-01T00:00:00.000Z', ...(note ? { note } : {}) });
/** A cell with the given reached moves and other endings. */
function cell(taskId: string, reached: number[], others: Partial<SummaryCell['endings']> = {}, stuck: SummaryCell['stuck'] = []): SummaryCell {
  const endings = { reached: reached.length, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 0, ...others };
  return { taskId, taskName: taskId, profileId: 'p', profileName: 'Item by item', runs: Object.values(endings).reduce((a, b) => a + b, 0), endings, reachedMoves: reached, stuck, pageFindings: [] };
}
const summary = (id: string, cells: SummaryCell[]): BatchSummary => ({ schemaVersion: '1.0', batch: batch(id), cells });

describe('batch summaries compared with the spread between repeats in mind', () => {
  it('counts a run that passed the goal check as reached, whether or not the user knew', () => {
    const unsure = { status: 'success', reason: 'verified', goalConfirmed: false };
    expect(runEnding({ status: 'success', reason: 'verified' })).toEqual({ ending: 'reached' });
    expect(runEnding(unsure, 'user-gave-up')).toEqual({ ending: 'reached' });
    expect(goalUnconfirmed(unsure)).toBe(true);
    expect(goalUnconfirmed({ status: 'success' })).toBe(false);
    expect(goalUnconfirmed({ status: 'failure', goalConfirmed: false })).toBe(false);
  });
  it('counts what a run cost up to where the goal check passed', () => {
    expect(runMoves({ steps: 7, goalStep: 3 })).toBe(3);
    expect(runMoves({ steps: 7 })).toBe(7);
    expect(runMoves({})).toBeUndefined();
    expect(runMoves(undefined)).toBeUndefined();
  });
  it('sums up a run whose user may not have known as reached, with a note beside the count', () => {
    const run = (outcome: SummaryRun['outcome'], steps: number): SummaryRun => ({ taskId: 't', taskName: 't', profileId: 'p', profileName: 'p', outcome, hints: { steps, hints: [] } });
    const made = buildBatchSummary(batch('b'), [run({ status: 'success', reason: 'verified', goalConfirmed: false }, 3), run({ status: 'success', reason: 'verified' }, 4)]).cells[0]!;
    expect(made).toMatchObject({ runs: 2, endings: { reached: 2 }, reachedMoves: [3, 4], unconfirmed: 1 });
    expect(buildBatchSummary(batch('b'), [run({ status: 'success', reason: 'verified' }, 4)]).cells[0]).not.toHaveProperty('unconfirmed');
  });
  it('tells of a rise in runs not confirmed for reading only: reach stays and no gate catches it', () => {
    const comparison = compareSummaries(summary('a', [cell('t', [10, 11, 12])]), summary('b', [{ ...cell('t', [10, 11, 12]), unconfirmed: 2 }]));
    expect(comparison.cells[0]!.reach).toBe('within-noise');
    expect(comparison.changes.map(change => [change.kind, change.text])).toEqual([['unconfirmed-rise', 'Not confirmed in 2 of 3 runs, against 0 of 3 in the baseline.']]);
    expect(gatedChanges(comparison, ['reach', 'moves', 'stuck', 'missing'])).toEqual([]);
    expect(() => gatedChanges(comparison, ['unconfirmed'])).toThrow('Unknown gate unconfirmed');
    expect(cellText({ ...cell('t', [10, 11, 12]), unconfirmed: 2 })).toContain('reached 3 of 3 (2 not confirmed)');
  });
  it('calls the usability test\'s +3 and +4 moves on unchanged pages noise', () => {
    const base = summary('base', [cell('search', [27, 30]), cell('cart', [26, 34])]);
    const head = summary('head', [cell('search', [30, 30]), cell('cart', [34, 30])]);
    const compared = compareSummaries(base, head);
    expect(compared.cells.map(c => [c.taskId, c.moves, c.movesBand])).toEqual([['search', 'within-noise', [21, 36]], ['cart', 'within-noise', [20, 40]]]);
    expect(compared.changes).toEqual([]);
  });

  it('judges reach only with two measured runs a side, and calls one run going the other way noise', () => {
    const three = cell('t', [10, 11, 12]);
    expect(compareSummaries(summary('a', [three]), summary('b', [cell('t', [10, 11], { 'gave-up': 1 })])).cells[0]!.reach).toBe('within-noise');
    const dropped = compareSummaries(summary('a', [three]), summary('b', [cell('t', [10], { 'gave-up': 2 })]));
    expect(dropped.cells[0]!.reach).toBe('changed');
    expect(dropped.changes.map(c => c.kind)).toEqual(['reach-drop']);
    expect(dropped.changes[0]!.text).toBe('Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline.');
    expect(compareSummaries(summary('a', [cell('t', [10])]), summary('b', [cell('t', [], { 'gave-up': 1 })])).cells[0]!.reach).toBe('too-few-runs');
    // Runs that broke say nothing about the page and are not counted.
    expect(compareSummaries(summary('a', [three]), summary('b', [cell('t', [10, 11], { error: 4 })])).cells[0]!.reach).toBe('within-noise');
  });

  it('marks moves well outside the baseline, new and gone stuck places, and tasks missing on a side', () => {
    const button = { role: 'button', name: 'Pay', runs: 2 };
    const base = summary('a', [cell('pay', [10, 12], {}, [{ role: 'link', name: 'Cart', runs: 2 }]), cell('gone', [5, 5])]);
    const head = summary('b', [cell('pay', [30, 34], {}, [button]), cell('new', [5, 5])]);
    const kinds = compareSummaries(base, head).changes.map(c => `${c.taskId}:${c.kind}`);
    expect(kinds).toEqual(['pay:moves-up', 'pay:stuck-new', 'pay:stuck-gone', 'gone:cell-gone', 'new:cell-new']);
    const compared = compareSummaries(base, head);
    expect(gatedChanges(compared, ['reach'])).toEqual([]);
    expect(gatedChanges(compared, ['moves', 'stuck', 'missing']).map(c => c.kind)).toEqual(['moves-up', 'stuck-new', 'cell-gone']);
    expect(() => gatedChanges(compared, ['speed'])).toThrow(/Unknown gate speed/);
  });

  it('sums up runs per task and profile from their outcomes and hints, and reads back its own files only', () => {
    const stuck: Hint = { kind: 'expectation-broken', source: 'model', certainty: 'observed', target: { role: 'button', name: 'Pay' }, steps: [5], summary: '', evidence: [], detail: { pressed: 4 } };
    const focus: Hint = { kind: 'focus-lost', source: 'page', certainty: 'observed', target: { role: 'dialog', name: 'Cart' }, steps: [3], summary: '', evidence: [], detail: {} };
    const run = (outcome: SummaryRun['outcome'], steps: number, hints: Hint[] = []): SummaryRun => ({ taskId: 't', taskName: 'Pay', profileId: 'p', profileName: 'Item by item', outcome, hints: { steps, hints } });
    const built = buildBatchSummary(batch('b', 'button fixed'), [
      run({ status: 'success', reason: 'verified' }, 12, [focus]), run({ status: 'failure', reason: 'policy-stuck', policyStopSource: 'user-gave-up' }, 30, [stuck, focus]),
      run({ status: 'inconclusive', reason: 'maxSteps' }, 40), run({ status: 'failure', reason: 'error' }, 2, [focus]),
    ]);
    expect(built.cells).toEqual([{ taskId: 't', taskName: 'Pay', profileId: 'p', profileName: 'Item by item', runs: 4,
      endings: { reached: 1, 'gave-up': 1, mistaken: 0, unmeasured: 1, error: 1 }, reachedMoves: [12], stuck: [{ role: 'button', name: 'Pay', runs: 1 }],
      pageFindings: [{ kind: 'focus-lost', role: 'dialog', name: 'Cart', runs: 2 }] }]);
    expect(validateBatchSummary(JSON.parse(JSON.stringify(built)))).toEqual(built);
    expect(() => validateBatchSummary({ schemaVersion: '0.1', cells: [] })).toThrow(/Not a Rawstep batch summary/);
  });

  it('writes a job summary table and JUnit cases that fail only on what a gate caught', () => {
    const base = summary('a', [cell('pay', [10, 11, 12]), cell('search', [20, 21])]);
    const head: BatchSummary = { ...summary('b', [cell('pay', [11], { 'gave-up': 2 }), cell('search', [], { unmeasured: 2 })]), batch: batch('b', 'redesign | v2') };
    const compared = compareSummaries(base, head);
    const markdown = summaryMarkdown(head, compared, ['reach']);
    expect(markdown).toContain('Batch: redesign \\| v2');
    expect(markdown).toContain('| pay | Item by item | reached 1 of 3 · gave up 2 · median 11 moves | **Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline.**<br>moves not compared: the new batch reached the goal in 1 of 3 measured runs (2 needed) |');
    // All not measured is nothing to compare, not a drop.
    expect(markdown).toContain('| search | Item by item | nothing measured · not measured 2 | reach and moves not compared: the new batch has 0 measured runs of 2 (2 not measured) |');
    expect(markdown).toContain('1 change caught by --fail-on reach (in bold).\nNot compared for 1 task·profile pair: the gate could not check them.');
    const junit = junitXml(head, compared, ['reach']);
    expect(junit).toContain('tests="2" failures="1" errors="0" skipped="1"');
    expect(junit).toContain('<testcase classname="rawstep" name="pay · Item by item"><failure message="Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline."/>');
    expect(junit).toContain('<skipped message="not measured"/><system-out>nothing measured · not measured 2 · reach and moves not compared: the new batch has 0 measured runs of 2 (2 not measured)</system-out>');
    expect(junitXml(head)).toContain('failures="0"');
  });

  it('says which side had too few measured runs, and hints to repeat only when the repeats were too few', () => {
    // The usability retest: the baseline's planner timed out on every run, the new batch gave up with a new stuck place.
    const image = { role: 'image', runs: 2 };
    const unmeasured = compareSummaries(summary('a', [cell('signup', [], { unmeasured: 2 })]), summary('b', [cell('signup', [], { 'gave-up': 2 }, [image])]));
    const signup = unmeasured.cells[0]!;
    expect(signup.changes.map(c => c.kind)).toEqual(['stuck-new']);
    expect(notComparedText(signup)).toBe('reach and moves not compared: the baseline has 0 measured runs of 2 (2 not measured)');
    expect(uncheckedCells(unmeasured, ['reach', 'moves'])).toEqual([signup]);
    expect(uncheckedCells(unmeasured, ['stuck'])).toEqual([]);
    const once = compareSummaries(summary('a', [cell('t', [10])]), summary('b', [cell('t', [], { 'gave-up': 1 })])).cells[0]!;
    expect(notComparedText(once)).toBe('reach and moves not compared: the baseline has 1 measured run of 1 and the new batch has 1 measured run of 1; repeat at least 2');
    const fewReached = compareSummaries(summary('a', [cell('t', [10, 11])]), summary('b', [cell('t', [10], { 'gave-up': 1 })])).cells[0]!;
    expect(fewReached.reach).toBe('within-noise');
    expect(notComparedText(fewReached)).toBe('moves not compared: the new batch reached the goal in 1 of 2 measured runs (2 needed)');
    expect(notComparedText(compareSummaries(summary('a', [cell('t', [10, 11])]), summary('b', [cell('t', [10, 12])])).cells[0]!)).toBeUndefined();
  });
});
