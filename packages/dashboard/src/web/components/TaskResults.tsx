import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Profile } from '@rawstep/project/config';
import type { ProfileFacts, RunResult, StuckPlace, TaskFindings } from '../../shared/api';
import type { RunEnding, UnmeasuredBy } from '@rawstep/reports/endings';
import type { RouteChange } from '../hooks/useRoute';
import { roleLabel } from '../i18n/labels';
import { formatSteps } from '../lib/format';
import { screenshotUrl } from '../lib/runs';
import { cn } from '../lib/utils';
import { InfoTip } from './layout/InfoTip';
import { Link } from './Link';
import { RunGlyph } from './trace/RunStrip';

type Props = {
  taskId: string; data: TaskFindings;
  /** "Run #n" of every run of the task, by run id. */
  numbers: ReadonlyMap<string, number>;
  navigate: (change: RouteChange) => void;
  profiles: readonly Pick<Profile, 'id' | 'name'>[];
  /** The fewest moves the goal takes, when the task says. */
  minimalSteps?: number | undefined;
  /** When the newest run started. */
  lastRunAt?: string | undefined;
};
type View = 'picture' | 'table';

const VIEW_KEY = 'rawstep.taskResultsView';
/** More profiles than this do not fit side by side as cards, so the table is shown first. */
const CARD_LIMIT = 4;
const groupKey = (item: { profileId: string; mode: string }) => `${item.profileId}\u0000${item.mode}`;
const ENDING_ORDER: Record<RunEnding, number> = { 'gave-up': 0, mistaken: 1, unmeasured: 2, reached: 3 };
const glyphOf = (ending: RunEnding) => ending === 'reached' ? 'reached' : ending === 'unmeasured' ? 'inconclusive' : 'missed';

function storedView(): View | undefined {
  try { const value = localStorage.getItem(VIEW_KEY); return value === 'picture' || value === 'table' ? value : undefined; } catch { return undefined; }
}

/**
 * What the runs of a task say about the question Rawstep answers: could a first-time user do it, and at what cost. A picture (a card
 * per run profile, where expectations broke on the start page, how far each run went) or the same as tables. Counts and evidence
 * only; nothing here judges the page.
 */
export function TaskResults({ taskId, data, numbers, navigate, profiles, minimalSteps, lastRunAt }: Props) {
  const { t } = useTranslation();
  const groups = data.facts.byProfile;
  const [view, setView] = useState<View>(() => storedView() ?? (groups.length > CARD_LIMIT ? 'table' : 'picture'));
  const choose = (next: View) => { setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* the choice just is not remembered */ } };
  const ctx: Ctx = { taskId, data, numbers, navigate, minimalSteps, nameOf: group => profiles.find(profile => profile.id === group.profileId)?.name ?? group.profileId };
  const date = lastRunAt ? new Date(lastRunAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '—';
  return <section aria-labelledby="results-title" className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="results-title" className="text-[15px] font-semibold">{t('taskPage.results.title')} <span className="text-[13px] font-normal text-muted-foreground">· {t('taskPage.results.scope', { count: data.facts.runs, date })}</span></h2>
      <div role="group" aria-label={t('taskPage.results.view')} className="inline-flex overflow-hidden rounded-sm border border-edge-strong">
        {(['picture', 'table'] as const).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => choose(id)}
          className={cn('h-8 px-3.5 text-[13px] not-first:border-l not-first:border-edge-strong', view === id ? 'bg-foreground text-background' : 'bg-surface hover:bg-raised')}>{t(`taskPage.results.${id}`)}</button>)}
      </div>
    </div>
    {view === 'picture' ? <Picture {...ctx} /> : <Tables {...ctx} />}
  </section>;
}

type Ctx = Omit<Props, 'profiles' | 'lastRunAt'> & { nameOf: (group: Pick<ProfileFacts, 'profileId'>) => string };

function Picture(ctx: Ctx) {
  const groups = ctx.data.facts.byProfile;
  return <>
    <div className={cn('grid gap-4', groups.length > 1 && 'md:grid-cols-2')}>{groups.map(group => <ProfileCard key={groupKey(group)} group={group} {...ctx} />)}</div>
    {ctx.data.results.some(result => result.mode === 'screenreader') && <StuckMap {...ctx} />}
    <Journeys {...ctx} />
    <GiveUps {...ctx} />
  </>;
}

