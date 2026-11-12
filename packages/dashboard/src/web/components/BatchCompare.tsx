import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Profile } from '@rawstep/project/config';
import type { ProfileFacts, RunResult, StuckPlace, TaskBatch, TaskFindings } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { currentLanguage } from '../i18n';
import { roleLabel } from '../i18n/labels';
import { MAX_COMPARE, describeChange, differingParts, sideOfFindings } from '../lib/compare';
import { countOf, formatSteps } from '../lib/format';
import type { RunRef } from '../lib/runs';
import { cn } from '../lib/utils';
import { CompareSummary } from './CompareSummary';
import { Link } from './Link';
import { Dash, SectionHead } from './PageHeader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

/** "10월 31일 14:05 · 담기를 button으로 바꿈 · 실행 4번": a batch as the pickers name it, with " · CLI" after a batch started from the command line. */
export function batchLabel(batch: TaskBatch, t: TFunction): string {
  const when = new Date(batch.createdAt).toLocaleString(currentLanguage(), { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const label = batch.note ? t('taskPage.batch.label', { when, note: batch.note, runs: batch.runs, count: batch.runs }) : t('taskPage.batch.labelNoNote', { when, runs: batch.runs, count: batch.runs });
  return batch.via === 'cli' ? `${label} · ${t('runList.cli')}` : label;
}

type Props = {
  before: TaskFindings; after: TaskFindings;
  profiles: readonly Pick<Profile, 'id' | 'name'>[];
  /** Every run of the task, to tell whether the two batches ran with the same conditions. */
  runs: readonly RunRef[];
  minimalSteps?: number | undefined;
  navigate: (change: RouteChange) => void;
};

const groupKey = (item: { profileId: string }) => item.profileId;
const sameTarget = (a: StuckPlace, b: StuckPlace) => a.target.role === b.target.role && a.target.name === b.target.name;

/** Where a number of the table leads: one run, or the runs it counts side by side. */
type Go = { to: RouteChange; title: string };
/** The run whose cost is nearest the typical cost of the runs that reached the goal. */
function nearestToTypical(results: readonly RunResult[], typical: number | null): RunResult | undefined {
  const reached = results.filter(result => result.ending === 'reached' && result.steps !== null);
  return typical === null ? undefined : reached.sort((a, b) => Math.abs(a.steps! - typical) - Math.abs(b.steps! - typical))[0];
}

/**
 * Two batches of one task side by side, per run profile: how the runs ended, what reaching the goal cost, the longest stretch
 * without a goal word, and which stuck places went away or appeared. Counts only: with a few runs a difference may be chance.
 */
export function BatchCompare({ before, after, profiles, runs, minimalSteps, navigate }: Props) {
  const { t } = useTranslation();
  const keys = [...new Map([...after.facts.byProfile, ...before.facts.byProfile].map(group => [groupKey(group), group])).values()];
  const nameOf = (group: Pick<ProfileFacts, 'profileId'>) => profiles.find(profile => profile.id === group.profileId)?.name ?? group.profileId;
  const batchOf = (findings: TaskFindings) => findings.batches.find(batch => batch.experimentId === findings.batch);
  const differing = differingParts(runs.filter(ref => ref.experiment.id === before.batch).map(ref => ref.run), runs.filter(ref => ref.experiment.id === after.batch).map(ref => ref.run));
  const task = before.taskId;
  const openRun = (result: RunResult | undefined, title: string, step?: number): Go | undefined => result ? { to: { task, run: result.runId, ...(step !== undefined ? { step } : {}) }, title } : undefined;
  /** One run opens itself; several open side by side (when they fit). */
  const openRuns = (list: readonly RunResult[]): Go | undefined => list.length === 1 ? openRun(list[0], t('runCompare.open'))
    : list.length >= 2 && list.length <= MAX_COMPARE ? { to: { view: 'runs', compare: list.map(result => result.runId) }, title: t('runCompare.sideRuns', { count: list.length }) } : undefined;
  // A task's two batches, profile by profile: the same comparison the batch summary page makes.
  const lines = describeChange(sideOfFindings(before), sideOfFindings(after), { first: t('compareSummary.before'), second: t('compareSummary.after') }, { byProfile: true, profileName: id => nameOf({ profileId: id }) });
  return <section aria-labelledby="compare-title">
    <SectionHead id="compare-title" title={t('taskPage.batch.compareTitle')} />
    <div className="border-t border-edge py-3">
      <CompareSummary lines={lines} />
      <dl className="mt-2 grid gap-1 text-sm">
        {[{ label: t('taskPage.batch.before'), findings: before }, { label: t('taskPage.batch.after'), findings: after }].map(({ label, findings }) => { const batch = batchOf(findings);
          return <div key={label} className="flex min-w-0 gap-3">
            <dt className="w-12 shrink-0 text-ink-2">{label}</dt>
            <dd className="min-w-0 truncate">{batch ? batchLabel(batch, t) : <Dash />}</dd>
          </div>; })}
      </dl>
      <p className={cn('mt-1 text-sm', differing.length ? 'text-foreground' : 'text-ink-2')}>
        {differing.length ? t('taskPage.batch.conditionsDiffer', { parts: differing.map(part => t(`taskPage.batch.parts.${part}`)).join(', ') }) : t('taskPage.batch.conditionsSame')}
      </p>
    </div>
    <Table className="min-w-3xl table-fixed">
      <colgroup><col className="w-48" /><col className="w-36" /><col className="w-40" /><col className="w-40" /><col /></colgroup>
      <TableHeader><TableRow className="hover:bg-transparent">
        {(['profile', 'did', 'cost', 'stretch', 'stuck'] as const).map(column => <TableHead key={column} scope="col">{t(`taskPage.batch.columns.${column}`)}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{keys.map(key => {
        const a = before.facts.byProfile.find(group => groupKey(group) === groupKey(key)), b = after.facts.byProfile.find(group => groupKey(group) === groupKey(key));
        const gone = before.stuck.filter(place => place.byProfile.some(item => groupKey(item) === groupKey(key)) && !after.stuck.some(other => sameTarget(place, other) && other.byProfile.some(item => groupKey(item) === groupKey(key))));
        const kept = after.stuck.filter(place => place.byProfile.some(item => groupKey(item) === groupKey(key)));
        const runsAt = (place: StuckPlace) => place.byProfile.find(item => groupKey(item) === groupKey(key))?.runs ?? 0;
        // The runs of this profile on each side, and where a number leads: to the runs it counts, or to the one run it is drawn from.
        const rb = before.results.filter(result => result.profileId === key.profileId), ra = after.results.filter(result => result.profileId === key.profileId);
        const stretchGo = (group: ProfileFacts | undefined): Go | undefined => group?.longestStretch ? { to: { task, run: group.longestStretch.runId }, title: t('runCompare.longestRun') } : undefined;
        /** The first run of this profile that got stuck at the place, at the step it did. */
        const seenAt = (findings: TaskFindings, results: readonly RunResult[], place: StuckPlace): Go | undefined => {
          const index = findings.stuck.indexOf(place);
          for (const result of results) { const hit = result.stuck.find(item => item.place === index); if (hit) return openRun(result, t('runCompare.openAt', { step: hit.step }), hit.step); }
          return undefined;
        };
        return <TableRow key={groupKey(key)} className="align-top hover:bg-transparent">
          <TableHead scope="row" className="h-auto truncate py-2.5 text-base font-medium text-foreground">{nameOf(key)}</TableHead>
          <TableCell className="h-auto py-2.5 tabular-nums"><Change before={a ? `${a.reached} / ${a.measured}` : undefined} after={b ? `${b.reached} / ${b.measured}` : undefined} beforeGo={openRuns(rb)} afterGo={openRuns(ra)} navigate={navigate} /></TableCell>
          <TableCell className="h-auto py-2.5 tabular-nums"><Change before={a ? formatSteps(a.medianSteps) : undefined} after={b ? formatSteps(b.medianSteps) : undefined} unit navigate={navigate}
            beforeGo={openRun(nearestToTypical(rb, a?.medianSteps ?? null), t('runCompare.medianRun'))} afterGo={openRun(nearestToTypical(ra, b?.medianSteps ?? null), t('runCompare.medianRun'))} />
            {minimalSteps !== undefined && <div className="text-sm text-ink-2">{t('taskPage.results.minimal', { n: minimalSteps, count: minimalSteps })}</div>}</TableCell>
          <TableCell className="h-auto py-2.5 tabular-nums"><Change before={a?.longestStretch ? String(a.longestStretch.moves) : a ? '—' : undefined} after={b?.longestStretch ? String(b.longestStretch.moves) : b ? '—' : undefined} unit navigate={navigate}
            beforeGo={stretchGo(a)} afterGo={stretchGo(b)} /></TableCell>
          <TableCell className="h-auto py-2.5 whitespace-normal"><ul className="grid gap-1">
            {gone.map(place => <li key={`gone:${place.target.role}:${place.target.name}`}><GoLink go={seenAt(before, rb, place)} navigate={navigate}>{target(place)}</GoLink> <span className="text-ink-2">{t('taskPage.batch.gone', { runs: runsAt(place), count: runsAt(place) })}</span></li>)}
            {kept.map(place => { const old = before.stuck.find(other => sameTarget(place, other));
              return <li key={`now:${place.target.role}:${place.target.name}`}><GoLink go={seenAt(after, ra, place)} navigate={navigate}>{target(place)}</GoLink> <span className={old ? 'text-ink-2' : 'font-medium'}>
                {old ? t('taskPage.batch.still', { before: t('taskPage.batch.runCount', { count: runsAt(old) }), after: t('taskPage.batch.runCount', { count: runsAt(place) }) }) : t('taskPage.batch.new', { runs: runsAt(place), count: runsAt(place) })}</span></li>; })}
            {!gone.length && !kept.length && <li><Dash /></li>}
          </ul></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </section>;
}

function target(place: StuckPlace): string {
  return `${roleLabel(place.target.role)} ${place.target.name ? `“${place.target.name}”` : ''}`.trim();
}

/** A value that leads somewhere is a link to it (a run, or the runs it counts); one that leads nowhere is plain text. */
function GoLink({ go, navigate, children }: { go: Go | undefined; navigate: (change: RouteChange) => void; children: ReactNode }) {
  return go ? <Link to={go.to} navigate={navigate} title={go.title} className="underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{children}</Link> : <>{children}</>;
}

/** "0 / 2 → 2 / 2": the after value stands out; a side the profile did not run in shows a dash. Each side may link to the runs behind it. */
function Change({ before, after, unit, beforeGo, afterGo, navigate }: { before: string | undefined; after: string | undefined; unit?: boolean; beforeGo?: Go | undefined; afterGo?: Go | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const show = (value: string | undefined) => value === undefined ? t('taskPage.batch.notRun') : unit && value !== '—' ? t('taskPage.results.moves', { n: value, ...countOf(value) }) : value;
  return <span><span className="text-ink-2"><GoLink go={beforeGo} navigate={navigate}>{show(before)}</GoLink></span> <span aria-hidden="true" className="text-ink-3">→</span><span className="sr-only">,</span> <span className="font-medium"><GoLink go={afterGo} navigate={navigate}>{show(after)}</GoLink></span></span>;
}
