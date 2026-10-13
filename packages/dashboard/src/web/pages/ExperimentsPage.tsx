import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ListFilter } from 'lucide-react';
import type { Mode } from '@rawstep/project/config';
import type { Combination, Experiment, PlanRequest } from '../../shared/config';
import { api } from '../api';
import { Field, MultiChoice, Toggle } from '../components/forms';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/layout/EmptyState';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { comboSummary } from '../lib/conditions';
import type { PageProps } from './types';

const MODES = ['screenreader', 'keyboard'] as const satisfies readonly Mode[];

/**
 * The experiment planner: tasks × modes × run profiles × repeats. Left off, every task runs with its own profile. The checked plan
 * lists every run with its profile — structure, planner and executor — and whether it can run, so a person sees what each run will
 * use before starting it.
 */
export function ExperimentsPage({ onRun, initialTaskId, ...props }: PageProps & { onRun: (e: Experiment) => void; initialTaskId: string | undefined }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [request, setRequest] = useState<PlanRequest>({ taskIds: initialTaskId ? [initialTaskId] : config.tasks.slice(0, 1).map(task => task.id), modes: ['screenreader'], repeats: 1 });
  const [rows, setRows] = useState<Combination[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [plannedRequest, setPlannedRequest] = useState<PlanRequest>();
  /** Any change to the request drops the checked plan: it has to be checked again before it runs. */
  const replace = (next: PlanRequest) => { setRequest(next); setRows([]); setPlannedRequest(undefined); };
  const update = (part: Partial<PlanRequest>) => replace({ ...request, ...part });
  const name = (list: readonly { id: string; name: string }[], id: string) => list.find(item => item.id === id)?.name ?? id;
  const profiles = config.profiles.map(({ id, name }) => ({ id, name }));
  /** Turns the profile list on (starting from the first profile) or off (each task's own). */
  const compare = (pick: boolean) => {
    const { profileIds: _off, ...rest } = request;
    replace(pick && profiles[0] ? { ...rest, profileIds: [profiles[0].id] } : rest);
  };
  const supported = rows.filter(r => r.supported).length;
  const empty = request.taskIds.length === 0 || request.modes.length === 0 || request.profileIds?.length === 0;
  async function run(keys: string[]) {
    if (!plannedRequest) return;
    onRun(await api<Experiment>('/experiments', { method: 'POST', body: { ...plannedRequest, selected: keys } }));
  }
  const check = () => void props.act(async () => {
    const planned = { ...request, revision: props.view.revision };
    const r = await api<Combination[]>('/plan', { method: 'POST', body: planned });
    setRows(r); setSelected(r.filter(x => x.supported).map(x => x.key)); setPlannedRequest(structuredClone(planned));
  });
  return <div className="grid gap-8 xl:grid-cols-[300px_minmax(0,1fr)]">
    <section aria-labelledby="exp-combination" className="grid content-start gap-6 border-t-2 border-foreground pt-3">
      <h2 id="exp-combination" className="text-base font-semibold">{t('experimentsPage.combinationTitle')}</h2>
      <MultiChoice label={t('experimentsPage.tasks')} items={config.tasks} selected={request.taskIds} onChange={taskIds => update({ taskIds })} />
      <MultiChoice label={t('experiments.modes')} items={MODES.map(mode => ({ id: mode, name: t(`sidebar.modes.${mode}`) }))} selected={request.modes}
        onChange={modes => update({ modes: MODES.filter(mode => modes.includes(mode)), ...(modes.includes('keyboard') ? {} : { diagnoseStop: false }) })} />
      <div className="grid gap-3">
        <Toggle label={t('experiments.compare')} checked={request.profileIds !== undefined} onChange={compare} info={t('experiments.compareInfo')}
          hint={request.profileIds ? undefined : t('experiments.compareOff')} />
        {request.profileIds && <MultiChoice label={t('runConditions.profile')} items={profiles} selected={request.profileIds} onChange={profileIds => update({ profileIds })} />}
      </div>
      <Field label={t('experimentsPage.repeats')} type="number" value={String(request.repeats)} onChange={s => update({ repeats: Number(s) })} />
      <p className="text-xs leading-5 text-muted-foreground">{t('experiments.analysis')}</p>
      <div className="flex gap-3">
        <Switch id="diagnose-stop" checked={request.diagnoseStop === true} disabled={!request.modes.includes('keyboard')} onCheckedChange={diagnoseStop => update({ diagnoseStop })} />
        <Label htmlFor="diagnose-stop">{t('experimentsPage.diagnoseStop')}</Label>
      </div>
      <p className="text-xs text-muted-foreground">{t('experimentsPage.diagnoseStopNote')}</p>
      <Button variant="outline" disabled={props.busy || empty} onClick={check}><ListFilter aria-hidden="true" />{t('experimentsPage.checkCombinations')}</Button>
    </section>
    <section aria-labelledby="exp-list" className="min-w-0 border-t-2 border-foreground pt-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="exp-list" className="text-base font-semibold">{t('experimentsPage.runListTitle')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('experimentsPage.summary', { total: rows.length, supported, selected: selected.length })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!selected.length || props.busy} onClick={() => void props.act(() => run(selected))}>{t('experimentsPage.runSelected')}</Button>
          <Button disabled={!supported || props.busy} onClick={() => void props.act(() => run(rows.filter(r => r.supported).map(r => r.key)))}><Play aria-hidden="true" />{t('experimentsPage.runAll')}</Button>
        </div>
      </div>
      {rows.length ? <div className="overflow-x-auto"><Table>
        <TableCaption>{t('experiments.tableCaption')}</TableCaption>
        <TableHeader><TableRow>
          <TableHead>{t('experimentsPage.colSelect')}</TableHead>
          <TableHead>{t('experimentsPage.colTaskMode')}</TableHead>
          <TableHead>{t('runConditions.profile')}</TableHead>
          <TableHead>{t('experimentsPage.colStatus')}</TableHead>
          <TableHead>{t('experimentsPage.colRun')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(r => {
          const profile = config.profiles.find(p => p.id === r.profileId);
          return <TableRow key={r.key} className="align-top">
            <TableCell><Checkbox aria-label={t('experimentsPage.selectAria', { key: r.key })} checked={selected.includes(r.key)} disabled={!r.supported} onCheckedChange={v => setSelected(v ? [...selected, r.key] : selected.filter(k => k !== r.key))} /></TableCell>
            <TableCell>{name(config.tasks, r.taskId)}<p className="text-xs text-muted-foreground">{t('experimentsPage.modeRepeat', { mode: t(`sidebar.modes.${r.mode}`), repeat: r.repeat })}</p></TableCell>
            <TableCell>
              <p>{profile?.name ?? r.profileId} <span className="text-xs text-muted-foreground">· {t(`runConditions.structures.${r.structure}`)}</span></p>
              {r.plannerName && <p className="text-xs text-muted-foreground">{t('experiments.planner', { model: r.plannerName })}</p>}
              <p className="text-xs text-muted-foreground">{r.modelName ? t('experiments.executor', { model: r.modelName }) : profile ? comboSummary(profile, config.connections, r.mode) : t('experiments.noExecutor')}</p>
              <p className="text-xs text-muted-foreground">{t('experiments.actionsLine', { count: r.permissions.keys.length + r.permissions.intents.length })}{profile && r.mode === 'screenreader' ? ` · ${t(`conditions.backends.${profile.screenReader}`)}` : ''}</p>
            </TableCell>
            <TableCell>
              <Badge variant={r.supported ? 'secondary' : 'outline'}>{r.supported ? t('experimentsPage.ready') : t('experimentsPage.restricted')}</Badge>
              {r.reason && <p className="mt-2 max-w-60 text-xs text-muted-foreground">{r.reason}</p>}
              {r.warnings.map((warning, i) => <p key={i} className="mt-2 max-w-60 text-xs text-inspect">{warning}</p>)}
            </TableCell>
            <TableCell><Button size="sm" variant="ghost" disabled={!r.supported || props.busy} onClick={() => void props.act(() => run([r.key]))}>{t('experimentsPage.runOne')}</Button></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></div> : <EmptyState title={t('experimentsPage.emptyTitle')} why={t('experiments.emptyWhy')} />}
    </section>
  </div>;
}
