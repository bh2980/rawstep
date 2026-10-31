import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Profile } from '@rawstep/project/config';
import type { ProfileFacts, StuckPlace, TaskBatch, TaskFindings } from '../../shared/api';
import { roleLabel } from '../i18n/labels';
import { formatSteps } from '../lib/format';
import type { RunRef } from '../lib/runs';
import { cn } from '../lib/utils';

/** "10월 31일 14:05 · 담기를 button으로 바꿈 · 실행 4번": a batch as the pickers name it. */
export function batchLabel(batch: TaskBatch, t: TFunction): string {
  const when = new Date(batch.createdAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return batch.note ? t('taskPage.batch.label', { when, note: batch.note, runs: batch.runs }) : t('taskPage.batch.labelNoNote', { when, runs: batch.runs });
}

type Props = {
  before: TaskFindings; after: TaskFindings;
  profiles: readonly Pick<Profile, 'id' | 'name'>[];
  /** Every run of the task, to tell whether the two batches ran with the same conditions. */
  runs: readonly RunRef[];
  minimalSteps?: number | undefined;
};

const groupKey = (item: { profileId: string }) => item.profileId;
const sameTarget = (a: StuckPlace, b: StuckPlace) => a.target.role === b.target.role && a.target.name === b.target.name;
/** The parts of a run's recorded conditions, without the profile itself (its name may change while nothing that matters does). */
const CONDITION_PARTS = ['combo', 'actionSet', 'pageEnvironment', 'atEnvironment', 'runRules'] as const;

/**
 * Two batches of one task side by side, per run profile: how the runs ended, what reaching the goal cost, the longest stretch
 * without a goal word, and which stuck places went away or appeared. Counts only: with a few runs a difference may be chance.
 */
export function BatchCompare({ before, after, profiles, runs, minimalSteps }: Props) {
  const { t } = useTranslation();
  const keys = [...new Map([...after.facts.byProfile, ...before.facts.byProfile].map(group => [groupKey(group), group])).values()];
  const nameOf = (group: Pick<ProfileFacts, 'profileId'>) => profiles.find(profile => profile.id === group.profileId)?.name ?? group.profileId;
  const batchOf = (findings: TaskFindings) => findings.batches.find(batch => batch.experimentId === findings.batch);
  const differing = conditionDifferences(runs, before.batch, after.batch);
  return <section aria-labelledby="compare-title" className="rounded-md border border-edge bg-surface">
    <h2 id="compare-title" className="border-b border-edge px-4 pt-3.5 pb-2.5 text-[15px] font-semibold">{t('taskPage.batch.compareTitle')}</h2>
    <div className="grid md:grid-cols-2">
      {[{ label: t('taskPage.batch.before'), findings: before }, { label: t('taskPage.batch.after'), findings: after }].map(({ label, findings }, index) => { const batch = batchOf(findings);
        return <div key={label} className={cn('grid content-start gap-1 px-4 py-3', index === 0 && 'border-edge md:border-r')}>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-sm">{batch ? batchLabel(batch, t) : '—'}</div>
        </div>; })}
    </div>
    <p className={cn('border-t border-edge px-4 py-2 text-xs', differing.length ? 'text-inspect' : 'text-muted-foreground')}>
      {differing.length ? t('taskPage.batch.conditionsDiffer', { parts: differing.map(part => t(`taskPage.batch.parts.${part}`)).join(', ') }) : t('taskPage.batch.conditionsSame')}
    </p>
    <div className="overflow-x-auto border-t border-edge">
      <table className="w-full min-w-[48rem] text-[13px]">
        <thead><tr className="bg-raised text-xs text-muted-foreground">
          {(['profile', 'did', 'cost', 'stretch', 'stuck'] as const).map(column => <th key={column} scope="col" className="px-3 py-2 text-left font-normal whitespace-nowrap first:pl-4">{t(`taskPage.batch.columns.${column}`)}</th>)}
        </tr></thead>
        <tbody>{keys.map(key => {
          const a = before.facts.byProfile.find(group => groupKey(group) === groupKey(key)), b = after.facts.byProfile.find(group => groupKey(group) === groupKey(key));
          const gone = before.stuck.filter(place => place.byProfile.some(item => groupKey(item) === groupKey(key)) && !after.stuck.some(other => sameTarget(place, other) && other.byProfile.some(item => groupKey(item) === groupKey(key))));
          const kept = after.stuck.filter(place => place.byProfile.some(item => groupKey(item) === groupKey(key)));
          const runsAt = (place: StuckPlace) => place.byProfile.find(item => groupKey(item) === groupKey(key))?.runs ?? 0;
          return <tr key={groupKey(key)} className="border-t border-edge align-top">
            <th scope="row" className="py-3 pr-3 pl-4 text-left font-semibold">{nameOf(key)}</th>
            <td className="px-3 py-3 whitespace-nowrap"><Change before={a ? `${a.reached} / ${a.runs}` : undefined} after={b ? `${b.reached} / ${b.runs}` : undefined} /></td>
            <td className="px-3 py-3 whitespace-nowrap"><Change before={a ? formatSteps(a.medianSteps) : undefined} after={b ? formatSteps(b.medianSteps) : undefined} unit />
              {minimalSteps !== undefined && <div className="text-xs text-muted-foreground">{t('taskPage.results.minimal', { n: minimalSteps })}</div>}</td>
            <td className="px-3 py-3 whitespace-nowrap"><Change before={a?.longestStretch ? String(a.longestStretch.moves) : a ? '—' : undefined} after={b?.longestStretch ? String(b.longestStretch.moves) : b ? '—' : undefined} unit /></td>
            <td className="px-3 py-3"><ul className="grid gap-1">
              {gone.map(place => <li key={`gone:${place.target.role}:${place.target.name}`}>{target(place)} <span className="font-medium text-reach">{t('taskPage.batch.gone', { runs: runsAt(place) })}</span></li>)}
              {kept.map(place => { const old = before.stuck.find(other => sameTarget(place, other));
                return <li key={`now:${place.target.role}:${place.target.name}`}>{target(place)} <span className={cn('font-medium', old ? 'text-foreground' : 'text-inspect')}>
                  {old ? t('taskPage.batch.still', { before: runsAt(old), after: runsAt(place) }) : t('taskPage.batch.new', { runs: runsAt(place) })}</span></li>; })}
              {!gone.length && !kept.length && <li className="text-muted-foreground">{t('taskPage.results.none')}</li>}
            </ul></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="border-t border-edge px-4 py-2 text-xs text-muted-foreground">{t('taskPage.batch.chance')}</p>
  </section>;
}

function target(place: StuckPlace): string {
  return `${roleLabel(place.target.role)} ${place.target.name ? `“${place.target.name}”` : ''}`.trim();
}

/** "0 / 2 → 2 / 2": the after value stands out; a side the profile did not run in shows a dash. */
function Change({ before, after, unit }: { before: string | undefined; after: string | undefined; unit?: boolean }) {
  const { t } = useTranslation();
  const show = (value: string | undefined) => value === undefined ? t('taskPage.batch.notRun') : unit && value !== '—' ? t('taskPage.results.moves', { n: value }) : value;
  return <span><span className="text-muted-foreground">{show(before)}</span> → <strong className="font-semibold">{show(after)}</strong></span>;
}

/** Which parts of the recorded conditions differ between the runs of two batches. */
function conditionDifferences(runs: readonly RunRef[], before: string | undefined, after: string | undefined): (typeof CONDITION_PARTS)[number][] {
  const values = (experimentId: string | undefined, part: (typeof CONDITION_PARTS)[number]) => new Set(runs.filter(ref => ref.experiment.id === experimentId)
    .map(ref => JSON.stringify((ref.run.snapshot.spec.conditions as Record<string, unknown> | undefined)?.[part] ?? null)));
  return CONDITION_PARTS.filter(part => {
    const a = values(before, part), b = values(after, part);
    return a.size !== b.size || [...a].some(value => !b.has(value));
  });
}
