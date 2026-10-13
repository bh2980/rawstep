import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { PageElement } from '../../shared/api';
import { blankDraft, draftFromRule, draftMissing, ruleFromDraft, type RuleDraft } from '../lib/ruleEditor';
import { ElementPicker } from './ElementPicker';
import { RuleCard } from './RuleCard';
import { RuleDraftFields, type PickElement } from './RuleDraftFields';
import { Button } from './ui/button';

type Props = {
  rules: VerifyRule[]; onChange: (rules: VerifyRule[]) => void;
  /** The start page, for "페이지에서 고르기". */
  url: string;
  /** A task needs at least one completion check, so the last one cannot be removed. */
  keepOne?: boolean;
};

/**
 * The completion checks as a ruled list of sentences, each with change and remove, under which one compact form adds or edits a
 * condition: a kind select, the fields of that kind and [조건 추가]. The form is open while there is no condition and otherwise
 * opens from the add button. The caller supplies the section heading (and the ⓘ that explains 완료 확인).
 */
export function CheckEditor({ rules, onChange, url, keepOne }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RuleDraft>(() => blankDraft('textVisible'));
  const [editing, setEditing] = useState<number>();
  const [formOpen, setFormOpen] = useState(rules.length === 0);
  const [picking, setPicking] = useState<{ roles: readonly string[] | undefined; apply: (element: PageElement) => void }>();
  const missing = draftMissing(draft);
  const pick: PickElement = (roles, apply) => setPicking({ roles, apply });
  const reset = () => { setDraft(blankDraft('textVisible')); setEditing(undefined); setFormOpen(false); };
  const submit = () => {
    const rule = ruleFromDraft(draft);
    if (!rule) return;
    onChange(editing === undefined ? [...rules, rule] : rules.map((current, i) => i === editing ? rule : current));
    reset();
  };
  const remove = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
    if (editing === index) reset(); else if (editing !== undefined && editing > index) setEditing(editing - 1);
  };
  return <div className="grid gap-3">
    {rules.length > 0 && <div className="grid gap-1">
      {rules.length > 1 && <p className="text-[13px] leading-5 text-muted-foreground">{t('ruleEditor.boundaryLead')}</p>}
      <ul aria-label={t('ruleEditor.listLabel')} className="grid border-t border-edge">
        {rules.map((rule, index) => {
          const loaded = draftFromRule(rule);
          return <RuleCard key={index + JSON.stringify(rule)} rule={rule} n={index + 1} editing={editing === index} removeDisabled={keepOne && rules.length <= 1}
            onRemove={() => remove(index)} onEdit={loaded ? () => { setDraft(loaded); setEditing(index); setFormOpen(true); } : undefined} />;
        })}
      </ul>
    </div>}
    {!formOpen && <Button type="button" variant="outline" className="justify-self-start" onClick={() => { setDraft(blankDraft('textVisible')); setEditing(undefined); setFormOpen(true); }}><Plus aria-hidden="true" />{t('ruleEditor.add')}</Button>}
    {formOpen && <form className="grid gap-3" aria-label={editing === undefined ? t('ruleEditor.addTitle') : t('ruleEditor.editTitle', { n: editing + 1 })}
      onSubmit={event => { event.preventDefault(); submit(); }}>
      <RuleDraftFields draft={draft} onChange={setDraft} onPick={pick} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" disabled={!!missing} aria-describedby="check-editor-missing">{editing === undefined ? <><Plus aria-hidden="true" />{t('ruleEditor.add')}</> : t('ruleEditor.applyEdit')}</Button>
        {(editing !== undefined || rules.length > 0) && <Button type="button" variant="ghost" onClick={reset}>{t('ruleEditor.cancelEdit')}</Button>}
        <p id="check-editor-missing" className="text-xs text-muted-foreground">{missing ? t(`ruleEditor.missing.${missing}`) : ''}</p>
      </div>
    </form>}
    <ElementPicker open={picking !== undefined} onOpenChange={open => { if (!open) setPicking(undefined); }} url={url} roles={picking?.roles}
      onPick={element => picking?.apply(element)} />
  </div>;
}
