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
 * The completion checks of a task as cards, plus a builder for one more: plain-language kinds first, advanced kinds under
 * their own group. A card can be loaded back into the builder to change it. Checks suggested by AI are added by the suggestion panel.
 */
export function CheckEditor({ rules, onChange, url, keepOne }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RuleDraft>(() => blankDraft('textVisible'));
  const [editing, setEditing] = useState<number>();
  const [picking, setPicking] = useState<{ roles: readonly string[] | undefined; apply: (element: PageElement) => void }>();
  const missing = draftMissing(draft);
  const pick: PickElement = (roles, apply) => setPicking({ roles, apply });
  const reset = () => { setDraft(blankDraft('textVisible')); setEditing(undefined); };
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
    {rules.length > 0
      ? <ul aria-label={t('ruleEditor.listLabel')} className="grid gap-2">
        {rules.map((rule, index) => {
          const loaded = draftFromRule(rule);
          return <RuleCard key={index + JSON.stringify(rule)} rule={rule} n={index + 1} editing={editing === index} removeDisabled={keepOne && rules.length <= 1}
            onRemove={() => remove(index)} onEdit={loaded ? () => { setDraft(loaded); setEditing(index); } : undefined} />;
        })}
      </ul>
      : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t('ruleEditor.empty')}</p>}
    <form className="grid gap-3 rounded-lg border p-3" aria-label={editing === undefined ? t('ruleEditor.addTitle') : t('ruleEditor.editTitle', { n: editing + 1 })}
      onSubmit={event => { event.preventDefault(); submit(); }}>
      <h4 className="text-sm font-medium">{editing === undefined ? t('ruleEditor.addTitle') : t('ruleEditor.editTitle', { n: editing + 1 })}</h4>
      <RuleDraftFields draft={draft} onChange={setDraft} onPick={pick} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!!missing} aria-describedby="check-editor-missing">{editing === undefined ? <><Plus aria-hidden="true" />{t('ruleEditor.add')}</> : t('ruleEditor.applyEdit')}</Button>
        {editing !== undefined && <Button type="button" variant="outline" onClick={reset}>{t('ruleEditor.cancelEdit')}</Button>}
        <p id="check-editor-missing" className="text-xs text-muted-foreground">{missing ? t(`ruleEditor.missing.${missing}`) : ''}</p>
      </div>
    </form>
    <ElementPicker open={picking !== undefined} onOpenChange={open => { if (!open) setPicking(undefined); }} url={url} roles={picking?.roles}
      onPick={element => picking?.apply(element)} />
  </div>;
}
