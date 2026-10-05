import { Field, Choice } from './forms';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { useId } from 'react';

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const ruleKinds = [
  { id: 'titleIncludes', name: '페이지 제목 포함' }, { id: 'urlIncludes', name: 'URL 포함' },
  { id: 'textVisible', name: '화면에 텍스트 표시' }, { id: 'textVisibleExact', name: '화면에 정확한 텍스트 표시' },
  { id: 'activatedAnnouncementIncludes', name: '활성화 이후 발화 포함' },
  { id: 'requestSeen', name: '네트워크 요청 관찰' }, { id: 'responseSeen', name: '네트워크 응답 관찰' },
  { id: 'domEventSeen', name: 'DOM 이벤트 관찰' },
];
export function TaskFields({ json, onChange }: { json: string; onChange: (json: string) => void }) {
  const uid = useId();
  let task: Record<string, unknown>;
  try { const value: unknown = JSON.parse(json); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); task = value as Record<string, unknown>; }
  catch { return <p role="status" className="text-sm text-muted-foreground">고급 JSON의 형식을 수정하면 기본 편집기를 사용할 수 있습니다.</p>; }
  const update = (part: Record<string, unknown>) => onChange(JSON.stringify({ ...task, ...part }, null, 2));
  const inputs = Object.entries(object(task.input)), rules = object(task.verify).all;
  const all = Array.isArray(rules) ? rules.map(object) : [];
  const rule = (index: number, next: Record<string, unknown>) => update({ verify: { all: all.map((value, i) => i === index ? next : value) } });
  const navigation = object(task.navigation);
  return <div className="grid gap-5">
    <Field label="시작 URL" value={String(task.url ?? '')} onChange={url => update({ url })} hint="https:// 주소 또는 프로젝트의 로컬 HTML 경로" />
    <Field label="작업 목표" multiline value={String(task.goal ?? '')} onChange={goal => update({ goal })} hint="완료할 일을 설명합니다. 모델 실행 지침은 모드별 프롬프트에서 관리합니다." />
    <div className="grid gap-4 sm:grid-cols-2"><Field label="최대 단계 수" type="number" value={String(task.maxSteps ?? 40)} onChange={value => update({ maxSteps: Number(value) })} /><Field label="작업 제한 시간 (ms)" type="number" value={String(task.timeoutMs ?? 120000)} onChange={value => update({ timeoutMs: Number(value) })} /></div>
    <div className="grid gap-3"><h3 className="text-sm font-medium">입력값</h3><p className="text-xs text-muted-foreground">입력은 이름으로 선택합니다. 값은 로컬 Task 파일에 저장하고 실행 기록에서 가립니다. 키보드 실행의 화면 이미지는 선택한 모델 서버로 전송합니다.</p>{inputs.map(([key, value], i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field label={'입력 이름 ' + (i + 1)} value={key} onChange={name => { const copy = inputs.slice(); copy[i] = [name, value]; update({ input: Object.fromEntries(copy) }); }} /><Field label={'입력 값 ' + (i + 1)} type="password" value={String(value)} onChange={text => update({ input: { ...object(task.input), [key]: text } })} /><Button variant="outline" aria-label={'입력 ' + (i + 1) + ' 삭제'} onClick={() => update({ input: Object.fromEntries(inputs.filter((_, n) => n !== i)) })}>삭제</Button></div>)}<Button variant="outline" className="justify-self-start" onClick={() => { let name = 'input' + (inputs.length + 1); while (Object.hasOwn(object(task.input), name)) name += '_'; update({ input: { ...object(task.input), [name]: '' } }); }}>입력 추가</Button></div>
    <div className="grid gap-3"><h3 className="text-sm font-medium">독립 성공 조건</h3><p className="text-xs text-muted-foreground">Runner가 모든 조건을 확인합니다. 성공 조건은 모델에게 전달하지 않습니다.</p>{all.map((value, i) => { const kind = Object.keys(value)[0] ?? 'titleIncludes', detail = object(value[kind]); return <div key={i} className="grid gap-3 border-t pt-3"><Choice label={'성공 조건 종류 ' + (i + 1)} value={kind} options={ruleKinds} onChange={next => rule(i, { [next]: ['requestSeen', 'responseSeen'].includes(next) ? { urlIncludes: '' } : next === 'domEventSeen' ? { selector: '', event: 'click' } : '' })} />{['requestSeen', 'responseSeen', 'domEventSeen'].includes(kind) ? <div className="grid gap-3 sm:grid-cols-2">{kind === 'domEventSeen' ? <><Field label={'CSS 선택자 ' + (i + 1)} value={String(detail.selector ?? '')} onChange={selector => rule(i, { [kind]: { ...detail, selector } })} /><Field label={'이벤트 이름 ' + (i + 1)} value={String(detail.event ?? '')} onChange={event => rule(i, { [kind]: { ...detail, event } })} /></> : <><Field label={'요청 URL 포함 ' + (i + 1)} value={String(detail.urlIncludes ?? '')} onChange={urlIncludes => rule(i, { [kind]: { ...detail, urlIncludes } })} /><Field label={'HTTP 메서드 (선택) ' + (i + 1)} value={String(detail.method ?? '')} onChange={method => { const next = { ...detail }; if (method) next.method = method; else delete next.method; rule(i, { [kind]: next }); }} />{kind === 'responseSeen' && <Field label={'HTTP 상태 (선택) ' + (i + 1)} type="number" value={String(detail.status ?? '')} onChange={status => { const next = { ...detail }; if (status) next.status = Number(status); else delete next.status; rule(i, { [kind]: next }); }} />}</>}</div> : <Field label={'성공 조건 값 ' + (i + 1)} value={String(value[kind] ?? '')} onChange={text => rule(i, { [kind]: text })} />}<Button variant="outline" className="justify-self-start" disabled={all.length <= 1} aria-label={'성공 조건 ' + (i + 1) + ' 삭제'} onClick={() => update({ verify: { all: all.filter((_, n) => n !== i) } })}>조건 삭제</Button></div>; })}<Button variant="outline" className="justify-self-start" onClick={() => update({ verify: { all: [...all, { titleIncludes: '' }] } })}>성공 조건 추가</Button></div>
    <Choice label="이동 범위" value={String(navigation.strategy ?? 'same-origin')} options={[{ id: 'same-origin', name: '같은 Origin' }, { id: 'start-url-prefix', name: '시작 URL 접두사' }, { id: 'allow-url-list', name: '명시한 URL 목록' }]} onChange={strategy => { const next: Record<string, unknown> = { ...navigation, strategy }; if (strategy === 'allow-url-list') Object.assign(next, { allowUrlList: [] }); else delete next.allowUrlList; update({ navigation: next }); }} />
    {navigation.strategy === 'allow-url-list' && <Field label="허용 URL (한 줄에 하나)" multiline value={Array.isArray(navigation.allowUrlList) ? navigation.allowUrlList.join('\n') : ''} onChange={value => update({ navigation: { ...navigation, allowUrlList: value.split('\n').filter(Boolean) } })} />}
    <div className="flex items-center gap-3"><Switch id={uid} checked={navigation.readOnly === true} onCheckedChange={readOnly => update({ navigation: { ...navigation, readOnly } })} /><Label htmlFor={uid}>읽기 전용 탐색</Label></div>
  </div>;
}
