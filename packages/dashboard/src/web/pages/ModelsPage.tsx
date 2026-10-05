import { useState } from 'react';
import { Plus, Save, Search } from 'lucide-react';
import type { Connection, Model } from '../../shared/config';
import { api } from '../api';
import { Field, Choice, MultiChoice, SectionHeader } from '../components/forms';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import type { PageProps } from './types';

export function ModelsPage(props: PageProps) {
  const [connection, setConnection] = useState<Connection>(() => structuredClone(props.view.config.connections[0] ?? { id: crypto.randomUUID(), name: '새 연결', provider: 'openai', baseURL: 'http://127.0.0.1:1234/v1', timeoutMs: 60000 }));
  const [apiKey, setApiKey] = useState('');
  const [revision, setRevision] = useState(props.view.revision);
  const [discovered, setDiscovered] = useState<Model[]>([]);
  const [model, setModel] = useState<Model>();
  const update = (p: Partial<Connection>) => setConnection({ ...connection, ...p });
  async function saveConnection() {
    const saved = await props.save({ ...props.view.config, connections: [...props.view.config.connections.filter(c => c.id !== connection.id), connection] }, undefined, revision); setRevision(saved.revision);
    if (apiKey) { await api('/credentials', { method: 'POST', body: { connectionId: connection.id, value: apiKey } }); setApiKey(''); }
  }
  const newConnection = () => { setRevision(props.view.revision); setConnection({ id: crypto.randomUUID(), name: '새 연결', provider: 'openai', baseURL: 'http://127.0.0.1:1234/v1', timeoutMs: 60000 }); setApiKey(''); setDiscovered([]); };
  const manual = () => setModel({ id: crypto.randomUUID(), connectionId: connection.id, modelId: '', name: '새 모델', family: connection.provider === 'openai' ? 'LLM' : 'SystemOne', inputs: ['text'], capabilitySource: 'manual', maxChoices: 255, maxImages: 0, roles: ['decision'], promptEditable: connection.provider !== 'screenshot' });
  return <>
    <SectionHeader title="연결과 모델" description="주소로 모델을 조회하고, 입력 지원과 실행·분석 역할을 확인합니다."><Button onClick={newConnection}><Plus aria-hidden="true" />연결 추가</Button></SectionHeader>
    <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="grid content-start gap-4"><Card><CardContent className="grid gap-2 pt-4">{props.view.config.connections.map(c => <Button key={c.id} variant={c.id === connection.id ? 'secondary' : 'ghost'} className="justify-start truncate" onClick={() => { setRevision(props.view.revision); setConnection(structuredClone(c)); setDiscovered([]); setApiKey(''); }}>{c.name}</Button>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>등록한 모델</CardTitle></CardHeader><CardContent className="grid gap-2">{props.view.config.models.map(m => <Button key={m.id} variant="ghost" className="h-auto justify-start whitespace-normal text-left" onClick={() => { setRevision(props.view.revision); setModel(structuredClone(m)); }}>{m.name}<Badge variant="outline">{m.family}</Badge></Button>)}{!props.view.config.models.length && <p className="text-sm text-muted-foreground">아직 등록한 모델이 없습니다.</p>}</CardContent></Card></aside>
      <div className="grid content-start gap-6">
        <Card><CardHeader><CardTitle>모델 서버 연결</CardTitle></CardHeader><CardContent className="grid gap-4"><div className="grid gap-4 md:grid-cols-2"><Field label="연결 이름" value={connection.name} onChange={name => update({ name })} /><Choice label="Provider" value={connection.provider} onChange={provider => update({ provider: provider as Connection['provider'] })} options={[{ id: 'openai', name: 'OpenAI 호환 LLM' }, { id: 'systemone', name: 'SystemOne HTTP' }, { id: 'openrouter', name: 'OpenRouter' }, { id: 'vercel', name: 'Vercel Evaluation' }, { id: 'screenshot', name: '로컬 /choose' }]} /></div><Field label="기본 주소" value={connection.baseURL} onChange={baseURL => update({ baseURL })} hint="/v1 같은 API 기본 경로까지 입력합니다. /choose 서버는 서버의 기본 주소를 입력하세요." />
          <div className="grid gap-4 md:grid-cols-2"><Field label="인증키 환경변수 이름" value={connection.apiKeyEnv ?? ''} onChange={apiKeyEnv => { const copy = { ...connection }; if (apiKeyEnv) copy.apiKeyEnv = apiKeyEnv; else delete copy.apiKeyEnv; setConnection(copy); }} hint="예: RAWSTEP_LOCAL_API_KEY" /><Field label="인증키" type="password" value={apiKey} onChange={setApiKey} hint={props.view.credentialStatus[connection.id] ? '키가 설정되어 있습니다. 변경할 때만 새 키를 입력하세요.' : '입력한 키는 .env.local에 보관하며 다시 반환하지 않습니다.'} /></div>
          <Field label="요청 제한 시간 (ms)" type="number" value={String(connection.timeoutMs)} onChange={s => update({ timeoutMs: Number(s) })} />
          <div className="flex flex-wrap gap-2"><Button disabled={props.busy || (!!apiKey && !connection.apiKeyEnv)} onClick={() => void props.act(saveConnection)}><Save aria-hidden="true" />연결 저장</Button><Button variant="outline" disabled={props.busy} onClick={() => void props.act(async () => { await saveConnection(); setDiscovered(await api<Model[]>('/discover', { method: 'POST', body: { connection } })); })}><Search aria-hidden="true" />연결 확인·모델 조회</Button><Button variant="outline" disabled={!props.view.config.connections.some(c => c.id === connection.id)} onClick={manual}>모델 수동 등록</Button></div>
        </CardContent></Card>
        {discovered.length > 0 && <Card><CardHeader><CardTitle>조회한 모델 {discovered.length}개</CardTitle></CardHeader><CardContent className="grid max-h-96 gap-3 overflow-auto">{discovered.map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"><div className="min-w-0"><p className="break-all text-sm">{m.name}</p><p className="mt-1 text-xs text-muted-foreground">{m.family} · {m.inputs.join(' + ')} · {m.capabilitySource === 'discovery' ? '입력 지원 조회됨' : '입력 지원 확인 필요'}</p></div><Button variant="outline" size="sm" onClick={() => setModel({ ...m, id: crypto.randomUUID() })}>설정 후 등록</Button></div>)}</CardContent></Card>}
        {model && <Card><CardHeader><CardTitle>모델 설정</CardTitle></CardHeader><CardContent className="grid gap-4"><Field label="모델 표시 이름" value={model.name} onChange={name => setModel({ ...model, name })} /><Field label="모델 ID" value={model.modelId} onChange={modelId => setModel({ ...model, modelId })} /><Choice label="사용할 연결" value={model.connectionId} onChange={connectionId => setModel({ ...model, connectionId })} options={props.view.config.connections.map(c => ({ id: c.id, name: c.name }))} /><Choice label="모델 종류" value={model.family} onChange={family => setModel({ ...model, family: family as Model['family'], roles: family === 'SystemOne' ? ['decision'] : model.roles })} options={[{ id: 'SystemOne', name: 'SystemOne — 후보 평가' }, { id: 'LLM', name: 'LLM — JSON 후보 선택·분석' }]} />
          <div className="grid gap-4 md:grid-cols-2"><MultiChoice label="입력 지원" selected={model.inputs} onChange={inputs => setModel({ ...model, inputs: inputs as Model['inputs'], maxImages: inputs.includes('image') ? Math.max(2, model.maxImages) : 0, capabilitySource: 'manual' })} items={[{ id: 'text', name: '텍스트' }, { id: 'image', name: '이미지 (서버 지원 확인 후 선택)' }]} /><MultiChoice label="역할" selected={model.roles} onChange={roles => setModel({ ...model, roles: roles as Model['roles'] })} items={model.family === 'LLM' ? [{ id: 'decision', name: '작업 실행' }, { id: 'analysis', name: '사후 분석 (LLM)' }] : [{ id: 'decision', name: '작업 실행' }]} /></div>
          <div className="grid gap-4 md:grid-cols-2"><Field label="최대 후보 수" type="number" value={String(model.maxChoices)} onChange={s => setModel({ ...model, maxChoices: Number(s) })} /><Field label="최대 이미지 수" type="number" value={String(model.maxImages)} onChange={s => setModel({ ...model, maxImages: Number(s) })} /></div>
          <p className="text-xs leading-5 text-muted-foreground">{model.capabilitySource === 'discovery' ? '서버의 모델 메타데이터를 사용합니다.' : '모델 목록만으로 입력 지원을 확정하지 않습니다. 수동 설정은 사용자가 서버 지원을 확인한 선언으로 기록합니다.'} {!model.promptEditable && '/choose 서버 소유 프롬프트: 기본 지침만 사용하며 변형 실행은 제한됩니다.'}</p>
          <Button disabled={props.busy} onClick={() => void props.act(async () => { const saved = await props.save({ ...props.view.config, models: [...props.view.config.models.filter(m => m.id !== model.id), model] }, undefined, revision); setRevision(saved.revision); setModel(undefined); })}>모델 저장</Button>
        </CardContent></Card>}
      </div>
    </div>
  </>;
}
