import { describe, expect, it } from 'vitest';
import { buildBatchSummary, compareSummaries, gatedChanges, junitXml, summaryMarkdown, validateBatchSummary, type BatchSummary, type SummaryCell, type SummaryRun } from '@rawstep/reports/compare';
import type { Hint } from '@rawstep/reports/hints';

const batch = (id: string, note?: string) => ({ id, createdAt: '2026-11-01T00:00:00.000Z', ...(note ? { note } : {}) });
/** A cell with the given reached moves and other endings. */
function cell(taskId: string, reached: number[], others: Partial<SummaryCell['endings']> = {}, stuck: SummaryCell['stuck'] = []): SummaryCell {
  const endings = { reached: reached.length, 'gave-up': 0, mistaken: 0, unmeasured: 0, error: 0, ...others };
  return { taskId, taskName: taskId, profileId: 'p', profileName: 'Item by item', runs: Object.values(endings).reduce((a, b) => a + b, 0), endings, reachedMoves: reached, stuck, pageFindings: [] };
}
const summary = (id: string, cells: SummaryCell[]): BatchSummary => ({ schemaVersion: '1.0', batch: batch(id), cells });

describe('batch summaries compared with the spread between repeats in mind', () => {
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
    expect(markdown).toContain('| pay | Item by item | reached 1 of 3 · gave up 2 · median 11 moves | **Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline.** |');
    // All not measured is nothing to compare, not a drop.
    expect(markdown).toContain('| search | Item by item | nothing measured · not measured 2 | too few runs to tell |');
    expect(markdown).toContain('1 change caught by --fail-on reach (in bold).');
    const junit = junitXml(head, compared, ['reach']);
    expect(junit).toContain('tests="2" failures="1" errors="0" skipped="1"');
    expect(junit).toContain('<testcase classname="rawstep" name="pay · Item by item"><failure message="Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline."/>');
    expect(junitXml(head)).toContain('failures="0"');
  });
});
