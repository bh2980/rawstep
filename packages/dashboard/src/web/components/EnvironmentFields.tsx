import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { Field, Choice } from './forms';
import { Button } from './ui/button';
import type { DashboardConfig } from '../../shared/config';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function EnvironmentFields({ json, onChange, profiles }: { json: string; onChange: (value: string) => void; profiles: Record<string, unknown> }) {
  let environments: DashboardConfig['environments'];
  try { const value: unknown = JSON.parse(json); if (!Array.isArray(value) || value.some(v => !v || typeof v !== 'object' || typeof v.id !== 'string' || typeof v.name !== 'string')) throw new Error(); environments = value; }
  catch { return <p role="status" className="text-sm text-muted-foreground">고급 환경 JSON 형식을 수정하면 편집기를 사용할 수 있습니다.</p>; }
  const save = (next: typeof environments) => onChange(JSON.stringify(next, null, 2));
  const update = (index: number, part: Partial<typeof environments[number]>) => save(environments.map((e, i) => i === index ? { ...e, ...part } : e));
  return <div className="grid gap-6">{environments.map((environment, index) => {
    const preset = typeof environment.profile === 'string' ? environment.profile : 'custom';
    const profile = typeof environment.profile === 'string' ? object(profiles[environment.profile]) : object(environment.profile);
    const changeProfile = (part: Record<string, unknown>) => update(index, { profile: { ...profile, id: environment.id, ...part } });
    const viewport = { ...RAWSTEP_DEFAULTS.viewport, ...object(profile.viewport) };
    return <div key={index} className="grid gap-4 border-t pt-4"><div className="grid gap-4 sm:grid-cols-2"><Field label={'환경 ID ' + (index + 1)} value={environment.id} onChange={id => update(index, { id })} /><Field label={'환경 이름 ' + (index + 1)} value={environment.name} onChange={name => update(index, { name })} /></div><Choice label={'기본 프로필 ' + (index + 1)} value={preset} options={[...Object.keys(profiles).map(id => ({ id, name: id })), { id: 'custom', name: '사용자 지정' }]} onChange={value => update(index, { profile: value === 'custom' ? { ...profile, id: environment.id } : value })} />
      <div className="grid gap-4 sm:grid-cols-3"><Field label={'화면 너비 ' + (index + 1)} type="number" value={String(viewport.width)} onChange={width => changeProfile({ viewport: { ...viewport, width: Number(width) } })} /><Field label={'화면 높이 ' + (index + 1)} type="number" value={String(viewport.height)} onChange={height => changeProfile({ viewport: { ...viewport, height: Number(height) } })} /><Field label={'텍스트 배율 ' + (index + 1)} type="number" value={String(profile.textScale ?? 1)} onChange={textScale => changeProfile({ textScale: Number(textScale) })} /></div>
      <div className="grid gap-4 sm:grid-cols-2"><Choice label={'색상 테마 ' + (index + 1)} value={String(profile.colorScheme ?? 'light')} options={[{ id: 'light', name: '밝게' }, { id: 'dark', name: '어둡게' }, { id: 'no-preference', name: '기본' }]} onChange={colorScheme => changeProfile({ colorScheme })} /><Choice label={'강제 색상 ' + (index + 1)} value={String(profile.forcedColors ?? 'none')} options={[{ id: 'none', name: '사용 안 함' }, { id: 'active', name: '사용' }]} onChange={forcedColors => changeProfile({ forcedColors })} /><Choice label={'대비 ' + (index + 1)} value={String(profile.contrast ?? 'no-preference')} options={[{ id: 'no-preference', name: '기본' }, { id: 'more', name: '높은 대비' }]} onChange={contrast => changeProfile({ contrast })} /><Choice label={'동작 줄이기 ' + (index + 1)} value={String(profile.reducedMotion ?? 'no-preference')} options={[{ id: 'no-preference', name: '기본' }, { id: 'reduce', name: '줄이기' }]} onChange={reducedMotion => changeProfile({ reducedMotion })} /></div>
      <Button variant="outline" className="justify-self-start" disabled={environments.length <= 1} aria-label={'환경 ' + (index + 1) + ' 삭제'} onClick={() => save(environments.filter((_, i) => i !== index))}>환경 삭제</Button>
    </div>;
  })}<Button variant="outline" className="justify-self-start" onClick={() => save([...environments, { id: crypto.randomUUID(), name: '새 환경', profile: 'default' }])}>환경 추가</Button><p className="text-xs text-muted-foreground">브라우저 확대와 OS 대비 등 적용할 수 없는 환경은 실행 전 조합 검사에서 이유를 표시합니다.</p></div>;
}
