import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Profile } from '@rawstep/project/config';
import type { ProfileFacts, StuckPlace, TaskFindings } from '../../shared/api';
import type { UnmeasuredBy } from '@rawstep/reports/endings';
import type { RouteChange } from '../hooks/useRoute';
import { roleLabel } from '../i18n/labels';
import { formatSteps } from '../lib/format';
import { Link } from './Link';
import { Dash, SectionHead } from './PageHeader';
import { StatusShape } from './StatusMark';
import { StepLink } from './trace/FindingLedgers';

type Props = {
  taskId: string; data: TaskFindings;
  /** "Run #n" of every run of the task, by run id. */
  numbers: ReadonlyMap<string, number>;
  navigate: (change: RouteChange) => void;
  profiles: readonly Pick<Profile, 'id' | 'name'>[];
};

type Ctx = Omit<Props, 'profiles'> & { nameOf: (group: Pick<ProfileFacts, 'profileId'>) => string };

const groupKey = (item: { profileId: string }) => item.profileId;
const head = 'h-8 px-3 text-left align-middle text-xs font-normal text-ink-2 whitespace-nowrap';
const cell = 'h-10 px-3 py-2 align-middle';

/**
 * What the runs of one batch say about the question Rawstep answers: could a first-time user do it, and at what cost. A table by run
 * profile, then where expectations broke (막힌 곳) and why runs gave up. Counts and evidence only; nothing here judges the page.
 */
export function TaskResults({ taskId, data, numbers, navigate, profiles }: Props) {
  const ctx: Ctx = { taskId, data, numbers, navigate, nameOf: group => profiles.find(profile => profile.id === group.profileId)?.name ?? group.profileId };
  return <>
    <ProfileTable {...ctx} />
    {data.stuck.length > 0 && <StuckTable {...ctx} />}
    <GiveUps {...ctx} />
  </>;
}

/** What the profile ran with, after its name in the quiet colour; a combination or environment named after the profile is left out. */
function Subtitle({ group, name }: { group: ProfileFacts; name: string }) {
  const { t } = useTranslation();
  const parts = [...new Set([group.conditions.combo, group.conditions.at].filter((part): part is string => !!part && part !== name))];
  if (group.differing > 0) parts.push(t('taskPage.results.differing', { count: group.differing }));
  return parts.length ? <span className="ml-1.5 text-ink-3" title={group.differing > 0 ? t('taskPage.results.differingInfo') : undefined}>{parts.join(' · ')}</span> : null;
}

/** "포기 1 · 측정 못 함 1 (계획 호출 한도)": the endings other than reaching the goal. */
function endingsLine(group: ProfileFacts, t: TFunction): string {
  return (['gave-up', 'mistaken', 'unmeasured'] as const).filter(ending => group.endings[ending] > 0).map(ending => {
    const base = `${t(`taskPage.results.endingsShort.${ending}`)} ${group.endings[ending]}`;
    if (ending !== 'unmeasured') return base;
    const by = (Object.entries(group.unmeasuredBy) as [UnmeasuredBy, number][]).map(([key, count]) => group.endings.unmeasured > 1 ? t('taskPage.results.byCount', { label: t(`taskPage.results.by.${key}`), count }) : t(`taskPage.results.by.${key}`));
    return by.length ? `${base} (${by.join(', ')})` : base;
  }).join(' · ');
}

const quoted = (place: StuckPlace) => place.target.name ? `${roleLabel(place.target.role)} “${place.target.name}”` : roleLabel(place.target.role);

function Section({ id, title, count, aside, children }: { id: string; title: string; count?: number; aside?: ReactNode; children: ReactNode }) {
  return <section aria-labelledby={id} className="grid">
    <SectionHead id={id} title={title} {...(count !== undefined ? { count } : {})}>{aside}</SectionHead>
    <div className="-mx-3 overflow-x-auto">{children}</div>
  </section>;
}

