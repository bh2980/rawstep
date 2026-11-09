import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@rawstep/project/config';
import type { TaskBatch, TaskFindings } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { dataFailureView } from '../lib/errors';
import { formatSteps } from '../lib/format';
import type { RunRef } from '../lib/runs';
import { BatchCompare, batchLabel } from './BatchCompare';
import { ErrorState } from './layout/ErrorState';
import { Link } from './Link';
import { Dash, SectionHead } from './PageHeader';
import { StatusShape } from './StatusMark';
import { TaskResults } from './TaskResults';
import { Time } from './Time';
import { Fact, FactLine } from './trace/FactLine';
import { FindingTable } from './trace/FindingLedgers';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
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
  /** The batch the results are about (undefined: the newest), and the one to compare it with, if any, with its findings. */
  batch: string | undefined; onBatch: (experimentId: string) => void;
  compareTo: string | undefined; onCompare: (experimentId: string | undefined) => void;
  compared: { data?: TaskFindings; error: string; loading: boolean };
};

/** The middle value of a list of numbers, or null for none. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The "개요" tab: one line of facts about the batch, then the observed phenomena (evidence, each row with links down to the run and
 * action), the results by run profile, and what the model did while deciding as a separate, weaker table. The run list is the 실행
 * 기록 tab.
 */
export function TaskOverview({ taskId, runs, numbers, findings, navigate, onRun, profiles, minimalSteps, onBatch, compareTo, onCompare, compared }: Props) {
  const { t } = useTranslation();
  const { data } = findings;
  if (runs.length === 0) return <section aria-labelledby="overview-empty" className="grid max-w-md gap-2 py-16">
    <h2 id="overview-empty" className="text-md font-semibold">{t('empty.taskRuns.title')}</h2>
    <p className="text-ink-2">{t('empty.taskRuns.why')}</p>
    <Button className="mt-2 justify-self-start" onClick={onRun}>{t('taskPage.run')}</Button>
  </section>;
  // Broken expectations are the 막힌 곳 table, not listed again among the model's wanderings.
  const page = data?.findings.filter(finding => finding.source === 'page') ?? [], model = data?.findings.filter(finding => finding.source === 'model' && finding.kind !== 'expectation-broken') ?? [];
  const shared = { taskId, numbers, navigate };
  return <div className="grid gap-8">
    {findings.loading && !data && <div aria-busy="true" className="grid gap-2"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>}
    {findings.error && !data && <ErrorState view={dataFailureView(t('taskPage.findingsFailed'), findings.error)} />}
    {data && <>
      <div className="grid gap-3">
        {data.batches.length > 1 && <BatchBar batches={data.batches} batch={data.batch} onBatch={onBatch} compareTo={compareTo} onCompare={onCompare} navigate={navigate} />}
        <Facts data={data} minimalSteps={minimalSteps} lastRunAt={runs.find(ref => ref.experiment.id === data.batch)?.run.startedAt ?? runs[0]?.run.startedAt} />
      </div>
      {compareTo && compared.data && compared.data.batch !== data.batch && (() => {
        // The earlier batch is "before", whichever of the two was picked first.
        const [before, after] = [compared.data, data].sort((a, b) => (a.batches.find(x => x.experimentId === a.batch)?.createdAt ?? '').localeCompare(b.batches.find(x => x.experimentId === b.batch)?.createdAt ?? ''));
        return <BatchCompare before={before!} after={after!} profiles={profiles} runs={runs} minimalSteps={minimalSteps} navigate={navigate} />;
      })()}

      <section aria-labelledby="findings-page" className="grid">
        <SectionHead id="findings-page" title={t('taskPage.observedTitle')} count={page.length}><span className="text-sm text-ink-2">{t('taskPage.observedNote')}</span></SectionHead>
        {page.length === 0
          ? <p className="border-t border-edge px-3 py-3 text-ink-2">{t('empty.findings.title')}. {t('empty.findings.why')}</p>
          : <FindingTable findings={page} label={t('taskPage.observedTitle')} {...shared} />}
      </section>

      {data.facts.byProfile.length > 0 && <TaskResults taskId={taskId} data={data} numbers={numbers} navigate={navigate} profiles={profiles} />}

      {model.length > 0 && <section aria-labelledby="findings-model" className="grid">
        <SectionHead id="findings-model" title={t('taskPage.modelTitle')} count={model.length}><span className="text-sm text-ink-2">{t('taskPage.modelNoteShort')}</span></SectionHead>
        <FindingTable findings={model} label={t('taskPage.modelTitle')} {...shared} />
      </section>}
    </>}
  </div>;
}