function Subtitle({ group, name }: { group: ProfileFacts; name: string }) {
  const { t } = useTranslation();
  // A combination or environment named after the profile says nothing the title does not.
  const parts = [...new Set([t(`sidebar.modes.${group.mode}`), group.conditions.combo, group.conditions.at].filter((part): part is string => !!part && part !== name))];
  return <div className="text-xs text-muted-foreground">{parts.join(' · ')}
    {group.differing > 0 && <> · <span className="inline-flex items-center gap-1 text-inspect">{t('taskPage.results.differing', { count: group.differing })}<InfoTip term={t('taskPage.results.differing', { count: group.differing })}>{t('taskPage.results.differingInfo')}</InfoTip></span></>}
  </div>;
}

/** "포기 1 · 측정 못 함 1 (계획 호출 한도)": the endings other than reaching the goal. */
function endingsLine(group: ProfileFacts, t: TFunction): string {
  const parts = (['gave-up', 'mistaken', 'unmeasured'] as const).filter(ending => group.endings[ending] > 0).map(ending => {
    const base = `${t(`taskPage.results.endingsShort.${ending}`)} ${group.endings[ending]}`;
    if (ending !== 'unmeasured') return base;
    const by = (Object.entries(group.unmeasuredBy) as [UnmeasuredBy, number][]).map(([key, count]) => group.endings.unmeasured > 1 ? t('taskPage.results.byCount', { label: t(`taskPage.results.by.${key}`), count }) : t(`taskPage.results.by.${key}`));
    return by.length ? `${base} (${by.join(', ')})` : base;
  });
  return parts.join(' · ');
}

function ProfileCard({ group, nameOf, minimalSteps, data, numbers, navigate, taskId }: Ctx & { group: ProfileFacts }) {
  const { t } = useTranslation();
  const own = data.results.filter(result => groupKey(result) === groupKey(group));
  const others = endingsLine(group, t);
  return <article aria-label={nameOf(group)} className="grid content-start gap-3 rounded-md border border-edge bg-surface p-4">
    <div className="grid gap-0.5"><h3 className="text-[15px] font-semibold">{nameOf(group)}</h3><Subtitle group={group} name={nameOf(group)} /></div>
    <div className="grid grid-cols-2 gap-4">
      <div className="grid content-start gap-1.5">
        <div className="text-xs text-muted-foreground">{t('taskPage.results.did')}</div>
        <div className="flex items-baseline gap-1.5"><span className="text-3xl font-bold tracking-tight tabular-nums">{t('taskPage.results.didCount', { reached: group.reached, runs: group.runs })}</span><span>{t('taskPage.results.didWord')}</span></div>
        <div className="flex flex-wrap gap-1" aria-hidden="true">{own.map(result => <RunGlyph key={result.runId} kind={glyphOf(result.ending)} className="size-4" />)}</div>
        {others && <div className="text-xs text-muted-foreground">{others}</div>}
      </div>
      <div className="grid content-start gap-1.5">
        <div className="text-xs text-muted-foreground">{t('taskPage.results.cost')}</div>
        {group.medianSteps === null
          ? <div className="text-sm text-muted-foreground">{t('taskPage.results.costNone')}</div>
          : <><div className="flex items-baseline gap-1.5"><span className="text-3xl font-bold tracking-tight tabular-nums">{formatSteps(group.medianSteps)}</span><span>{t('taskPage.results.costUnit')}</span></div>
            <div className="text-xs text-muted-foreground tabular-nums">{[group.minSteps !== group.maxSteps ? t('taskPage.results.costRange', { min: group.minSteps ?? 0, max: group.maxSteps ?? 0 }) : undefined,
              minimalSteps !== undefined ? t('taskPage.results.minimal', { n: minimalSteps }) : undefined].filter(Boolean).join(' · ')}</div></>}
      </div>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-edge pt-2.5 text-[13px]">
      {group.mode === 'screenreader' && <span className="inline-flex items-center gap-1">{t('taskPage.results.unheard')} <strong className={cn('font-semibold tabular-nums', group.unheard > 0 && 'text-inspect')}>{group.unheard}</strong>
        {group.reached > 0 && <span className="text-muted-foreground tabular-nums">/ {group.reached}</span>}<InfoTip term={t('taskPage.results.unheard')}>{t('taskPage.results.unheardInfo')}</InfoTip></span>}
      {group.wrongGuesses !== null && group.mode === 'screenreader' && <span className="inline-flex items-center gap-1">{t('taskPage.results.wrongGuesses')} <strong className="font-semibold tabular-nums">{t('taskPage.results.moves', { n: formatSteps(group.wrongGuesses) })}</strong>
        <InfoTip term={t('taskPage.results.wrongGuesses')}>{t('taskPage.results.wrongGuessesInfo')}</InfoTip></span>}
      {group.longestStretch && <span className="inline-flex items-center gap-1">{t('taskPage.results.stretch')} <strong className="font-semibold tabular-nums">{t('taskPage.results.moves', { n: group.longestStretch.moves })}</strong>
        <RunLink taskId={taskId} runId={group.longestStretch.runId} numbers={numbers} navigate={navigate} /><InfoTip term={t('taskPage.results.stretch')}>{t('taskPage.results.stretchInfo')}</InfoTip></span>}
    </div>
  </article>;
}

