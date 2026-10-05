import { useState } from 'react';
import { Plus, Copy, Save } from 'lucide-react';
import { defaultModes, type ManagedTask, type Mode } from '../../shared/config';
import { api } from '../api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Field, SectionHeader } from '../components/forms';
import { TaskFields } from '../components/TaskFields';
import { PermissionsEditor } from '../components/PermissionsEditor';
import type { PageProps } from './types';

export function TasksPage(props: PageProps) {
  const [selected, setSelected] = useState(props.view.config.tasks[0]?.id ?? '');
  const [newTask, setNewTask] = useState<ManagedTask>();
  const [newJson, setNewJson] = useState<unknown>();
  const [importPath, setImportPath] = useState('');
  const managed = newTask ?? props.view.config.tasks.find(t => t.id === selected);
  function create() { setNewJson(undefined); const id = crypto.randomUUID(); setNewTask({ id, name: '새 작업', file: 'tasks/' + id + '.json', modes: defaultModes() }); }
  return <>
    <SectionHeader title="작업" description="목표와 성공 조건, 모드별 프롬프트·허용 행동을 함께 관리합니다."><Button onClick={create}><Plus aria-hidden="true" />작업 추가</Button></SectionHeader>
    <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="grid content-start gap-3"><Card><CardContent className="grid gap-2 pt-4">{props.view.config.tasks.map(t => <Button key={t.id} variant={selected === t.id && !newTask ? 'secondary' : 'ghost'} className="justify-start truncate" onClick={() => { setNewTask(undefined); setSelected(t.id); }}>{t.name}</Button>)}{!props.view.config.tasks.length && <p className="text-sm text-muted-foreground">작업을 추가하거나 기존 Task JSON을 가져오세요.</p>}</CardContent></Card>
        <Card><CardContent className="grid gap-3 pt-4"><Field label="가져올 Task 경로" value={importPath} onChange={setImportPath} hint="프로젝트 내부 JSON 경로" /><Button variant="outline" disabled={props.busy || !importPath} onClick={() => void props.act(async () => { const task = await api<unknown>('/tasks/import', { method: 'POST', body: { file: importPath } }); const id = crypto.randomUUID(); const t = { id, name: importPath.split('/').pop() ?? '가져온 작업', file: importPath, modes: defaultModes() }; await props.save({ ...props.view.config, tasks: [...props.view.config.tasks, t] }); setNewTask(undefined); setSelected(id); void task; })}>기존 JSON 가져오기</Button></CardContent></Card>
      </aside>
      {managed ? <TaskEditor key={managed.id} {...props} managed={managed} initial={newTask ? newJson : props.view.tasks[managed.id]} onSaved={() => { setNewTask(undefined); setSelected(managed.id); }} onDuplicate={(t, json) => { setNewTask(t); setNewJson(json); }} /> : <Card><CardContent className="py-16 text-center text-muted-foreground">왼쪽에서 작업을 선택하세요.</CardContent></Card>}
    </div>
  </>;
}
function TaskEditor({ managed, initial, onSaved, onDuplicate, ...props }: PageProps & { managed: ManagedTask; initial?: unknown; onSaved: () => void; onDuplicate: (t: ManagedTask, json: unknown) => void }) {
  const [task, setTask] = useState(() => structuredClone(managed));
  const [revision, setRevision] = useState(props.view.revision);
  const [json, setJson] = useState(JSON.stringify(initial ?? { mode: 'keyboard', url: 'https://example.com', goal: '목표를 입력하세요', maxSteps: 40, timeoutMs: 120000, verify: { all: [{ titleIncludes: 'Example Domain' }] } }, null, 2));
  const [mode, setMode] = useState<Mode>('keyboard');
  const modeValue = task.modes[mode];
  const inputs = (() => { try { return Object.keys(JSON.parse(json).input ?? {}); } catch { return []; } })();
  const updateMode = (value: Partial<typeof modeValue>) => setTask({ ...task, modes: { ...task.modes, [mode]: { ...modeValue, ...value } } });
  return <div className="grid gap-6">
    <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>작업 정보</CardTitle><Button variant="outline" onClick={() => void props.act(async () => { const id = crypto.randomUUID(); onDuplicate({ ...structuredClone(task), id, name: task.name + ' 복사', file: 'tasks/' + id + '.json' }, JSON.parse(json)); })}><Copy aria-hidden="true" />복제</Button></CardHeader><CardContent className="grid gap-4"><Field label="작업 이름" value={task.name} onChange={name => setTask({ ...task, name })} /><Field label="Task JSON 파일" value={task.file} onChange={file => setTask({ ...task, file })} /><TaskFields json={json} onChange={setJson} /><details><summary className="cursor-pointer text-sm font-medium">고급 Task JSON 편집</summary><div className="mt-4"><Field label="Task JSON" multiline value={json} onChange={setJson} hint="url·goal·verify.all·input·maxSteps·timeoutMs·navigation·profile을 편집합니다. 모델 선택에는 goal과 관찰만 전달하며 verify는 Runner의 독립 검증에 사용합니다." /></div></details></CardContent></Card>
    <Card><CardHeader><CardTitle>모드별 설정</CardTitle></CardHeader><CardContent>
      <Tabs value={mode} onValueChange={v => setMode(v as Mode)}><TabsList><TabsTrigger value="keyboard">키보드</TabsTrigger><TabsTrigger value="screenreader">스크린리더</TabsTrigger></TabsList>
      {(['keyboard', 'screenreader'] as const).map(m => <TabsContent key={m} value={m} className="mt-6"><div className="grid gap-6 lg:grid-cols-2"><div className="grid content-start gap-5"><h3 className="font-medium">허용 기능</h3><div className="flex items-center gap-3"><Switch id={task.id + m} checked={modeValue.permissions !== null} onCheckedChange={v => updateMode({ permissions: v ? structuredClone(props.view.config.globals[mode]) : null })} /><Label htmlFor={task.id + m}>작업별 사용자 지정</Label></div><p className="text-xs text-muted-foreground">{modeValue.permissions ? '선택 목록이 전역 기본값을 대체합니다. 빈 목록은 탐색·입력을 모두 금지합니다.' : '전역 설정을 사용합니다.'}</p>{modeValue.permissions && <PermissionsEditor key={m} value={modeValue.permissions} onChange={permissions => updateMode({ permissions })} capabilities={props.view.capabilities[mode]} inputNames={inputs} />}</div>
        <div className="grid content-start gap-5"><h3 className="font-medium">프롬프트 변형</h3><p className="text-xs leading-5 text-muted-foreground">실행 지침만 편집합니다. 목표·후보·관찰·이력은 실행 중 자동 조립됩니다. 기존 /choose 서버가 지침 변경을 지원하지 않으면 조합 계산에서 알려줍니다.</p>{modeValue.prompts.map((p, i) => <div key={p.id} className="grid gap-3 border-t pt-4"><Field label={'변형 이름 ' + (i + 1)} value={p.name} onChange={name => updateMode({ prompts: modeValue.prompts.map(x => x.id === p.id ? { ...x, name } : x) })} /><Field label={'버전 ' + (i + 1)} value={p.version} onChange={version => updateMode({ prompts: modeValue.prompts.map(x => x.id === p.id ? { ...x, version } : x) })} /><Field label={'실행 지침 ' + (i + 1)} multiline value={p.instructions} onChange={instructions => updateMode({ prompts: modeValue.prompts.map(x => x.id === p.id ? { ...x, instructions } : x) })} /></div>)}<Button variant="outline" onClick={() => updateMode({ prompts: [...modeValue.prompts, { ...modeValue.prompts[0]!, id: crypto.randomUUID(), name: '새 변형', version: '1' }] })}><Plus aria-hidden="true" />변형 추가</Button></div></div></TabsContent>)}</Tabs>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>사후 분석 지침</CardTitle></CardHeader><CardContent><Field label="작업 분석 지침" multiline value={task.analysisInstructions ?? ''} onChange={analysisInstructions => { const copy = { ...task }; if (analysisInstructions.trim()) copy.analysisInstructions = analysisInstructions; else delete copy.analysisInstructions; setTask(copy); }} hint="미설정 시 전역 지침을 사용합니다. 입력하면 이 작업의 지침으로 대체하며, 근거 인용과 결과 형식 규칙은 유지합니다." /></CardContent></Card>
    <Button className="justify-self-end" disabled={props.busy} onClick={() => void props.act(async () => { const parsed: unknown = JSON.parse(json); const saved = await props.save({ ...props.view.config, tasks: [...props.view.config.tasks.filter(t => t.id !== task.id), task] }, { file: task.file, task: parsed }, revision); setRevision(saved.revision); onSaved(); })}><Save aria-hidden="true" />작업과 프롬프트 저장</Button>
  </div>;
}
