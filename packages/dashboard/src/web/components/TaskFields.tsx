import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { Field, Choice } from './forms';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function TaskFields({ json, onChange }: { json: string; onChange: (json: string) => void }) {
  const { t } = useTranslation();
  const uid = useId();
  const ruleKinds = [
    { id: 'titleIncludes', name: t('taskFields.ruleKinds.titleIncludes') }, { id: 'urlIncludes', name: t('taskFields.ruleKinds.urlIncludes') },
    { id: 'textVisible', name: t('taskFields.ruleKinds.textVisible') }, { id: 'textVisibleExact', name: t('taskFields.ruleKinds.textVisibleExact') },
    { id: 'activatedAnnouncementIncludes', name: t('taskFields.ruleKinds.activatedAnnouncementIncludes') },
    { id: 'requestSeen', name: t('taskFields.ruleKinds.requestSeen') }, { id: 'responseSeen', name: t('taskFields.ruleKinds.responseSeen') },
    { id: 'domEventSeen', name: t('taskFields.ruleKinds.domEventSeen') },
  ];
  let task: Record<string, unknown>;
  try { const value: unknown = JSON.parse(json); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); task = value as Record<string, unknown>; }
  catch { return <p role="status" className="text-sm text-muted-foreground">{t('taskFields.invalidJson')}</p>; }
  const update = (part: Record<string, unknown>) => onChange(JSON.stringify({ ...task, ...part }, null, 2));
  const inputs = Object.entries(object(task.input)), rules = object(task.verify).all;
  const all = Array.isArray(rules) ? rules.map(object) : [];
  const rule = (index: number, next: Record<string, unknown>) => update({ verify: { all: all.map((value, i) => i === index ? next : value) } });
  const navigation = object(task.navigation);
  return <div className="grid gap-5">
    <Field label={t('taskFields.startUrl')} value={String(task.url ?? '')} onChange={url => update({ url })} hint={t('taskFields.startUrlHint')} />
    <Field label={t('taskFields.goal')} multiline value={String(task.goal ?? '')} onChange={goal => update({ goal })} hint={t('taskFields.goalHint')} />
    <div className="grid gap-4 sm:grid-cols-2"><Field label={t('taskFields.maxSteps')} type="number" value={String(task.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps)} onChange={value => update({ maxSteps: Number(value) })} /><Field label={t('taskFields.timeoutMs')} type="number" value={String(task.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs)} onChange={value => update({ timeoutMs: Number(value) })} /></div>
    <div className="grid gap-3"><h3 className="text-sm font-medium">{t('taskFields.inputsTitle')}</h3><p className="text-xs text-muted-foreground">{t('taskFields.inputsHint')}</p>{inputs.map(([key, value], i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"><Field label={t('taskFields.inputName', { n: i + 1 })} value={key} onChange={name => { const copy = inputs.slice(); copy[i] = [name, value]; update({ input: Object.fromEntries(copy) }); }} /><Field label={t('taskFields.inputValue', { n: i + 1 })} type="password" value={String(value)} onChange={text => update({ input: { ...object(task.input), [key]: text } })} /><Button variant="outline" aria-label={t('taskFields.deleteInputAria', { n: i + 1 })} onClick={() => update({ input: Object.fromEntries(inputs.filter((_, n) => n !== i)) })}>{t('taskFields.delete')}</Button></div>)}<Button variant="outline" className="justify-self-start" onClick={() => { let name = 'input' + (inputs.length + 1); while (Object.hasOwn(object(task.input), name)) name += '_'; update({ input: { ...object(task.input), [name]: '' } }); }}>{t('taskFields.addInput')}</Button></div>
    <div className="grid gap-3"><h3 className="text-sm font-medium">{t('taskFields.verifyTitle')}</h3><p className="text-xs text-muted-foreground">{t('taskFields.verifyHint')}</p>{all.map((value, i) => { const kind = Object.keys(value)[0] ?? 'titleIncludes', detail = object(value[kind]); return <div key={i} className="grid gap-3 border-t pt-3"><Choice label={t('taskFields.ruleKindLabel', { n: i + 1 })} value={kind} options={ruleKinds} onChange={next => rule(i, { [next]: ['requestSeen', 'responseSeen'].includes(next) ? { urlIncludes: '' } : next === 'domEventSeen' ? { selector: '', event: 'click' } : '' })} />{['requestSeen', 'responseSeen', 'domEventSeen'].includes(kind) ? <div className="grid gap-3 sm:grid-cols-2">{kind === 'domEventSeen' ? <><Field label={t('taskFields.cssSelector', { n: i + 1 })} value={String(detail.selector ?? '')} onChange={selector => rule(i, { [kind]: { ...detail, selector } })} /><Field label={t('taskFields.eventName', { n: i + 1 })} value={String(detail.event ?? '')} onChange={event => rule(i, { [kind]: { ...detail, event } })} /></> : <><Field label={t('taskFields.requestUrl', { n: i + 1 })} value={String(detail.urlIncludes ?? '')} onChange={urlIncludes => rule(i, { [kind]: { ...detail, urlIncludes } })} /><Field label={t('taskFields.httpMethod', { n: i + 1 })} value={String(detail.method ?? '')} onChange={method => { const next = { ...detail }; if (method) next.method = method; else delete next.method; rule(i, { [kind]: next }); }} />{kind === 'responseSeen' && <Field label={t('taskFields.httpStatus', { n: i + 1 })} type="number" value={String(detail.status ?? '')} onChange={status => { const next = { ...detail }; if (status) next.status = Number(status); else delete next.status; rule(i, { [kind]: next }); }} />}</>}</div> : <Field label={t('taskFields.ruleValue', { n: i + 1 })} value={String(value[kind] ?? '')} onChange={text => rule(i, { [kind]: text })} />}<Button variant="outline" className="justify-self-start" disabled={all.length <= 1} aria-label={t('taskFields.deleteRuleAria', { n: i + 1 })} onClick={() => update({ verify: { all: all.filter((_, n) => n !== i) } })}>{t('taskFields.deleteRule')}</Button></div>; })}<Button variant="outline" className="justify-self-start" onClick={() => update({ verify: { all: [...all, { titleIncludes: '' }] } })}>{t('taskFields.addRule')}</Button></div>
    <Choice label={t('taskFields.navScope')} value={String(navigation.strategy ?? 'same-origin')} options={[{ id: 'same-origin', name: t('taskFields.navSameOrigin') }, { id: 'start-url-prefix', name: t('taskFields.navStartUrlPrefix') }, { id: 'allow-url-list', name: t('taskFields.navAllowUrlList') }]} onChange={strategy => { const next: Record<string, unknown> = { ...navigation, strategy }; if (strategy === 'allow-url-list') Object.assign(next, { allowUrlList: [] }); else delete next.allowUrlList; update({ navigation: next }); }} />
    {navigation.strategy === 'allow-url-list' && <Field label={t('taskFields.allowUrls')} multiline value={Array.isArray(navigation.allowUrlList) ? navigation.allowUrlList.join('\n') : ''} onChange={value => update({ navigation: { ...navigation, allowUrlList: value.split('\n').filter(Boolean) } })} />}
    <div className="flex items-center gap-3"><Switch id={uid} checked={navigation.readOnly === true} onCheckedChange={readOnly => update({ navigation: { ...navigation, readOnly } })} /><Label htmlFor={uid}>{t('taskFields.readOnly')}</Label></div>
  </div>;
}
