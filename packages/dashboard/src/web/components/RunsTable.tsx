import { useTranslation } from 'react-i18next';
import { useHintSummaries, useRequestHintSummaries } from '../hooks/useHintSummaries';
import type { RouteChange } from '../hooks/useRoute';
import { formatDate } from '../lib/format';
import { displayState, resultLabel, runGlyphKind } from '../lib/runStrip';
import { isFinished, isLive, runProfileName, runStartedAt, runStepCount, durationSeconds, type RunRef, taskNameOf } from '../lib/runs';
import { HintBadge } from './HintBadge';
import { Link } from './Link';
import { RunGlyph } from './trace/RunStrip';
import { Checkbox } from './ui/checkbox';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type Props = {
  runs: RunRef[]; profiles: { id: string; name: string }[]; navigate: (change: RouteChange) => void;
  /** Leaves out the task column, for a table of one task's runs. */
  hideTask?: boolean;
  /** "Run #n" of each run by id; adds a column with the number. */
  numbers?: ReadonlyMap<string, number>;
  /** Adds the friction hints of each finished run (one request per run, so only where the list is short). */
  showHints?: boolean;
  /** Names the run profile next to the model. */
  showProfile?: boolean;
  /** Current task names, so a renamed task shows its new name. */
  tasks?: readonly { id: string; name: string }[];
  /** Adds a checkbox column. Queued and running runs cannot be picked. */
  selection?: { selected: ReadonlySet<string>; onToggle: (runId: string, on: boolean) => void; onToggleAll: (on: boolean) => void };
};

const head = 'h-8 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-0 text-[13px]';
/** The link of a row, stretched over the whole row: the row is `relative`, so anything else clickable in it needs `relative z-10`. */
const rowLink = 'rounded-sm after:absolute after:inset-0 focus-visible:outline-none! focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-trace';

/**
 * The log index of runs, the densest table of the dashboard (spec §31): time, task, model, mode, result, actions and duration,
 * one 36px line each. The result is a glyph and its words; the colour only reinforces them.
 */
export function RunsTable({ runs, profiles, navigate, hideTask, numbers, showHints, showProfile, tasks = [], selection }: Props) {
  const { t } = useTranslation();
  const hintsFor = useHintSummaries();
  useRequestHintSummaries(showHints ? runs.filter(ref => isFinished(ref.run)).map(ref => ({ experimentId: ref.experiment.id, runId: ref.run.id })) : []);
  const pickable = selection ? runs.filter(ref => !isLive(ref.run)) : [];
  const picked = pickable.filter(ref => selection!.selected.has(ref.run.id)).length;
  return <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
    <Table>
      <TableCaption className="sr-only">{t('runList.caption')}</TableCaption>
      <TableHeader><TableRow className="bg-raised hover:bg-raised">
        {selection && <TableHead scope="col" className={head + ' w-9'}>
          <Checkbox aria-label={t('runList.select.all')} disabled={pickable.length === 0} checked={picked === 0 ? false : picked === pickable.length ? true : 'indeterminate'} onCheckedChange={on => selection.onToggleAll(on === true)} />
        </TableHead>}
        {numbers && <TableHead scope="col" className={head}>{t('runList.columns.number')}</TableHead>}
        <TableHead scope="col" className={head}>{t('runList.columns.time')}</TableHead>
        {!hideTask && <TableHead scope="col" className={head}>{t('runList.columns.task')}</TableHead>}
        <TableHead scope="col" className={head}>{t('runList.columns.model')}</TableHead>
        <TableHead scope="col" className={head}>{t('runList.columns.mode')}</TableHead>
        <TableHead scope="col" className={head}>{t('runList.columns.result')}</TableHead>
        <TableHead scope="col" className={head + ' text-right'}>{t('runList.columns.steps')}</TableHead>
        <TableHead scope="col" className={head + ' text-right'}>{t('runList.columns.duration')}</TableHead>
        {showHints && <TableHead scope="col" className={head}>{t('runList.columns.hints')}</TableHead>}
      </TableRow></TableHeader>
      <TableBody>{runs.map(ref => {
        const { run } = ref, steps = runStepCount(run), seconds = durationSeconds(run), hints = hintsFor(run.id) ?? [];
        const open = { task: run.taskId, run: run.id };
        const when = formatDate(runStartedAt(ref)), label = taskNameOf(run, tasks);
        return <TableRow key={run.id} className="relative h-9">
          {selection && <TableCell className={cell}>
            <Checkbox className="relative z-10" aria-label={t('runList.select.one', { name: label })} disabled={isLive(run)} title={isLive(run) ? t('runList.select.live') : undefined}
              checked={selection.selected.has(run.id)} onCheckedChange={on => selection.onToggle(run.id, on === true)} />
          </TableCell>}
          {numbers && <TableCell className={cell + ' tabular-nums'}><Link to={open} navigate={navigate} className={rowLink + ' text-trace underline-offset-2 hover:underline'}>#{numbers.get(run.id) ?? '—'}</Link></TableCell>}
          <TableCell className={cell + ' font-mono tabular-nums whitespace-nowrap text-muted-foreground'}>
            {numbers || !hideTask ? when : <Link to={open} navigate={navigate} className={rowLink + ' hover:underline'}>{when}</Link>}
          </TableCell>
          {!hideTask && <TableCell className={cell + ' font-medium'}>
            {numbers ? label : <Link to={open} navigate={navigate} className={rowLink + ' hover:underline'}>{label}<span className="sr-only"> {t('sidebar.repeat', { n: run.repeat })}</span></Link>}
          </TableCell>}
          <TableCell className={cell + ' whitespace-nowrap'}>{run.snapshot.model.name}{showProfile && <span className="text-muted-foreground"> · {runProfileName(profiles, run)}</span>}</TableCell>
          <TableCell className={cell + ' whitespace-nowrap'}>{t(`sidebar.modes.${run.snapshot.mode}`)}</TableCell>
          <TableCell className={cell + ' whitespace-nowrap'}><span className="inline-flex items-center gap-1.5"><RunGlyph kind={runGlyphKind(displayState(run))} />{resultLabel(run)}</span></TableCell>
          <TableCell className={cell + ' text-right font-mono tabular-nums'}>{steps ?? '—'}</TableCell>
          <TableCell className={cell + ' text-right font-mono tabular-nums text-muted-foreground'}>{seconds === undefined ? '—' : t('run.duration', { seconds: seconds.toFixed(1) })}</TableCell>
          {showHints && <TableCell className={cell}>{hints.length
            ? <span className="flex flex-wrap gap-1">{hints.slice(0, 2).map(hint => <HintBadge key={hint.kind} kind={hint.kind} count={hint.count} />)}</span>
            : <span className="text-muted-foreground">{isFinished(run) && hintsFor(run.id) ? t('runList.noHints') : '—'}</span>}</TableCell>}
        </TableRow>;
      })}</TableBody>
    </Table>
  </div>;
}
