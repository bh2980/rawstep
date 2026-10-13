import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Mode, Profile } from '@rawstep/project/config';
import type { ProfileFacts, TaskFindings } from '../../shared/api';
import { targetLabel } from '../i18n/labels';
import { cn } from '../lib/utils';
import type { RouteChange } from '../hooks/useRoute';
import { dataFailureView } from '../lib/errors';
import { formatSteps } from '../lib/format';
import type { RunRef } from '../lib/runs';
import { ModelBehaviorList, PageEvidenceLedger } from './trace/FindingLedgers';
import { SourceMarker } from './trace/SourceMarker';
import { InfoTip } from './layout/InfoTip';
import { SectionHead } from './layout/PageHeader';
import { EmptyState } from './layout/EmptyState';
import { ErrorState } from './layout/ErrorState';
import { Link } from './Link';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

type Props = {
  taskId: string;
  /** Runs of this task, newest first. */
  runs: RunRef[]; numbers: ReadonlyMap<string, number>;
  findings: { data?: TaskFindings; error: string; loading: boolean };
  navigate: (change: RouteChange) => void;
  /** Takes a person to the run control of the task header. */
  onRun: () => void;
  /** The profile and mode the next run uses: their results lead, the others follow in a table. */
  profileId: string; mode: Mode; profiles: readonly Pick<Profile, 'id' | 'name'>[];
  /** The fewest moves the goal takes, when the task says. */
  minimalSteps?: number | undefined;
};

/**
 * The "개요" tab, an investigation sheet: the run facts as three figures, then what the page did (by element), then where the model
 * wandered as a separate, weaker layer. The run list itself is the 실행 기록 tab.
 */
