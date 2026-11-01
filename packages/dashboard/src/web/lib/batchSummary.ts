import type { BatchSummary, CellComparison, SummaryCell, SummaryComparison } from '@rawstep/reports/compare';
import type { TaskBatch } from '../../shared/api.js';
import type { Experiment } from '../../shared/config.js';
import { t } from '../i18n/index.js';
import { targetLabel } from '../i18n/labels.js';
import type { RunRecord } from '../../shared/config.js';
import { isFinished } from './runs.js';
import { finishedEnding } from './runStrip.js';

/** A batch as the pickers name it (`batchLabel`), counting all of its runs, whichever tasks they are of. */
export function experimentBatch(experiment: Experiment): TaskBatch {
  return { experimentId: experiment.id, createdAt: experiment.createdAt, ...(experiment.request.note ? { note: experiment.request.note } : {}),
    ...(experiment.owner ? { via: experiment.owner.via } : {}), runs: experiment.runs.length, finished: experiment.runs.filter(run => isFinished(run)).length };
}

/** Batches newest first, optionally without one (the batch being looked at). */
export const batchesNewestFirst = (experiments: readonly Experiment[], except?: string): Experiment[] =>
  experiments.filter(experiment => experiment.id !== except).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** What a summary cell says in numbers. `measured` leaves out runs that ended on an error: they say nothing about the page. */
export type CellFacts = {
  runs: number; measured: number; reached: number; gaveUp: number; mistaken: number; unmeasured: number; errors: number;
  median: number | null; min: number | null; max: number | null;
};
export function cellFacts(cell: SummaryCell): CellFacts {
  const moves = cell.reachedMoves;
  return { runs: cell.runs, measured: cell.runs - cell.endings.error, reached: cell.endings.reached, gaveUp: cell.endings['gave-up'], mistaken: cell.endings.mistaken,
    unmeasured: cell.endings.unmeasured, errors: cell.endings.error, median: median(moves), min: moves.length ? Math.min(...moves) : null, max: moves.length ? Math.max(...moves) : null };
}

const place = (item: { role: string; name?: string }) => targetLabel({ role: item.role, ...(item.name ? { name: item.name } : {}) });
/** "버튼 “결제” · 3번 중 2번": a stuck place of a cell with the runs it came up in. */
export const stuckText = (cell: SummaryCell, item: SummaryCell['stuck'][number]): string => t('batchSummary.stuckPlace', { place: place(item), runs: item.runs, total: cellFacts(cell).measured });

export type CellChange = { status: 'changed' | 'noise' | 'few'; sentences: string[] };
/**
 * What a cell changed from the baseline, as sentences built from the counts in the user's language (never the English `text` of the
 * comparison). They state the numbers; none says which side is better. A cell with nothing beyond the spread between repeats is noise,
 * or, when neither reach nor moves had enough repeats to be judged, one Rawstep cannot tell.
 */
export function describeCellChange(cell: CellComparison): CellChange {
  const head = cell.head && cellFacts(cell.head), base = cell.base && cellFacts(cell.base);
  const sentences = cell.changes.flatMap(change => {
    switch (change.kind) {
      case 'reach-drop': case 'reach-rise':
        return head && base ? [t('batchSummary.changes.reach', { reached: head.reached, head: head.measured, baseReached: base.reached, base: base.measured })] : [];
      case 'moves-up': case 'moves-down':
        return head && base && cell.movesBand && head.median !== null && base.min !== null && base.max !== null
          ? [t('batchSummary.changes.moves', { median: head.median, low: cell.movesBand[0], high: cell.movesBand[1], min: base.min, max: base.max })] : [];
      case 'stuck-new':
        return change.place && head ? [t('batchSummary.changes.stuckNew', { place: place(change.place), runs: change.place.runs, total: head.measured })] : [];
      case 'stuck-gone':
        return change.place && base ? [t('batchSummary.changes.stuckGone', { place: place(change.place), runs: change.place.runs, total: base.measured })] : [];
      case 'cell-new': return [t('batchSummary.changes.cellNew')];
      case 'cell-gone': return [t('batchSummary.changes.cellGone')];
    }
  });
  if (sentences.length) return { status: 'changed', sentences };
  return { status: cell.reach === 'too-few-runs' && cell.moves !== 'within-noise' ? 'few' : 'noise', sentences };
}
/** The words for a cell with no change beyond noise. */
export const noChangeText = (status: 'noise' | 'few'): string => t(status === 'noise' ? 'batchSummary.compare.noise' : 'batchSummary.compare.few');

