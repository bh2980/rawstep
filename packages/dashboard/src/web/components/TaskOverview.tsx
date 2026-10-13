import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@rawstep/project/config';
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
  /** Opens the run dialog for this task. */
  onRun: () => void;
  /** The project's profiles, to name the results by. */
  profiles: readonly Pick<Profile, 'id' | 'name'>[];
  /** The fewest moves the goal takes, when the task says. */
  minimalSteps?: number | undefined;
};

/**
 * The "개요" tab, an investigation sheet: the run facts as three figures, then what the page did (by element), then where the model
 * wandered as a separate, weaker layer. The run list itself is the 실행 기록 tab.
 */
export function TaskOverview({ taskId, runs, numbers, findings, navigate, onRun, profiles, minimalSteps }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model') ?? [];
  const facts = data?.facts;
  if (runs.length === 0) return <EmptyState title={t('empty.taskRuns.title')} why={t('empty.taskRuns.why')} action={<Button variant="outline" onClick={onRun}>{t('empty.taskRuns.action')}</Button>} />;
  const shared = { taskId, numbers, navigate };
  const nameOf = (group: ProfileFacts) => `${profiles.find(profile => profile.id === group.profileId)?.name ?? group.profileId} · ${t(`sidebar.modes.${group.mode}`)}`;
  return <div className="grid gap-8">
    {facts && facts.byProfile.length > 0 && <section aria-labelledby="results-title" className="grid max-w-5xl gap-2">
      <h2 id="results-title" className="text-sm font-semibold">{t('taskPage.results.title')}</h2>
      <div className="overflow-x-auto rounded-md border border-edge">
        <table className="w-full min-w-[40rem] text-[13px] tabular-nums">
          <thead><tr className="border-b border-edge bg-raised text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-normal">{t('taskPage.results.profile')}</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">{t('taskPage.results.moves')}</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">{t('taskPage.results.reachedShort')}</th>
            <th scope="col" className="px-3 py-2 text-right font-normal"><span className="inline-flex items-center gap-1">{t('taskPage.results.unheard')}<InfoTip term={t('taskPage.results.unheard')}>{t('taskPage.results.unheardInfo')}</InfoTip></span></th>
            <th scope="col" className="px-3 py-2 text-left font-normal">{t('taskPage.results.lost')}</th>
          </tr></thead>
          <tbody>{facts.byProfile.map(group => <tr key={group.profileId + group.mode} className="border-b border-edge last:border-0">
            <td className="px-3 py-2">{nameOf(group)}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap"><span className="text-base font-semibold">{formatSteps(group.medianSteps)}</span>
              {group.minSteps !== null && group.maxSteps !== null && group.minSteps !== group.maxSteps && <span className="text-muted-foreground"> ({group.minSteps}–{group.maxSteps})</span>}
              {minimalSteps !== undefined && <span className="text-muted-foreground"> {t('taskPage.results.minimal', { n: minimalSteps })}</span>}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">{group.reached} / {group.runs}</td>
            <td className={cn('px-3 py-2 text-right whitespace-nowrap', group.unheard > 0 && 'font-medium text-inspect')}>{group.mode === 'screenreader' ? t('taskPage.results.unheardCount', { unheard: group.unheard, reached: group.reached }) : '—'}</td>
            <td className="px-3 py-2">{group.topTarget ? targetLabel(group.topTarget) : <span className="text-muted-foreground">{t('taskPage.results.lostNone')}</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
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


/** The number of records in a section, with its unit for a screen reader. */
function Count({ n }: { n: number }) {
  const { t } = useTranslation();
  return <span><span aria-hidden="true" className="font-semibold tabular-nums text-foreground">{n}</span><span className="sr-only">{t('taskPage.countLabel', { count: n })}</span></span>;
}
