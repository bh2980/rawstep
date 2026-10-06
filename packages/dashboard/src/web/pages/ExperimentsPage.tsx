import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ListFilter } from 'lucide-react';
import type { Mode } from '@rawstep/project/config';
import type { Combination, Experiment, PlanRequest } from '../../shared/config';
import { api } from '../api';
import { Choice, Field, MultiChoice, Toggle } from '../components/forms';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/layout/EmptyState';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import type { PageProps } from './types';

export function ExperimentsPage({ onRun, initialTaskId, ...props }: PageProps & { onRun: (e: Experiment) => void; initialTaskId: string | undefined }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [request, setRequest] = useState<PlanRequest>({ taskIds: initialTaskId ? [initialTaskId] : config.tasks.slice(0, 1).map(task => task.id), modelIds: config.models.filter(m => m.roles.includes('decision')).slice(0, 1).map(m => m.id), promptIds: ['baseline'], mode: 'keyboard', repeats: 1 });
  const [rows, setRows] = useState<Combination[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [plannedRequest, setPlannedRequest] = useState<PlanRequest>();
  function update(part: Partial<PlanRequest>) { setRequest({ ...request, ...part }); setRows([]); setPlannedRequest(undefined); }
  const prompts = [...new Map(config.tasks.filter(task => request.taskIds.includes(task.id)).flatMap(task => task.modes[request.mode].prompts).map(p => [p.id, p])).values()];
  const name = (type: 'tasks' | 'models' | 'profiles', id: string) => config[type].find(item => item.id === id)?.name ?? id;
  const profileChoice = request.profileIds !== undefined;
  const setProfileChoice = (pick: boolean) => {
    const next = { ...request };
    if (pick) next.profileIds = [config.profiles[0]!.id]; else delete next.profileIds;
    setRequest(next); setRows([]); setPlannedRequest(undefined);
  };
  const supported = rows.filter(r => r.supported).length;
  async function run(keys: string[]) {
    if (!plannedRequest) return;
    onRun(await api<Experiment>('/experiments', { method: 'POST', body: { ...plannedRequest, selected: keys } }));
  }
  return <>
    <div className="grid gap-8 xl:grid-cols-[300px_minmax(0,1fr)]">
      <section aria-labelledby="exp-combination" className="grid content-start gap-6 border-t-2 border-foreground pt-3"><h2 id="exp-combination" className="text-base font-semibold">{t('experimentsPage.combinationTitle')}</h2><Choice label={t('experimentsPage.observationMode')} value={request.mode} onChange={mode => update({ mode: mode as Mode, promptIds: ['baseline'], diagnoseStop: false })} options={[{ id: 'keyboard', name: t('experimentsPage.modeKeyboard') }, { id: 'screenreader', name: t('experimentsPage.modeScreenreader') }]} /><MultiChoice label={t('experimentsPage.tasks')} items={config.tasks} selected={request.taskIds} onChange={taskIds => update({ taskIds })} /><MultiChoice label={t('experimentsPage.models')} items={config.models.filter(m => m.roles.includes('decision')).map(m => ({ id: m.id, name: m.name + ' · ' + t(`modelSetup.kinds.${m.kind}.name`) }))} selected={request.modelIds} onChange={modelIds => update({ modelIds })} /><MultiChoice label={t('experimentsPage.prompts')} items={prompts} selected={request.promptIds} onChange={promptIds => update({ promptIds })} /><div className="grid gap-3"><Toggle label={t('experimentsPage.compareProfiles')} hint={profileChoice ? t('experimentsPage.compareProfilesOn') : t('experimentsPage.compareProfilesOff')} checked={profileChoice} onChange={setProfileChoice} />{request.profileIds && <MultiChoice label={t('experimentsPage.profiles')} items={config.profiles} selected={request.profileIds} onChange={profileIds => update({ profileIds })} />}</div><Field label={t('experimentsPage.repeats')} type="number" value={String(request.repeats)} onChange={s => update({ repeats: Number(s) })} /><Choice label={t('experimentsPage.analysis')} value={request.analysisModelId ?? 'deterministic'} onChange={id => { const r = { ...request }; if (id === 'deterministic') delete r.analysisModelId; else r.analysisModelId = id; setRequest(r); setRows([]); setPlannedRequest(undefined); }} options={[{ id: 'deterministic', name: t('experimentsPage.analysisDeterministic') }, ...config.models.filter(m => m.kind === 'llm' && m.roles.includes('analysis')).map(m => ({ id: m.id, name: m.name }))]} /><div className="flex gap-3"><Switch id="diagnose-stop" checked={request.diagnoseStop === true} disabled={request.mode !== 'keyboard'} onCheckedChange={diagnoseStop => update({ diagnoseStop })} /><Label htmlFor="diagnose-stop">{t('experimentsPage.diagnoseStop')}</Label></div><p className="text-xs text-muted-foreground">{t('experimentsPage.diagnoseStopNote')}</p><Button variant="outline" disabled={props.busy || request.profileIds?.length === 0} onClick={() => void props.act(async () => { const planned = { ...request, revision: props.view.revision }; const r = await api<Combination[]>('/plan', { method: 'POST', body: planned }); setRows(r); setSelected(r.filter(x => x.supported).map(x => x.key)); setPlannedRequest(structuredClone(planned)); })}><ListFilter aria-hidden="true" />{t('experimentsPage.checkCombinations')}</Button></section>
      <section aria-labelledby="exp-list" className="min-w-0 border-t-2 border-foreground pt-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 id="exp-list" className="text-base font-semibold">{t('experimentsPage.runListTitle')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('experimentsPage.summary', { total: rows.length, supported, selected: selected.length })}</p></div><div className="flex gap-2"><Button variant="outline" disabled={!selected.length || props.busy} onClick={() => void props.act(() => run(selected))}>{t('experimentsPage.runSelected')}</Button><Button disabled={!supported || props.busy} onClick={() => void props.act(() => run(rows.filter(r => r.supported).map(r => r.key)))}><Play aria-hidden="true" />{t('experimentsPage.runAll')}</Button></div></div>{rows.length ? <div className="overflow-x-auto"><Table><TableCaption>{t('experimentsPage.tableCaption')}</TableCaption><TableHeader><TableRow><TableHead>{t('experimentsPage.colSelect')}</TableHead><TableHead>{t('experimentsPage.colTaskMode')}</TableHead><TableHead>{t('experimentsPage.colModel')}</TableHead><TableHead>{t('experimentsPage.colPromptProfile')}</TableHead><TableHead>{t('experimentsPage.colStatus')}</TableHead><TableHead>{t('experimentsPage.colRun')}</TableHead></TableRow></TableHeader><TableBody>{rows.map(r => <TableRow key={r.key}><TableCell><Checkbox aria-label={t('experimentsPage.selectAria', { key: r.key })} checked={selected.includes(r.key)} disabled={!r.supported} onCheckedChange={v => setSelected(v ? [...selected, r.key] : selected.filter(k => k !== r.key))} /></TableCell><TableCell>{name('tasks', r.taskId)}<p className="text-xs text-muted-foreground">{t('experimentsPage.modeRepeat', { mode: t(`sidebar.modes.${request.mode}`), repeat: r.repeat })}</p></TableCell><TableCell>{name('models', r.modelId)}</TableCell><TableCell>{config.tasks.find(task => task.id === r.taskId)?.modes[request.mode].prompts.find(p => p.id === r.promptId)?.name ?? r.promptId}<p className="text-xs text-muted-foreground">{name('profiles', r.profileId)}</p></TableCell><TableCell><Badge variant={r.supported ? 'secondary' : 'outline'}>{r.supported ? t('experimentsPage.ready') : t('experimentsPage.restricted')}</Badge>{r.reason && <p className="mt-2 max-w-60 text-xs text-muted-foreground">{r.reason}</p>}<p className="mt-2 text-xs text-muted-foreground">{t('experimentsPage.permissionSource', { source: r.permissionSource === 'profile' ? t('experimentsPage.sourceProfile') : t('experimentsPage.sourceTask'), count: r.permissions.keys.length + r.permissions.intents.length })}</p></TableCell><TableCell><Button size="sm" variant="ghost" disabled={!r.supported || props.busy} onClick={() => void props.act(() => run([r.key]))}>{t('experimentsPage.runOne')}</Button></TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState title={t('experimentsPage.emptyTitle')} why={t('experimentsPage.emptyWhy')} />}</section>
    </div>
  </>;
}
