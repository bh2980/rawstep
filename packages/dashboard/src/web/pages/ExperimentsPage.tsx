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
import { comboSummary, conditionNames } from '../lib/conditions';
import type { PageProps } from './types';

type Axis = 'presetIds' | 'comboIds' | 'actionSetIds' | 'pageEnvironmentIds' | 'atEnvironmentIds';
const MODES = ['screenreader', 'keyboard'] as const satisfies readonly Mode[];

/**
 * The experiment planner: tasks × modes × conditions (presets, model combos, action sets, page environments, assistive technology
 * environments) × repeats. Each condition axis is optional; left off, every task runs with its own (its choice, its preset's, the
 * first shared item). The checked plan lists every run with its conditions — the combo's structure and its planner and executor —
 * and whether it can run, so a person sees what each run will use before starting it.
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
  /** Shared items first, then task-only copies named with their task, so a copy is never mistaken for the shared one. */
  const choices = (list: readonly { id: string; name: string; owner?: string | undefined }[]) => [...list].sort((a, b) => Number(!!a.owner) - Number(!!b.owner))
    .map(item => ({ id: item.id, name: item.owner ? t('experiments.taskOnly', { name: item.name, task: name(config.tasks, item.owner) }) : item.name }));
  const axes: { key: Axis; label: string; items: { id: string; name: string }[] }[] = [
    { key: 'presetIds', label: t('runConditions.preset'), items: choices(config.presets) },
    { key: 'comboIds', label: t('runConditions.combo'), items: choices(config.combos) },
    { key: 'actionSetIds', label: t('runConditions.actionSet'), items: choices(config.actionSets) },
    { key: 'pageEnvironmentIds', label: t('runConditions.pageEnvironment'), items: choices(config.pageEnvironments) },
    { key: 'atEnvironmentIds', label: t('runConditions.atEnvironment'), items: choices(config.atEnvironments) },
  ];
  /** Turns an optional axis on (starting from the first entry) or off (each task's own). */
  const axis = (key: Axis, first: string | undefined) => (pick: boolean) => {
    const next = { ...request };
    if (pick && first) next[key] = [first]; else delete next[key];
    replace(next);
  };
  const supported = rows.filter(r => r.supported).length;
  const empty = request.taskIds.length === 0 || request.modes.length === 0 || axes.some(a => request[a.key]?.length === 0);
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
      {axes.map(a => <div key={a.key} className="grid gap-3">
        <Toggle label={t('experiments.compare', { condition: a.label })} checked={request[a.key] !== undefined} disabled={a.items.length === 0} onChange={axis(a.key, a.items[0]?.id)}
          hint={request[a.key] ? t(a.key === 'presetIds' ? 'experiments.presetOn' : 'experiments.axisOn') : t(a.key === 'presetIds' ? 'experiments.presetOff' : 'experiments.axisOff')} />
        {request[a.key] && <MultiChoice label={a.label} items={a.items} selected={request[a.key]!} onChange={ids => update({ [a.key]: ids })} />}
      </div>)}
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
          <TableHead>{t('runConditions.condition')}</TableHead>
          <TableHead>{t('experimentsPage.colStatus')}</TableHead>
          <TableHead>{t('experimentsPage.colRun')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(r => {
          const names = conditionNames(config, r), combo = config.combos.find(c => c.id === r.comboId);
          return <TableRow key={r.key} className="align-top">
            <TableCell><Checkbox aria-label={t('experimentsPage.selectAria', { key: r.key })} checked={selected.includes(r.key)} disabled={!r.supported} onCheckedChange={v => setSelected(v ? [...selected, r.key] : selected.filter(k => k !== r.key))} /></TableCell>
            <TableCell>{name(config.tasks, r.taskId)}<p className="text-xs text-muted-foreground">{t('experimentsPage.modeRepeat', { mode: t(`sidebar.modes.${r.mode}`), repeat: r.repeat })}</p></TableCell>
            <TableCell>
              <p>{names.combo} <span className="text-xs text-muted-foreground">· {t(`runConditions.structures.${r.structure}`)}</span>{r.presetId && <span className="text-xs text-muted-foreground"> · {t('experiments.fromPreset', { name: name(config.presets, r.presetId) })}</span>}</p>
              {r.plannerName && <p className="text-xs text-muted-foreground">{t('experiments.planner', { model: r.plannerName })}</p>}
              <p className="text-xs text-muted-foreground">{r.modelName ? t('experiments.executor', { model: r.modelName }) : combo ? comboSummary(combo, config.connections, r.mode) : t('experiments.noExecutor')}</p>
              <p className="text-xs text-muted-foreground">{[t('experiments.actionsLine', { name: names.actionSet, count: r.permissions.keys.length + r.permissions.intents.length }), names.pageEnvironment, ...(r.mode === 'screenreader' ? [names.atEnvironment] : [])].join(' · ')}</p>
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