function RunLink({ taskId, runId, step, numbers, navigate, children }: { taskId: string; runId: string; step?: number | undefined; numbers: ReadonlyMap<string, number>; navigate: (change: RouteChange) => void; children?: ReactNode }) {
  return <Link to={{ task: taskId, run: runId, ...(step !== undefined ? { step } : {}) }} navigate={navigate} className="rounded-sm text-trace tabular-nums underline-offset-2 hover:underline">
    {children ?? `#${numbers.get(runId) ?? '?'}`}
  </Link>;
}

/** A stuck place's pin colour: where some run gave up is the strongest mark. */
const pinClass = (place: StuckPlace) => place.gaveUpOn > 0 ? 'bg-missed text-white' : 'bg-inspect text-white';
const quoted = (place: StuckPlace) => place.target.name ? `“${place.target.name}”` : roleLabel(place.target.role);

function Pin({ n, place, className }: { n: number; place: StuckPlace; className?: string }) {
  return <span aria-hidden="true" className={cn('grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold', pinClass(place), className)}>{n}</span>;
}

/** The first run step where this place's expectation broke, to open. */
function firstOccurrence(results: readonly RunResult[], index: number): { runId: string; step: number } | undefined {
  for (const result of results) { const hit = result.stuck.find(item => item.place === index); if (hit) return { runId: result.runId, step: hit.step }; }
  return undefined;
}

function StuckMap({ data, taskId, numbers, navigate }: Ctx) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const places = data.stuck, shown = all ? places : places.slice(0, 6);
  return <section aria-labelledby="stuck-title" className="rounded-md border border-edge bg-surface">
    <h2 id="stuck-title" className="border-b border-edge px-4 pt-3.5 pb-2.5 text-[15px] font-semibold">{t('taskPage.results.stuckTitle')}</h2>
    {places.length === 0
      ? <p className="p-4 text-sm text-muted-foreground">{t('taskPage.results.stuckEmpty')}</p>
      : <div className="flex flex-wrap gap-5 p-4">
        <div className="min-w-0 flex-[0_1_40rem]"><StartPage data={data} /></div>
        <div className="grid min-w-0 flex-[1_1_20rem] content-start">
          <ol className="grid">
            {shown.map((place, index) => {
              const first = firstOccurrence(data.results, index);
              return <li key={index} className="flex gap-3 border-b border-edge py-3.5 first:pt-0">
                <Pin n={index + 1} place={place} className="mt-0.5" />
                <div className="grid min-w-0 gap-1">
                  <div className="font-semibold break-words">{quoted(place)} <span className="text-xs font-normal text-muted-foreground">{roleLabel(place.target.role)}{!place.location && data.startPage ? ` · ${t('taskPage.results.stuckOffPage')}` : ''}</span></div>
                  {place.assumptions.map(text => <div key={text} className="text-[13px]">{text}</div>)}
                  <div className="text-[13px]"><strong className="font-semibold tabular-nums">{t('taskPage.results.stuckRuns', { runs: place.runs, total: place.totalRuns })}</strong>
                    {place.gaveUpOn > 0 && <> · <span className="font-medium text-missed">{t('taskPage.results.stuckGaveUp', { count: place.gaveUpOn })}</span></>}</div>
                  {first && <RunLink taskId={taskId} runId={first.runId} step={first.step} numbers={numbers} navigate={navigate}>
                    <span className="text-[13px]">{t('taskPage.results.stuckView', { number: numbers.get(first.runId) ?? '?', step: first.step })} →</span></RunLink>}
                </div>
              </li>;
            })}
          </ol>
          {places.length > 6 && <button type="button" onClick={() => setAll(!all)} className="justify-self-start pt-2 text-[13px] text-trace hover:underline">{all ? t('taskPage.results.fewerRuns') : t('taskPage.results.moreRuns', { count: places.length - 6 })}</button>}
          <p className="pt-3.5 text-xs text-muted-foreground">{t('taskPage.results.stuckNote')}</p>
        </div>
      </div>}
  </section>;
}

