import { useId, useState, type ReactNode } from 'react';
import { MousePointerClick, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PageElement } from '../../shared/api';
import { roleLabel } from '../i18n/labels';
import { shell } from '../i18n/locales/ko/shell';
import { ADVANCED_KINDS, BASIC_KINDS, STATE_ATTRIBUTES, blankDraft, type RuleDraft, type RuleDraftKind } from '../lib/ruleEditor';
import { Choice, Field, Toggle } from './forms';
import { Disclosure } from './layout/Disclosure';
import { RadioRows } from './layout/RadioRows';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent } from './ui/collapsible';
import { Label } from './ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './ui/select';

/** Asks the editor to open the element list and hand the picked element back. */
export type PickElement = (roles: readonly string[] | undefined, apply: (element: PageElement) => void) => void;

type Props = {
  draft: RuleDraft; onChange: (draft: RuleDraft) => void;
  /** Nesting level inside a combination; a combination cannot hold another one. */
  depth?: number;
  onPick: PickElement;
  /** Text added to labels so several rows of a combination stay distinguishable, e.g. "2". */
  suffix?: string;
};

const ANY = '__any__';
const LIVE_ROLES = ['status', 'alert', 'log'] as const;
const roles = Object.keys(shell.roles);

/** The kind select inside a combination: plain-language kinds first, then an "advanced" group. */
function KindSelect({ draft, onChange, suffix }: Pick<Props, 'draft' | 'onChange' | 'suffix'>) {
  const { t } = useTranslation();
  const id = useId();
  // A combination cannot hold another combination, so `any` and `not` are only offered at the top level (as radio rows).
  const advanced = ADVANCED_KINDS.filter(kind => kind !== 'any' && kind !== 'not');
  const label = (kind: RuleDraftKind) => t(`ruleEditor.kinds.${kind}`);
  return <div className="grid gap-2">
    <Label htmlFor={id}>{t('ruleEditor.kind')}{suffix ? ` ${suffix}` : ''}</Label>
    <Select value={draft.kind} onValueChange={kind => onChange(blankDraft(kind as RuleDraftKind))}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>{BASIC_KINDS.map(kind => <SelectItem key={kind} value={kind}>{label(kind)}</SelectItem>)}</SelectGroup>
        <SelectGroup><SelectLabel>{t('ruleEditor.advanced')}</SelectLabel>{advanced.map(kind => <SelectItem key={kind} value={kind}>{label(kind)}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  </div>;
}

/**
 * The top-level kind as large radio rows ("무엇을 확인할까요?"): plain-language kinds first, the advanced ones in a folded group.
 * The fields of the chosen kind open under its own row.
 */
function KindRadios({ draft, onChange, body }: Pick<Props, 'draft' | 'onChange'> & { body: ReactNode }) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(() => (ADVANCED_KINDS as readonly string[]).includes(draft.kind));
  const rows = (kinds: readonly RuleDraftKind[]) => kinds.map(kind => ({ id: kind, label: t(`ruleEditor.kinds.${kind}`), hint: t(`ruleEditor.kindHints.${kind}`) }));
  const choose = (kind: RuleDraftKind) => onChange(blankDraft(kind));
  const expanded = (kind: RuleDraftKind) => kind === draft.kind ? <div className="grid gap-3">{body}</div> : null;
  return <div className="grid gap-3">
    <RadioRows legend={t('ruleEditor.kind')} value={draft.kind} onChange={choose} rows={rows(BASIC_KINDS)} expanded={expanded} />
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="grid gap-1">
      <Disclosure label={t('ruleEditor.advanced')} />
      <CollapsibleContent className="grid gap-1.5">
        <p className="text-xs leading-5 text-muted-foreground">{t('ruleEditor.advancedNote')}</p>
        <RadioRows legend={t('ruleEditor.advanced')} value={draft.kind} onChange={choose} rows={rows(ADVANCED_KINDS)} expanded={expanded} />
      </CollapsibleContent>
    </Collapsible>
  </div>;
}

function RoleChoice({ value, onChange, suffix }: { value: string; onChange: (role: string) => void; suffix?: string | undefined }) {
  const { t } = useTranslation();
  const options = [{ id: ANY, name: t('ruleEditor.anyRole') }, ...(value && !roles.includes(value) ? [value] : []).concat(roles).map(role => ({ id: role, name: `${roleLabel(role)} (${role})` }))];
  return <Choice label={t('ruleEditor.role') + (suffix ? ` ${suffix}` : '')} value={value || ANY} onChange={next => onChange(next === ANY ? '' : next)} options={options} />;
}

function PickButton({ onClick, suffix }: { onClick: () => void; suffix?: string | undefined }) {
  const { t } = useTranslation();
  return <Button type="button" variant="outline" size="sm" className="justify-self-start" aria-label={t('ruleEditor.pickAria') + (suffix ? ` ${suffix}` : '')} onClick={onClick}><MousePointerClick aria-hidden="true" />{t('ruleEditor.pick')}</Button>;
}

/** The inputs of one draft, by kind. Nested drafts of a combination are edited by the same component. */
export function RuleDraftFields({ draft, onChange, depth = 0, onPick, suffix }: Props) {
  const { t } = useTranslation();
  const label = (text: string) => text + (suffix ? ` ${suffix}` : '');
  const picker = (roleList: readonly string[] | undefined, apply: (element: PageElement) => void) => <PickButton suffix={suffix} onClick={() => onPick(roleList, apply)} />;
  const after = (current: Extract<RuleDraft, { afterActivation: boolean }>) =>
    <Toggle label={t('ruleEditor.afterActivation')} hint={t('ruleEditor.afterActivationHint')} checked={current.afterActivation} onChange={afterActivation => onChange({ ...current, afterActivation })} />;
  let body;
  switch (draft.kind) {
    case 'textVisible': case 'urlIncludes': case 'titleIncludes':
      body = <Field label={label(t(`ruleEditor.textLabels.${draft.kind}`))} hint={t(`ruleEditor.textHints.${draft.kind}`)} value={draft.text} onChange={text => onChange({ ...draft, text })} />;
      break;
    case 'liveRegion':
      body = <>
        <Field label={label(t('ruleEditor.textLabels.liveRegion'))} hint={t('ruleEditor.textHints.liveRegion')} value={draft.text} onChange={text => onChange({ ...draft, text })} />
        {picker(LIVE_ROLES, element => onChange({ ...draft, text: element.name ?? '' }))}
        {after(draft)}
      </>;
      break;
    case 'appeared': case 'disappeared':
      body = <>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleChoice value={draft.role} onChange={role => onChange({ ...draft, role })} suffix={suffix} />
          <Field label={label(t('ruleEditor.name'))} value={draft.name} onChange={name => onChange({ ...draft, name })} hint={t('ruleEditor.nameHint')} />
        </div>
        {picker(undefined, element => onChange({ ...draft, role: element.role, name: element.name ?? '' }))}
        {after(draft)}
      </>;
      break;
    case 'focused':
      body = <>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleChoice value={draft.role} onChange={role => onChange({ ...draft, role })} suffix={suffix} />
          <Field label={label(t('ruleEditor.name'))} value={draft.name} onChange={name => onChange({ ...draft, name })} hint={t('ruleEditor.nameHint')} />
        </div>
        {picker(undefined, element => onChange({ ...draft, role: element.role, name: element.name ?? '' }))}
      </>;
      break;
    case 'state':
      body = <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice label={label(t('ruleEditor.attr'))} value={draft.attr} onChange={attr => onChange({ ...draft, attr })} options={[...new Set([draft.attr, ...STATE_ATTRIBUTES])].filter(Boolean).map(attr => ({ id: attr, name: attr }))} />
          <Field label={label(t('ruleEditor.stateValue'))} value={draft.value} onChange={value => onChange({ ...draft, value })} hint={t('ruleEditor.stateValueHint')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <RoleChoice value={draft.role} onChange={role => onChange({ ...draft, role })} suffix={suffix} />
          <Field label={label(t('ruleEditor.name'))} value={draft.name} onChange={name => onChange({ ...draft, name })} hint={t('ruleEditor.stateElementHint')} />
        </div>
        {picker(undefined, element => onChange({ ...draft, role: element.role, name: element.name ?? '' }))}
        {after(draft)}
      </>;
      break;
    case 'submit':
      body = <>
        <p className="text-xs leading-5 text-muted-foreground">{t('ruleEditor.submitHint')}</p>
        {after(draft)}
      </>;
      break;
    case 'request': case 'response':
      body = <div className="grid gap-3 sm:grid-cols-3">
        <Field label={label(t('ruleEditor.requestUrl'))} value={draft.url} onChange={url => onChange({ ...draft, url })} />
        <Field label={label(t('ruleEditor.method'))} value={draft.method} placeholder="GET" onChange={method => onChange({ ...draft, method })} />
        {draft.kind === 'response' && <Field label={label(t('ruleEditor.status'))} type="number" value={draft.status} onChange={status => onChange({ ...draft, status })} />}
      </div>;
      break;
    case 'domEvent':
      body = <div className="grid gap-3 sm:grid-cols-2">
        <Field label={label(t('ruleEditor.selector'))} value={draft.selector} onChange={selector => onChange({ ...draft, selector })} />
        <Field label={label(t('ruleEditor.eventName'))} value={draft.event} onChange={event => onChange({ ...draft, event })} />
      </div>;
      break;
    case 'script':
      body = <>
        <p className="text-xs leading-5 text-muted-foreground">{t('ruleEditor.scriptNotice')}</p>
        <Field label={label(t('ruleEditor.scriptSource'))} multiline value={draft.source} onChange={source => onChange({ ...draft, source })} placeholder="(context) => document.querySelector('#done') !== null" />
        <Field label={label(t('ruleEditor.scriptDescription'))} value={draft.description} onChange={description => onChange({ ...draft, description })} hint={t('ruleEditor.scriptDescriptionHint')} />
      </>;
      break;
    case 'any':
      body = <div className="grid gap-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('ruleEditor.anyHint')}</p>
        {draft.items.map((item, index) => <div key={index} className="grid gap-3 border-l-2 border-edge-strong pl-3">
          <RuleDraftFields draft={item} depth={depth + 1} onPick={onPick} suffix={String(index + 1)} onChange={next => onChange({ ...draft, items: draft.items.map((current, i) => i === index ? next : current) })} />
          <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={draft.items.length <= 1} aria-label={t('ruleEditor.removeItemAria', { n: index + 1 })}
            onClick={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })}><X aria-hidden="true" />{t('ruleEditor.removeItem')}</Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={draft.items.length >= 20} onClick={() => onChange({ ...draft, items: [...draft.items, blankDraft('textVisible')] })}><Plus aria-hidden="true" />{t('ruleEditor.addItem')}</Button>
      </div>;
      break;
    case 'not':
      body = <div className="grid gap-3 border-l-2 border-edge-strong pl-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('ruleEditor.notHint')}</p>
        <RuleDraftFields draft={draft.item} depth={depth + 1} onPick={onPick} suffix={suffix ? `${suffix}-1` : '1'} onChange={item => onChange({ ...draft, item })} />
      </div>;
      break;
  }
  if (depth === 0) return <KindRadios draft={draft} onChange={onChange} body={body} />;
  return <div className="grid gap-3">
    <KindSelect draft={draft} onChange={onChange} suffix={suffix} />
    {body}
  </div>;
}