function ProfileTable({ data, nameOf, numbers, navigate, taskId }: Ctx) {
  const { t } = useTranslation();
  const groups = data.facts.byProfile;
  const topFor = (group: ProfileFacts) => data.stuck.map(place => ({ place, runs: place.byProfile.find(item => groupKey(item) === groupKey(group))?.runs ?? 0 })).filter(item => item.runs > 0).sort((a, b) => b.runs - a.runs)[0];
  return <Section id="results-profiles" title={t('taskPage.results.byProfileTitle')} count={groups.length}>
    <table className="w-full min-w-[56rem] table-fixed border-collapse">
      <colgroup><col /><col className="w-60" /><col className="w-32" /><col className="w-56" /><col className="w-48" /><col className="w-32" /></colgroup>
      <thead><tr className="border-b border-edge">
        <th scope="col" className={head}>{t('taskPage.results.profile')}</th>
        <th scope="col" className={head}>{t('taskPage.results.result')}</th>
        <th scope="col" className={head + ' text-right'}>{t('taskPage.results.cost')}</th>
        <th scope="col" className={head}>{t('taskPage.results.stuckColumn')}</th>
        <th scope="col" className={head + ' text-right'}>{t('taskPage.results.stretch')}</th>
        <th scope="col" className={head}><span className="sr-only">{t('taskPage.results.openRuns')}</span></th>
      </tr></thead>
      <tbody>{groups.map(group => {
        const top = topFor(group), others = endingsLine(group, t), name = nameOf(group);
        return <tr key={groupKey(group)} className="border-b border-edge">
          <th scope="row" className={cell + ' truncate text-left font-medium'}>{name}<Subtitle group={group} name={name} /></th>
          <td className={cell}>
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              {group.reached > 0 && <StatusShape status="reached" />}
              <span className="tabular-nums">{t('taskPage.results.reachedOf', { runs: group.runs, reached: group.reached })}</span>
              {others && <span className="truncate text-ink-2" title={others}>· {others}</span>}
            </span>
            {group.unheard > 0 && <span className="block text-sm text-ink-2 tabular-nums" title={t('taskPage.results.unheardInfo')}>{t('taskPage.results.unheardCount', { unheard: group.unheard, reached: group.reached })}</span>}
          </td>
          <td className={cell + ' text-right tabular-nums'}>{group.medianSteps === null ? <Dash /> : <>
            {t('taskPage.results.moves', { n: formatSteps(group.medianSteps), count: group.medianSteps })}
            {group.minSteps !== group.maxSteps && <span className="block text-sm text-ink-2">{t('taskPage.results.costRange', { min: group.minSteps ?? 0, max: group.maxSteps ?? 0, count: group.maxSteps ?? 0 })}</span>}
          </>}</td>
          <td className={cell + ' truncate'}>{top ? <span title={quoted(top.place)}>{quoted(top.place)} <span className="text-ink-2 tabular-nums">{t('taskPage.results.stuckRunsShort', { runs: top.runs, total: group.runs })}</span></span> : <Dash />}</td>
          <td className={cell + ' text-right whitespace-nowrap tabular-nums'}>{group.longestStretch ? <>
            {t('taskPage.results.moves', { n: group.longestStretch.moves, count: group.longestStretch.moves })}
            {group.longestStretch.steps && <span className="text-ink-2"> · {t('taskPage.results.stretchRange', { from: group.longestStretch.steps[0], to: group.longestStretch.steps[1] })}</span>}
            <span className="text-ink-2"> · </span>
            <StepLink taskId={taskId} runId={group.longestStretch.runId} number={numbers.get(group.longestStretch.runId)} navigate={navigate} />
          </> : <Dash />}</td>
          <td className={cell + ' text-right'}>
            <Link to={{ task: taskId, tab: 'runs' }} navigate={navigate} className="rounded-sm whitespace-nowrap underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{t('taskPage.results.openRunsCount', { count: group.runs })}</Link>
          </td>
        </tr>;
      })}</tbody>
    </table>
  </Section>;
}

/** The first run step where this place's expectation broke, to open. */
function firstOccurrence(data: TaskFindings, index: number): { runId: string; step: number } | undefined {
  for (const result of data.results) { const hit = result.stuck.find(item => item.place === index); if (hit) return { runId: result.runId, step: hit.step }; }
  return undefined;
}