/** The comparison's cell for a task under a profile, if the two summaries share it. */
export const comparisonCell = (comparison: SummaryComparison, cell: Pick<SummaryCell, 'taskId' | 'profileId'>): CellComparison | undefined =>
  comparison.cells.find(item => item.taskId === cell.taskId && item.profileId === cell.profileId);

// --- Files ---

const formula = /^[=+\-@\t\r]/;
/** One CSV field (RFC 4180): quoted when it holds a comma, quote or line break. Text a spreadsheet would run as a formula gets a leading apostrophe. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = formula.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
/** Rows of fields as CSV text, with CRLF line ends. */
export const csvText = (rows: readonly (readonly (string | number | null | undefined)[])[]): string => rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';

const placeName = (item: { role: string; name?: string }) => `${item.role}${item.name ? ` "${item.name}"` : ''}`;
/** The columns of the summary CSV: stable English names (a file other tools read), not the words of the screen. */
export const SUMMARY_CSV_COLUMNS = ['batch', 'date', 'task', 'profile', 'runs', 'reached', 'gave_up', 'said_done_not_reached', 'not_measured', 'errors', 'median_moves', 'min_moves', 'max_moves', 'stuck_places', 'page_findings'] as const;
/** One row per task × profile of a summary. */
export function summaryCsv(summary: BatchSummary): string {
  return csvText([SUMMARY_CSV_COLUMNS, ...summary.cells.map(cell => { const f = cellFacts(cell);
    return [summary.batch.note ?? summary.batch.id, summary.batch.createdAt, cell.taskName, cell.profileName, f.runs, f.reached, f.gaveUp, f.mistaken, f.unmeasured, f.errors, f.median, f.min, f.max,
      cell.stuck.map(item => `${placeName(item)} (${item.runs}/${f.measured})`).join('; '), cell.pageFindings.length]; })]);
}

/** One run of the run export. */
export type RunExportRow = {
  task: string; profile: string; run: number | undefined; date: string; ending: string;
  moves: number | undefined; pageFindings: number | undefined; folder: string;
};
/** How a run ended as a code for a file: its ending, `error` for a run that stopped on an error, otherwise its state (cancelled, interrupted, queued, running). */
export function runEndingCode(run: Pick<RunRecord, 'state' | 'outcome'>): string {
  return finishedEnding(run)?.ending ?? (run.state === 'failure' ? 'error' : run.state);
}
/** Where a run's files are, relative to the project folder. */
export const runFolder = (experimentId: string, runId: string): string => `.rawstep/experiments/${experimentId}/${runId}`;
export const RUN_CSV_COLUMNS = ['task', 'profile', 'run', 'date', 'ending', 'moves', 'page_findings', 'folder'] as const;
/** One row per picked run. `ending` is reached, gave-up, mistaken, unmeasured, error, or the run's state when it has no ending. */
export function runsCsv(rows: readonly RunExportRow[]): string {
  return csvText([RUN_CSV_COLUMNS, ...rows.map(row => [row.task, row.profile, row.run, row.date, row.ending, row.moves, row.pageFindings, row.folder])]);
}

/** `rawstep-summary-2026-11-01.json`: the local date of an ISO time (today's when it cannot be read). */
export function exportName(prefix: string, iso: string | undefined, extension: 'json' | 'csv'): string {
  const time = iso ? new Date(iso) : new Date(), date = Number.isFinite(time.getTime()) ? time : new Date(), pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${extension}`;
}