/**
 * The batch in one ruled line: how many runs reached the goal, what reaching it cost, where runs got stuck, the longest stretch
 * without a goal word, and when it last ran. A figure with nothing behind it is `—`, not 0.
 */
function Facts({ data, minimalSteps, lastRunAt }: { data: TaskFindings; minimalSteps: number | undefined; lastRunAt: string | undefined }) {
  const { t } = useTranslation();
  const steps = data.results.filter(result => result.ending === 'reached' && result.steps !== null).map(result => result.steps!);
  const middle = median(steps), low = steps.length ? Math.min(...steps) : 0, high = steps.length ? Math.max(...steps) : 0;
  const longest = data.facts.byProfile.map(group => group.longestStretch).filter(item => item !== null).sort((a, b) => b.moves - a.moves)[0], stretch = longest?.moves ?? 0;
  return <FactLine ruled label={t('taskPage.factsLabel')} items={[
    <><StatusShape status="reached" className={data.facts.reached ? undefined : 'text-ink-3'} /><span className="tabular-nums">{t('taskPage.facts.reached', { runs: data.facts.runs, reached: data.facts.reached })}</span>{data.facts.unconfirmed > 0 && <span className="ml-3 tabular-nums text-ink-2" title={t('taskPage.results.unconfirmedInfo')}>{t('taskPage.results.unconfirmedCount', { unconfirmed: data.facts.unconfirmed, reached: data.facts.reached })}</span>}</>,
    <Fact label={t('taskPage.results.cost')}>{middle === null ? <Dash />
      : <>{t('taskPage.facts.median', { n: formatSteps(middle), count: middle })}{low !== high && <span className="text-ink-2"> · {low}–{high}</span>}</>}
      {minimalSteps !== undefined && <span className="text-ink-2"> · {t('taskPage.results.minimal', { n: minimalSteps, count: minimalSteps })}</span>}</Fact>,
    <Fact label={t('taskPage.results.stuckColumn')}>{data.stuck.length ? t('taskPage.facts.places', { count: data.stuck.length }) : <Dash />}</Fact>,
    stretch > 0 && <Fact label={t('taskPage.results.stretch')}>{t('taskPage.results.moves', { n: stretch, count: stretch })}{longest?.steps && <span className="text-ink-2"> · {t('taskPage.results.stretchRange', { from: longest.steps[0], to: longest.steps[1] })}</span>}</Fact>,
    <Fact label={t('taskPage.facts.lastRun')}><Time value={lastRunAt} /></Fact>,
  ]} />;
}

const NONE = '__none__';

/** Which batch of runs the results are about, and which other batch to compare it with. Batches are never counted together. */
function BatchBar({ batches, batch, onBatch, compareTo, onCompare, navigate }: { batches: TaskBatch[]; batch: string | undefined; onBatch: (id: string) => void; compareTo: string | undefined; onCompare: (id: string | undefined) => void; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const id = useId(), current = batch ?? batches[0]?.experimentId;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id + '-batch'} className="text-ink-2">{t('taskPage.batch.pick')}</label>
      <Select value={current ?? ''} onValueChange={onBatch}>
        <SelectTrigger id={id + '-batch'} className="max-w-80"><SelectValue /></SelectTrigger>
        <SelectContent>{batches.map(item => <SelectItem key={item.experimentId} value={item.experimentId}>{batchLabel(item, t)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id + '-compare'} className="text-ink-2">{t('taskPage.batch.compare')}</label>
      <Select value={compareTo ?? NONE} onValueChange={value => onCompare(value === NONE ? undefined : value)}>
        <SelectTrigger id={id + '-compare'} className="max-w-80"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('taskPage.batch.compareNone')}</SelectItem>
          {batches.filter(item => item.experimentId !== current).map(item => <SelectItem key={item.experimentId} value={item.experimentId}>{batchLabel(item, t)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    {current && <Link to={{ view: 'runs', batch: current }} navigate={navigate} className="rounded-sm underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{t('batchSummary.ofThisBatch')}</Link>}
    <span className="ml-auto text-sm text-ink-2">{t('taskPage.batch.note')}</span>
  </div>;
}