/** Where the simulated user's expectations broke: the element, what it expected, in how many runs, and the first place to open. */
function StuckTable({ data, nameOf, numbers, navigate, taskId }: Ctx) {
  const { t } = useTranslation();
  return <Section id="results-stuck" title={t('taskPage.results.tableStuck')} count={data.stuck.length} aside={<span className="text-sm text-ink-2">{t('taskPage.results.stuckNoteShort')}</span>}>
    <table className="w-full min-w-[52rem] table-fixed border-collapse">
      <colgroup><col className="w-56" /><col /><col className="w-48" /><col className="w-24" /><col className="w-32" /></colgroup>
      <thead><tr className="border-b border-edge">
        <th scope="col" className={head}>{t('taskPage.results.element')}</th>
        <th scope="col" className={head}>{t('taskPage.results.broken')}</th>
        <th scope="col" className={head}>{t('taskPage.evidence.runs')}</th>
        <th scope="col" className={head + ' text-right'}>{t('taskPage.results.gaveUpHere')}</th>
        <th scope="col" className={head}>{t('taskPage.evidence.proof')}</th>
      </tr></thead>
      <tbody>{data.stuck.map((place, index) => { const first = firstOccurrence(data, index);
        return <tr key={index} className="border-b border-edge align-top">
          <th scope="row" className="px-3 py-2.5 text-left font-normal break-words">{quoted(place)}</th>
          <td className="px-3 py-2.5">{place.assumptions.length ? place.assumptions.map(text => <span key={text} className="block">{text}</span>) : <Dash />}</td>
          <td className="px-3 py-2.5 tabular-nums">{t('taskPage.results.stuckRunsShort', { runs: place.runs, total: place.totalRuns })}
            {place.byProfile.length > 1 && <span className="block text-sm text-ink-2">{place.byProfile.map(item => `${nameOf(item)} ${item.runs}`).join(' · ')}</span>}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{place.gaveUpOn > 0 ? place.gaveUpOn : <Dash />}</td>
          <td className="px-3 py-2.5">{first ? <StepLink taskId={taskId} runId={first.runId} number={numbers.get(first.runId)} step={first.step} navigate={navigate} /> : <Dash />}</td>
        </tr>; })}</tbody>
    </table>
  </Section>;
}

/** Why the runs that gave up did, in the user model's words, and the broken expectations each rests on. */
function GiveUps({ data, nameOf, numbers, navigate, taskId }: Ctx) {
  const { t } = useTranslation();
  const given = data.results.filter(result => result.giveUp);
  if (!given.length) return null;
  return <section aria-labelledby="results-giveup" className="grid">
    <SectionHead id="results-giveup" title={t('taskPage.results.giveUpTitle')} count={given.length}><span className="text-sm text-ink-2">{t('taskPage.results.giveUpNote')}</span></SectionHead>
    <ul className="border-t border-edge">{given.map(result => <li key={result.runId} className="grid gap-1.5 border-b border-edge px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-2">
        <StatusShape status="gave-up" />
        <StepLink taskId={taskId} runId={result.runId} number={numbers.get(result.runId)} step={result.giveUp!.step ?? result.steps ?? undefined} navigate={navigate} />
        <span>· {nameOf(result)}</span>
      </p>
      <blockquote>“{result.giveUp!.reason}”</blockquote>
      {result.giveUp!.tried.length > 0 && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
        {result.giveUp!.tried.map(item => <div key={item.id} className="contents">
          <dt className="font-mono text-ink-2">{item.id}</dt>
          <dd className="min-w-0">{item.text ?? <Dash />}{item.step !== undefined && <span className="text-ink-2"> · {t('taskPage.results.triedAt', { target: item.target?.name ? `“${item.target.name}”` : roleLabel(item.target?.role ?? ''), step: item.step })}</span>}</dd>
        </div>)}
      </dl>}
    </li>)}</ul>
  </section>;
}
