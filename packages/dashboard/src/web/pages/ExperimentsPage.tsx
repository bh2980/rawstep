import { useState } from 'react';
import { Play, ListFilter } from 'lucide-react';
import type { Combination, Experiment, Mode, PlanRequest } from '../../shared/config';
import { api } from '../api';
import { Choice, Field, MultiChoice, SectionHeader } from '../components/forms';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import type { PageProps } from './types';

export function ExperimentsPage({ onRun, ...props }: PageProps & { onRun: (e: Experiment) => void }) {
  const config = props.view.config;
  const [request, setRequest] = useState<PlanRequest>({ taskIds: config.tasks.slice(0, 1).map(t => t.id), modelIds: config.models.filter(m => m.roles.includes('decision')).slice(0, 1).map(m => m.id), promptIds: ['baseline'], mode: 'keyboard', environmentIds: config.environments.slice(0, 1).map(e => e.id), repeats: 1 });
  const [rows, setRows] = useState<Combination[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [plannedRequest, setPlannedRequest] = useState<PlanRequest>();
  function update(part: Partial<PlanRequest>) { setRequest({ ...request, ...part }); setRows([]); setPlannedRequest(undefined); }
  const prompts = [...new Map(config.tasks.filter(t => request.taskIds.includes(t.id)).flatMap(t => t.modes[request.mode].prompts).map(p => [p.id, p])).values()];
  const name = (type: 'tasks' | 'models' | 'environments', id: string) => config[type].find(t => t.id === id)?.name ?? id;
  const supported = rows.filter(r => r.supported).length;
  async function run(keys: string[]) {
    if (!plannedRequest) return;
    onRun(await api<Experiment>('/experiments', { method: 'POST', body: { ...plannedRequest, selected: keys } }));
  }
  return <>
    <SectionHeader title="실험과 실행" description="작업 × 모델 × 프롬프트 × 환경을 조합해 같은 조건에서 비교합니다." />
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card><CardHeader><CardTitle>실행 조합</CardTitle></CardHeader><CardContent className="grid gap-6"><Choice label="관찰 모드" value={request.mode} onChange={mode => update({ mode: mode as Mode, promptIds: ['baseline'], diagnoseStop: false })} options={[{ id: 'keyboard', name: '키보드 — 스크린샷' }, { id: 'screenreader', name: '스크린리더 — 발화' }]} /><MultiChoice label="작업" items={config.tasks} selected={request.taskIds} onChange={taskIds => update({ taskIds })} /><MultiChoice label="모델" items={config.models.filter(m => m.roles.includes('decision')).map(m => ({ id: m.id, name: m.name + ' · ' + m.family }))} selected={request.modelIds} onChange={modelIds => update({ modelIds })} /><MultiChoice label="프롬프트 (작업별 변형)" items={prompts} selected={request.promptIds} onChange={promptIds => update({ promptIds })} /><MultiChoice label="환경" items={config.environments} selected={request.environmentIds} onChange={environmentIds => update({ environmentIds })} /><Field label="조합별 반복 횟수" type="number" value={String(request.repeats)} onChange={s => update({ repeats: Number(s) })} /><Choice label="사후 분석" value={request.analysisModelId ?? 'deterministic'} onChange={id => { const r = { ...request }; if (id === 'deterministic') delete r.analysisModelId; else r.analysisModelId = id; setRequest(r); setRows([]); setPlannedRequest(undefined); }} options={[{ id: 'deterministic', name: '저장된 근거의 기본 분석' }, ...config.models.filter(m => m.family === 'LLM' && m.roles.includes('analysis')).map(m => ({ id: m.id, name: m.name }))]} /><div className="flex gap-3"><Switch id="diagnose-stop" checked={request.diagnoseStop === true} disabled={request.mode !== 'keyboard'} onCheckedChange={diagnoseStop => update({ diagnoseStop })} /><Label htmlFor="diagnose-stop">중단 시 선택적 모델 진단</Label></div><p className="text-xs text-muted-foreground">마지막 스크린샷에 대한 가설을 추가로 요청합니다. 원래 검증 결과는 유지합니다.</p><Button variant="outline" disabled={props.busy} onClick={() => void props.act(async () => { const planned = { ...request, revision: props.view.revision }; const r = await api<Combination[]>('/plan', { method: 'POST', body: planned }); setRows(r); setSelected(r.filter(x => x.supported).map(x => x.key)); setPlannedRequest(structuredClone(planned)); })}><ListFilter aria-hidden="true" />조합 확인</Button></CardContent></Card>
      <Card className="min-w-0"><CardHeader className="flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle>실행할 목록</CardTitle><p className="mt-2 text-xs text-muted-foreground">{rows.length}개 조합 · 실행 가능 {supported}개 · 선택 {selected.length}개</p></div><div className="flex gap-2"><Button variant="outline" disabled={!selected.length || props.busy} onClick={() => void props.act(() => run(selected))}>선택 실행</Button><Button disabled={!supported || props.busy} onClick={() => void props.act(() => run(rows.filter(r => r.supported).map(r => r.key)))}><Play aria-hidden="true" />전체 실행</Button></div></CardHeader><CardContent>{rows.length ? <Table><TableCaption>허용 행동과 입력 지원을 확인한 실행 조합</TableCaption><TableHeader><TableRow><TableHead>선택</TableHead><TableHead>작업·모드</TableHead><TableHead>모델</TableHead><TableHead>프롬프트·환경</TableHead><TableHead>상태</TableHead><TableHead>실행</TableHead></TableRow></TableHeader><TableBody>{rows.map(r => <TableRow key={r.key}><TableCell><Checkbox aria-label={'선택 ' + r.key} checked={selected.includes(r.key)} disabled={!r.supported} onCheckedChange={v => setSelected(v ? [...selected, r.key] : selected.filter(k => k !== r.key))} /></TableCell><TableCell>{name('tasks', r.taskId)}<p className="text-xs text-muted-foreground">{request.mode} · 반복 {r.repeat}</p></TableCell><TableCell>{name('models', r.modelId)}</TableCell><TableCell>{config.tasks.find(t => t.id === r.taskId)?.modes[request.mode].prompts.find(p => p.id === r.promptId)?.name ?? r.promptId}<p className="text-xs text-muted-foreground">{name('environments', r.environmentId)}</p></TableCell><TableCell><Badge variant={r.supported ? 'secondary' : 'outline'}>{r.supported ? '준비됨' : '실행 제한'}</Badge>{r.reason && <p className="mt-2 max-w-60 text-xs text-muted-foreground">{r.reason}</p>}<p className="mt-2 text-xs text-muted-foreground">{r.permissionSource === 'global' ? '전역' : '작업'} 설정 · 행동 {r.permissions.keys.length + r.permissions.intents.length}개</p></TableCell><TableCell><Button size="sm" variant="ghost" disabled={!r.supported || props.busy} onClick={() => void props.act(() => run([r.key]))}>개별 실행</Button></TableCell></TableRow>)}</TableBody></Table> : <div className="grid min-h-80 place-content-center gap-3 text-center"><ListFilter className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="font-medium">실행 조합을 선택하세요</p><p className="text-sm text-muted-foreground">왼쪽에서 항목을 선택하고 조합을 확인하면<br />지원 여부와 실제 허용 기능이 표시됩니다.</p></div>}</CardContent></Card>
    </div>
  </>;
}
