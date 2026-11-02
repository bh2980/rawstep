import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ProjectConfig } from '@rawstep/project/config';
import type { Experiment } from '../../shared/config';
import { useHintSummaries, useRequestHintSummaries } from '../hooks/useHintSummaries';
import type { RouteChange } from '../hooks/useRoute';
import { formatDate } from '../lib/format';
import { runStatus } from '../lib/runStrip';
import { durationSeconds, isFinished, isLive, runConditions, runModelsName, runStartedAt, runStepCount, taskNameOf, type RunRef } from '../lib/runs';
import { CliMark, startedFromCli } from './CliMark';
import { HintBadge } from './HintBadge';
import { Link } from './Link';
import { Dash } from './PageHeader';
import { StatusMark } from './StatusMark';
import { Time } from './Time';
import { Checkbox } from './ui/checkbox';
import { Table, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type Props = {
  runs: RunRef[]; navigate: (change: RouteChange) => void;
  /** The project's run profiles, for names a run did not record. */
  config?: Partial<Pick<ProjectConfig, 'profiles'>>;
  /** Leaves out the task's name, for a table of one task's runs: the first column is then only the run's number. */
  hideTask?: boolean;
  /** "Run #n" of each run by id, written after the task's name (`Checkout #3`). */
  numbers?: ReadonlyMap<string, number>;
  /** How many runs each task has in all, so a run reads `#3/5` even when the others sit in other batches. */
  totals?: ReadonlyMap<string, number>;
  /** Adds the friction hints of each finished run (one request per run, so only where the list is short). */
  showHints?: boolean;
  /** Adds the run profile column; without it the column names the models. */
  showConditions?: boolean;
  /** Current task names, so a renamed task shows its new name. */
  tasks?: readonly { id: string; name: string }[];
  /** Leaves out the "CLI" mark of runs started from the command line, for a table under a heading that already says so. */
  hideVia?: boolean;
  /** Puts a header row above each batch's runs (time, memo, run count, a link to its summary). Runs must come batch by batch. */
  groupByBatch?: boolean;
  /** Adds a checkbox column. Queued and running runs cannot be picked. */
  selection?: { selected: ReadonlySet<string>; onToggle: (runId: string, on: boolean) => void; onToggleAll: (on: boolean) => void };
};

/** The link of a row, stretched over the whole row: the row is `relative`, so anything else clickable in it needs `relative z-10`. */
const rowLink = 'rounded-sm after:absolute after:inset-0 hover:underline underline-offset-2 focus-visible:outline-none! focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-trace';
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** What ended a run that was not measured first (`시간 한도`), for a status mark's `why`. `by` is one of the recorded stop sources. */
export const stopReason = (t: TFunction, by: string | undefined): string | undefined => by ? t(`taskPage.results.by.${by as 'other'}`) : undefined;

/** Runs in a row of the same batch, in the order given. */
function batchesInOrder(runs: readonly RunRef[]): { experiment: Experiment; runs: RunRef[] }[] {
  const groups: { experiment: Experiment; runs: RunRef[] }[] = [];
  for (const ref of runs) {
    const last = groups[groups.length - 1];
    if (last && last.experiment.id === ref.experiment.id) last.runs.push(ref); else groups.push({ experiment: ref.experiment, runs: [ref] });
  }
  return groups;
}

/**
 * The runs table (spec §31): one 40px line per run with the task and its run number, the run profile, how it ended, the moves, the
 * time it took and when it started. With `groupByBatch` each batch gets a header row inside the same table, so batches stay apart
 * without a table of their own.
 */
export function RunsTable({ runs, config, navigate, hideTask, numbers, totals, showHints, showConditions, hideVia, tasks = [], groupByBatch, selection }: Props) {
  const { t } = useTranslation();
  const hintsFor = useHintSummaries();
  useRequestHintSummaries(showHints ? runs.filter(ref => isFinished(ref.run)).map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })) : []);
  const pickable = selection ? runs.filter(ref => !isLive(ref.run)) : [];
  const picked = pickable.filter(ref => selection!.selected.has(ref.run.id)).length;
  const columns = 6 + (selection ? 1 : 0) + (showHints ? 1 : 0);
  const groups = groupByBatch ? batchesInOrder(runs) : [{ experiment: undefined, runs }];

  const row = (ref: RunRef) => {
    const { run } = ref, steps = runStepCount(run), seconds = durationSeconds(run), hints = hintsFor(run.id) ?? [];
    const open = { task: run.taskId, run: run.id }, started = runStartedAt(ref), label = taskNameOf(run, tasks), number = numbers?.get(run.id);
    const { status, by } = runStatus(run), checked = !!selection?.selected.has(run.id);
    // Every checkbox needs its own name: a list of runs of one task would otherwise read the same name on each row.
    const selectName = `${label}${number !== undefined ? ` #${number}` : ''} · ${formatDate(started)}`;
    return <TableRow key={run.id} data-selected={checked} className="row-rail relative data-[selected=true]:bg-raised">
      {selection && <TableCell>
        <Checkbox className="relative z-10" aria-label={t('runList.select.one', { name: selectName })} disabled={isLive(run)} title={isLive(run) ? t('runList.select.live') : undefined}
          checked={checked} onCheckedChange={on => selection.onToggle(run.id, on === true)} />
      </TableCell>}
      <TableCell className="truncate">
        <Link to={open} navigate={navigate} className={rowLink}>
          {hideTask ? <span className="tabular-nums">#{number ?? '—'}</span>
            : <>{label}{number !== undefined && <span className="ml-1 tabular-nums text-ink-3">#{number}{totals?.has(run.taskId) && `/${totals.get(run.taskId)}`}</span>}</>}
        </Link>
        {!hideVia && !groupByBatch && startedFromCli(ref.experiment) && <CliMark />}
      </TableCell>
      <TableCell className="truncate text-ink-2">{showConditions ? runConditions(run, config).profile : runModelsName(run)}</TableCell>
      <TableCell className="truncate"><StatusMark status={status} why={stopReason(t, by)} /></TableCell>
      <TableCell className="text-right tabular-nums">{steps ?? <Dash />}</TableCell>
      <TableCell className="text-right tabular-nums text-ink-2">{seconds === undefined ? <Dash /> : t('run.duration', { seconds: seconds.toFixed(1) })}</TableCell>
      <TableCell className="text-right tabular-nums text-ink-2"><Time value={started} timeOnly={sameDay(started, Date.parse(ref.experiment.createdAt))} /></TableCell>
      {showHints && <TableCell className="truncate">{hints.length
        ? <span className="flex gap-1 overflow-hidden">{hints.slice(0, 2).map(hint => <HintBadge key={hint.kind} kind={hint.kind} count={hint.count} />)}</span>
        : isFinished(run) && hintsFor(run.id) ? <span className="text-ink-2">{t('runList.noHints')}</span> : <Dash />}</TableCell>}
    </TableRow>;
  };

  const header = (experiment: Experiment, shown: RunRef[]) => {
    const note = experiment.request.note;
    const name = `${formatDate(experiment.createdAt)}${note ? ` · ${note}` : ''}`;
    return <TableRow className="bg-canvas text-sm text-ink-2 hover:bg-canvas">
      {/* Only runs carry a checkbox, so a batch row never reads as one more run. */}
      {selection && <TableCell className="h-8 py-0" />}
      <TableHead scope="rowgroup" colSpan={columns - (selection ? 2 : 1)} className="h-8 text-sm font-normal text-ink-2">
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-ink-3">{t('runList.group.label')}</span>
          <Time value={experiment.createdAt} className="w-26 shrink-0 tabular-nums" />
          {note ? <span className="truncate font-medium text-foreground">{note}</span> : <span className="text-ink-3">{t('runList.group.noNote')}</span>}
          <span className="shrink-0 tabular-nums text-ink-3">· {t('runList.group.runs', { count: experiment.runs.length })}</span>
          {!hideVia && startedFromCli(experiment) && <CliMark className="ml-0" />}
        </span>
      </TableHead>
      <TableCell className="h-8 py-0 text-right">
        <Link to={{ view: 'runs', batch: experiment.id }} navigate={navigate} aria-label={t('runList.group.summaryLabel', { batch: name })}
          className="text-foreground underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{t('runList.group.summary')}</Link>
      </TableCell>
    </TableRow>;
  };

  return <Table className="min-w-3xl table-fixed">
    <TableCaption className="sr-only">{t('runList.caption')}</TableCaption>
    <colgroup>
      {selection && <col className="w-11" />}
      <col />
      <col className="w-50" />
      <col className="w-60" />
      <col className="w-18" />
      <col className="w-24" />
      <col className="w-24" />
      {showHints && <col className="w-44" />}
    </colgroup>
    <TableHeader><TableRow className="hover:bg-transparent">
      {selection && <TableHead scope="col">
        <Checkbox aria-label={t('runList.select.all')} disabled={pickable.length === 0} checked={picked === 0 ? false : picked === pickable.length ? true : 'indeterminate'} onCheckedChange={on => selection.onToggleAll(on === true)} />
      </TableHead>}
      <TableHead scope="col">{hideTask ? t('runList.columns.run') : t('runList.columns.task')}</TableHead>
      <TableHead scope="col">{showConditions ? t('runList.columns.profile') : t('runList.columns.model')}</TableHead>
      <TableHead scope="col">{t('runList.columns.result')}</TableHead>
      <TableHead scope="col" className="text-right">{t('runList.columns.steps')}</TableHead>
      <TableHead scope="col" className="text-right">{t('runList.columns.duration')}</TableHead>
      <TableHead scope="col" className="text-right">{t('runList.columns.start')}</TableHead>
      {showHints && <TableHead scope="col">{t('runList.columns.hints')}</TableHead>}
    </TableRow></TableHeader>
    {groups.map((group, index) => <tbody key={group.experiment?.id ?? index}>
      {group.experiment && header(group.experiment, group.runs)}
      {group.runs.map(row)}
    </tbody>)}
  </Table>;
}