export function TaskOverview({ taskId, runs, numbers, findings, navigate, onRun, profileId, mode, profiles, minimalSteps }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model') ?? [];
  const facts = data?.facts;
  if (runs.length === 0) return <EmptyState title={t('empty.taskRuns.title')} why={t('empty.taskRuns.why')} action={<Button variant="outline" onClick={onRun}>{t('empty.taskRuns.action')}</Button>} />;
  const shared = { taskId, numbers, navigate };
  const current = facts?.byProfile.find(group => group.profileId === profileId && group.mode === mode);
  const others = facts?.byProfile.filter(group => group !== current) ?? [];
  const nameOf = (group: ProfileFacts) => `${profiles.find(profile => profile.id === group.profileId)?.name ?? group.profileId} · ${t(`sidebar.modes.${group.mode}`)}`;
  return <div className="grid gap-8">
    {facts && facts.runs > 0 && <section aria-labelledby="results-current" className="grid gap-3">
      <h2 id="results-current" className="text-sm font-semibold">{current ? t('taskPage.results.title', { count: current.runs }) : t('taskPage.results.none')}</h2>
      {current && <dl aria-label={t('taskPage.factsLabel')} className="grid max-w-5xl gap-3 sm:grid-cols-3">
        <Stat label={t('taskPage.results.moves')} value={<>{formatSteps(current.medianSteps)}{minimalSteps !== undefined && <span className="text-base font-normal text-muted-foreground"> {t('taskPage.results.minimal', { n: minimalSteps })}</span>}</>}
          note={<>{t('taskPage.results.reached', { reached: current.reached, runs: current.runs })}{current.minSteps !== null && current.maxSteps !== null && current.minSteps !== current.maxSteps && <> · {t('taskPage.results.spread', { min: current.minSteps, max: current.maxSteps })}</>}</>} />
        <Stat label={t('taskPage.results.lost')} value={<span className="text-lg">{current.topTarget ? targetLabel(current.topTarget) : t('taskPage.results.lostNone')}</span>} />
        {mode === 'screenreader' && <Stat warn={current.unheard > 0} label={t('taskPage.results.unheard')} info={t('taskPage.results.unheardInfo')}
          value={<span className="text-lg">{current.unheard > 0 ? t('taskPage.results.unheardCount', { unheard: current.unheard, reached: current.reached }) : t('taskPage.results.unheardNone')}</span>} />}
      </dl>}
      {others.length > 0 && <div className="max-w-5xl overflow-x-auto">
        <table className="w-full min-w-[30rem] text-[13px] tabular-nums">
          <caption className="pb-1 text-left text-xs text-muted-foreground">{t('taskPage.results.others')}</caption>
          <thead><tr className="border-b border-edge text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 text-left font-normal">{t('taskPage.results.profile')}</th>
            <th scope="col" className="py-1.5 text-right font-normal">{t('taskPage.results.moves')}</th>
            <th scope="col" className="py-1.5 text-right font-normal">{t('taskPage.results.reachedShort')}</th>
            <th scope="col" className="py-1.5 text-right font-normal">{t('taskPage.results.unheard')}</th>
          </tr></thead>
          <tbody>{others.map(group => <tr key={group.profileId + group.mode} className="border-b border-edge last:border-0">
            <td className="py-1.5">{nameOf(group)}</td>
            <td className="py-1.5 text-right">{formatSteps(group.medianSteps)}{group.minSteps !== null && group.maxSteps !== null && group.minSteps !== group.maxSteps && <span className="text-muted-foreground"> ({group.minSteps}–{group.maxSteps})</span>}</td>
            <td className="py-1.5 text-right">{group.reached} / {group.runs}</td>
            <td className={cn('py-1.5 text-right', group.unheard > 0 && 'text-inspect')}>{group.mode === 'screenreader' ? group.unheard : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>}
    {findings.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
    {findings.error && !data && <ErrorState view={dataFailureView(t('taskPage.findingsFailed'), findings.error)} />}
    {data && <>
      <section aria-labelledby="findings-page" className="grid gap-3">
        <SectionHead id="findings-page" title={<span className="flex items-center gap-2"><SourceMarker source="page" />{t('taskPage.pageTitle')}<InfoTip term={t('taskPage.pageTitle')}>{t('taskPage.pageNote')} {t('help.inspect')}</InfoTip></span>} aside={<Count n={page.length} />} />
        {page.length === 0
          ? <EmptyState compact title={t('empty.findings.title')} why={t('empty.findings.why')} action={<Button variant="outline" size="sm" onClick={onRun}>{t('empty.findings.action')}</Button>} />
          : <PageEvidenceLedger findings={page} {...shared} />}
      </section>
      <section aria-labelledby="findings-model" className="grid gap-3">
        <SectionHead id="findings-model" title={<span className="flex items-center gap-2"><SourceMarker source="model" />{t('taskPage.modelTitle')}<InfoTip term={t('taskPage.modelTitle')}>{t('taskPage.modelNote')}</InfoTip></span>} aside={<Count n={model.length} />} />
        {model.length === 0 ? <p className="text-sm text-muted-foreground">{t('taskPage.modelEmpty')}</p> : <ModelBehaviorList findings={model} {...shared} />}
      </section>
    </>}
  </div>;
}

/** One figure of the results: a small label over a large value, on a tile; `warn` marks one that needs a look. */
function Stat({ label, value, note, info, warn }: { label: string; value: ReactNode; note?: ReactNode; info?: string; warn?: boolean }) {
  return <div className={cn('grid content-start gap-0.5 rounded-md px-3.5 py-3', warn ? 'bg-inspect-soft' : 'bg-raised')}>
    <dt className={cn('flex items-center gap-1 text-xs', warn ? 'text-inspect' : 'text-muted-foreground')}>{label}{info && <InfoTip term={label}>{info}</InfoTip>}</dt>
    <dd className={cn('text-2xl font-semibold tracking-tight tabular-nums', warn && 'text-inspect')}>{value}</dd>
    {note && <dd className="text-xs leading-5 text-muted-foreground">{note}</dd>}
  </div>;
}

/** The number of records in a section, with its unit for a screen reader. */
function Count({ n }: { n: number }) {
  const { t } = useTranslation();
  return <span><span aria-hidden="true" className="font-semibold tabular-nums text-foreground">{n}</span><span className="sr-only">{t('taskPage.countLabel', { count: n })}</span></span>;
}