/** Space kept above and below the pins when a long start page is cut to the part they are on, in page pixels. */
const CROP_MARGIN = 200;

/** The start page with the stuck places pinned on it; a long page is cut to the stretch the pins are in. */
function StartPage({ data }: { data: TaskFindings }) {
  const { t } = useTranslation();
  const page = data.startPage;
  if (!page) return <p className="text-sm text-muted-foreground">{t('taskPage.results.startPageNone')}</p>;
  const pinned = data.stuck.map((place, index) => ({ place, index })).filter(item => item.place.location);
  const top = pinned.length ? Math.max(0, Math.min(...pinned.map(item => item.place.location!.y)) - CROP_MARGIN) : 0;
  const bottom = pinned.length ? Math.min(page.height, Math.max(...pinned.map(item => item.place.location!.y + item.place.location!.height)) + CROP_MARGIN) : page.height;
  // Never narrower than a screen's worth of page, so a single pin still shows what is around it.
  const span = Math.min(page.height, Math.max(bottom - top, page.width * 0.75)), from = Math.max(0, Math.min(top, page.height - span));
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  return <div className="max-h-[40rem] overflow-y-auto rounded-sm border border-edge">
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${page.width} / ${span}` }}>
      <div className="absolute inset-x-0 top-0" style={{ aspectRatio: `${page.width} / ${page.height}`, transform: `translateY(-${pct(from, page.height)})` }}>
        <img src={screenshotUrl(page.experimentId, page.runId, page.eventId)} alt={t('taskPage.results.startPage')} className="block w-full" />
        {pinned.map(({ place, index }) => { const box = place.location!;
          return <div key={index} aria-hidden="true">
            <div className={cn('absolute rounded-[2px] border-2', place.gaveUpOn > 0 ? 'border-missed' : 'border-inspect')} style={{ left: pct(box.x, page.width), top: pct(box.y, page.height), width: pct(box.width, page.width), height: pct(box.height, page.height) }} />
            <div className="absolute -translate-x-full -translate-y-1/4 pr-0.5" style={{ left: pct(box.x, page.width), top: pct(box.y, page.height) }}><Pin n={index + 1} place={place} /></div>
          </div>; })}
      </div>
    </div>
  </div>;
}

/** Each run as a bar of the moves it made, its stuck places on it and the fewest moves as a line. */
function Journeys({ data, nameOf, numbers, navigate, taskId, minimalSteps }: Ctx) {
  const { t } = useTranslation();
  const groups = data.facts.byProfile;
  const longest = Math.max(1, minimalSteps ?? 0, ...data.results.map(result => result.steps ?? 0));
  const pct = (n: number) => `${Math.min(100, (n / longest) * 100)}%`;
  return <section aria-labelledby="journey-title" className="rounded-md border border-edge bg-surface">
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 pt-3.5 pb-2.5">
      <h2 id="journey-title" className="text-[15px] font-semibold">{t('taskPage.results.journeyTitle')}</h2>
      <div className="flex flex-wrap gap-3.5 text-xs text-muted-foreground">
        {minimalSteps !== undefined && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0.5 bg-foreground" />{t('taskPage.results.journeyMinimal', { n: minimalSteps })}</span>}
        {data.stuck.length > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-inspect" />{t('taskPage.results.journeyStuck')}</span>}
      </div>
    </div>
    <div className="grid gap-2 overflow-x-auto px-4 pt-3 pb-4">
      {groups.map((group, g) => <div key={groupKey(group)} className={cn('grid gap-2', g > 0 && 'border-t border-edge pt-2')}>
        {data.results.filter(result => groupKey(result) === groupKey(group)).map(result => {
          const steps = result.steps ?? 0, ending = t(`taskPage.results.endingsShort.${result.ending}`);
          return <div key={result.runId} className="grid grid-cols-[8rem_minmax(16rem,1fr)_10rem] items-center gap-3 text-[13px]">
            <RunLink taskId={taskId} runId={result.runId} numbers={numbers} navigate={navigate}><span className="text-foreground">#{numbers.get(result.runId) ?? '?'} {nameOf(group)}</span></RunLink>
            <div className="relative h-3.5 bg-raised" aria-hidden="true">
              <div className={cn('absolute inset-y-0 left-0', result.ending === 'reached' ? 'bg-reach' : result.ending === 'unmeasured' ? 'border-[1.5px] border-muted-foreground bg-surface' : 'glyph-missed')} style={{ width: pct(steps) }} />
              {result.stuck.map(item => <span key={`${item.place}:${item.step}`} className="absolute -top-0.5" style={{ left: `calc(${pct(item.step)} - 9px)` }}>
                <Pin n={item.place + 1} place={data.stuck[item.place]!} className="size-[18px] text-[10px]" /></span>)}
              {minimalSteps !== undefined && <span className="absolute -inset-y-[3px] w-0.5 bg-foreground" style={{ left: pct(minimalSteps) }} />}
            </div>
            <div className={cn(result.ending === 'gave-up' || result.ending === 'mistaken' ? 'text-missed' : result.ending === 'unmeasured' && 'text-muted-foreground')}>
              <strong className="font-semibold">{ending}</strong> · {t('taskPage.results.moves', { n: steps })}{result.by && <span className="text-xs"> ({t(`taskPage.results.by.${result.by}`)})</span>}
            </div>
          </div>;
        })}
      </div>)}
    </div>
  </section>;
}

/** A section that starts folded: its title and count on a line that opens it. `dashed` marks the weaker, model-side evidence. */
export function Fold({ id, title, count, dashed, children }: { id: string; title: ReactNode; count: number; dashed?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <section aria-labelledby={id} className={cn('rounded-md border bg-surface', dashed ? 'border-dashed border-edge-strong' : 'border-edge')}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 rounded-md px-4 py-3 text-left hover:bg-raised">
      <span id={id} className="inline-flex items-center gap-2 font-semibold">{title} <span className="font-normal text-muted-foreground tabular-nums">{count}</span></span>
      <span className="text-[13px] text-muted-foreground">{open ? t('taskPage.results.collapse') : t('taskPage.results.expand')}</span>
    </button>
    {open && <div className="border-t border-edge p-4">{children}</div>}
  </section>;
}

/** Why the runs that gave up did, and the broken expectations each rests on. */
function GiveUps({ data, nameOf, numbers, navigate, taskId }: Ctx) {
  const { t } = useTranslation();
  const given = data.results.filter(result => result.giveUp);
  if (!given.length) return null;
  return <Fold id="giveup-title" title={t('taskPage.results.giveUpTitle')} count={given.length}>
    <div className="grid gap-4">
      {given.map(result => <div key={result.runId} className="grid gap-2">
        <div className="text-xs text-muted-foreground">{nameOf(result)} · <RunLink taskId={taskId} runId={result.runId} step={result.giveUp!.step} numbers={numbers} navigate={navigate}>
          {t('taskPage.results.giveUpAt', { number: numbers.get(result.runId) ?? '?', step: result.giveUp!.step ?? result.steps ?? '?' })}</RunLink></div>
        <blockquote className="border-l-2 border-missed pl-3 text-sm">“{result.giveUp!.reason}”</blockquote>
        {result.giveUp!.tried.length > 0 && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          {result.giveUp!.tried.map(item => <div key={item.id} className="contents">
            <dt className="font-mono text-xs text-muted-foreground">{item.id}</dt>
            <dd className="min-w-0">{item.text ?? '—'}{item.step !== undefined && <span className="text-muted-foreground"> · {t('taskPage.results.triedAt', { target: item.target?.name ? `“${item.target.name}”` : roleLabel(item.target?.role ?? ''), step: item.step })}</span>}</dd>
          </div>)}
        </dl>}
      </div>)}
      <p className="text-xs text-muted-foreground">{t('taskPage.results.giveUpNote')}</p>
    </div>
  </Fold>;
}

const th = 'px-3 py-2 text-left font-normal whitespace-nowrap', td = 'px-3 py-2 align-top';

function Tables(ctx: Ctx) {
  const { t } = useTranslation();
  const { data, nameOf, minimalSteps, numbers, navigate, taskId } = ctx;
  const [all, setAll] = useState(false);
  const sorted = [...data.results].sort((a, b) => ENDING_ORDER[a.ending] - ENDING_ORDER[b.ending] || (numbers.get(b.runId) ?? 0) - (numbers.get(a.runId) ?? 0));
  const runs = all ? sorted : sorted.slice(0, 5);
  const topFor = (group: ProfileFacts) => data.stuck.map((place, index) => ({ place, index, runs: place.byProfile.find(item => groupKey(item) === groupKey(group))?.runs ?? 0 })).filter(item => item.runs > 0).sort((a, b) => b.runs - a.runs)[0];
  const line = (result: RunResult) => result.giveUp ? result.giveUp.reason : result.by ? t(`taskPage.results.by.${result.by}`) : result.ending === 'reached' ? t(result.unheard ? 'taskPage.results.lineUnheard' : 'taskPage.results.lineReached') : t(`taskPage.results.endingInfo.${result.ending}`);
  return <>
    <TableBox label={t('taskPage.results.tableProfiles')}>
      <thead><tr className="border-b border-edge bg-raised text-xs text-muted-foreground">
        <th scope="col" className={th}>{t('taskPage.results.profile')}</th><th scope="col" className={th}>{t('taskPage.results.did')}</th><th scope="col" className={th}>{t('taskPage.results.cost')}</th>
        <th scope="col" className={th}>{t('taskPage.results.topStuck')}</th><th scope="col" className={th}>{t('taskPage.results.stretch')}</th><th scope="col" className={th}>{t('taskPage.results.unheard')}</th>
      </tr></thead>
      <tbody>{data.facts.byProfile.map(group => { const top = topFor(group), others = endingsLine(group, t);
        return <tr key={groupKey(group)} className="border-b border-edge last:border-0">
          <th scope="row" className={cn(td, 'text-left font-normal')}><div className="font-semibold">{nameOf(group)}</div><Subtitle group={group} name={nameOf(group)} /></th>
          <td className={td}><div className="whitespace-nowrap"><strong className="font-semibold tabular-nums">{group.reached} / {group.runs}</strong> {t('taskPage.results.didWord')}</div>{others && <div className="text-xs text-muted-foreground">{others}</div>}</td>
          <td className={td}>{group.medianSteps === null ? <span className="text-muted-foreground">{t('taskPage.results.costNone')}</span>
            : <><div className="whitespace-nowrap tabular-nums">{t('taskPage.results.typical', { n: formatSteps(group.medianSteps) })}{group.minSteps !== group.maxSteps && <span className="text-muted-foreground"> ({group.minSteps}–{group.maxSteps})</span>}</div>
              {minimalSteps !== undefined && <div className="text-xs text-muted-foreground">{t('taskPage.results.minimal', { n: minimalSteps })}</div>}</>}</td>
          <td className={td}>{top ? <div className="flex gap-2"><Pin n={top.index + 1} place={top.place} /><div><div>{quoted(top.place)}</div><div className="text-xs text-muted-foreground">{t('taskPage.results.stuckRunsShort', { runs: top.runs, total: group.runs })}</div></div></div> : <span className="text-muted-foreground">{t('taskPage.results.none')}</span>}</td>
          <td className={cn(td, 'whitespace-nowrap tabular-nums')}>{group.longestStretch ? <>{t('taskPage.results.moves', { n: group.longestStretch.moves })} <RunLink taskId={taskId} runId={group.longestStretch.runId} numbers={numbers} navigate={navigate} /></> : '—'}</td>
          <td className={cn(td, 'whitespace-nowrap tabular-nums', group.unheard > 0 && 'font-medium text-inspect')}>{group.mode === 'screenreader' ? `${group.unheard}${group.reached ? ` / ${group.reached}` : ''}` : '—'}</td>
        </tr>; })}</tbody>
    </TableBox>
    {data.stuck.length > 0 && <TableBox label={t('taskPage.results.tableStuck')} note={t('taskPage.results.stuckNote')} count={data.stuck.length}>
      <thead><tr className="border-b border-edge bg-raised text-xs text-muted-foreground">
        <th scope="col" className={th}>{t('taskPage.results.element')}</th><th scope="col" className={th}>{t('taskPage.results.broken')}</th>
        <th scope="col" className={th}>{t('taskPage.results.stuckColumn')}</th><th scope="col" className={cn(th, 'text-right')}>{t('taskPage.results.gaveUpHere')}</th>
      </tr></thead>
      <tbody>{data.stuck.map((place, index) => <tr key={index} className="border-b border-edge last:border-0">
        <th scope="row" className={cn(td, 'text-left font-normal')}><div className="flex gap-2"><Pin n={index + 1} place={place} /><div><div className="text-xs text-muted-foreground">{roleLabel(place.target.role)}</div><div>{place.target.name ?? '—'}</div></div></div></th>
        <td className={td}>{place.assumptions.map(text => <div key={text}>{text}</div>)}</td>
        <td className={td}><div className="whitespace-nowrap tabular-nums font-semibold">{t('taskPage.results.stuckRunsShort', { runs: place.runs, total: place.totalRuns })}</div>
          <div className="text-xs text-muted-foreground">{place.byProfile.map(item => `${nameOf(item)} ${item.runs}`).join(' · ')}</div></td>
        <td className={cn(td, 'text-right tabular-nums', place.gaveUpOn > 0 && 'font-medium text-missed')}>{place.gaveUpOn}</td>
      </tr>)}</tbody>
    </TableBox>}
    <TableBox label={t('taskPage.results.tableRuns')} count={data.results.length}>
      <thead><tr className="border-b border-edge bg-raised text-xs text-muted-foreground">
        <th scope="col" className={th}>#</th><th scope="col" className={th}>{t('taskPage.results.profile')}</th><th scope="col" className={th}>{t('taskPage.results.result')}</th>
        <th scope="col" className={cn(th, 'text-right')}>{t('taskPage.results.stepsColumn')}</th><th scope="col" className={th}>{t('taskPage.results.stuckColumn')}</th>
        <th scope="col" className={cn(th, 'text-right')}>{t('taskPage.results.wrongGuessesColumn')}</th><th scope="col" className={th}>{t('taskPage.results.line')}</th>
      </tr></thead>
      <tbody>{runs.map(result => <tr key={result.runId} className="border-b border-edge last:border-0">
        <td className={td}><RunLink taskId={taskId} runId={result.runId} numbers={numbers} navigate={navigate} /></td>
        <td className={td}>{nameOf(result)}</td>
        <td className={cn(td, 'whitespace-nowrap')}><span className="inline-flex items-center gap-1.5"><RunGlyph kind={glyphOf(result.ending)} />{t(`taskPage.results.endings.${result.ending}`)}</span></td>
        <td className={cn(td, 'text-right tabular-nums')}>{result.steps ?? '—'}</td>
        <td className={td}>{result.stuck.length ? <span className="inline-flex gap-1">{[...new Set(result.stuck.map(item => item.place))].map(place => <Pin key={place} n={place + 1} place={data.stuck[place]!} />)}</span> : '—'}</td>
        <td className={cn(td, 'text-right tabular-nums')}>{result.mode === 'screenreader' ? result.wrongGuesses : '—'}</td>
        <td className={cn(td, 'max-w-[28rem]')}><span className="line-clamp-2" title={line(result)}>{line(result)}</span></td>
      </tr>)}</tbody>
    </TableBox>
    {sorted.length > 5 && <div className="-mt-2 flex gap-2 text-xs text-muted-foreground"><span>{t('taskPage.results.runsOrder')}</span> ·
      <button type="button" onClick={() => setAll(!all)} className="text-trace hover:underline">{all ? t('taskPage.results.fewerRuns') : t('taskPage.results.moreRuns', { count: sorted.length - 5 })}</button></div>}
  </>;
}

function TableBox({ label, note, count, children }: { label: string; note?: string; count?: number; children: ReactNode }) {
  return <section aria-label={label} className="grid gap-2">
    <h3 className="text-sm font-semibold">{label}{count !== undefined && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}{note && <span className="ml-2 text-xs font-normal text-muted-foreground">{note}</span>}</h3>
    <div className="overflow-x-auto rounded-md border border-edge bg-surface"><table className="w-full min-w-[44rem] text-[13px]">{children}</table></div>
  </section>;
}
