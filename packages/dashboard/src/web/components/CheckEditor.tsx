import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { PageElement } from '../../shared/api';
import { blankDraft, draftFromRule, draftMissing, ruleFromDraft, type RuleDraft } from '../lib/ruleEditor';
import { ConceptNote } from './layout/ConceptNote';
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
 * The completion check as a goal boundary (spec §19). First the boundary as it stands, in words: "아래 조건이 모두 맞으면 목표에 닿은
 * 것으로 봅니다" and each condition ticked. Then the editor, which asks "무엇을 확인할까요?" with plain-language choices as large rows,
 * advanced kinds folded away. A condition can be loaded back into the editor to change it. AI suggestions are added by their own panel.
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
  return <div className="grid gap-6">
    <section aria-labelledby="boundary-title" className="grid gap-2">
      <ConceptNote concept="check" />
      <div className="grid gap-0.5 border-b border-edge-strong pb-2">
        <h3 id="boundary-title" className="text-base font-semibold">{t('ruleEditor.boundaryTitle')}</h3>
        <p className="text-sm text-muted-foreground">{rules.length > 0 ? t('ruleEditor.boundaryLead') : t('ruleEditor.boundaryEmpty')}</p>
      </div>
      {rules.length > 0 && <ul aria-label={t('ruleEditor.listLabel')} className="grid">
        {rules.map((rule, index) => {
          const loaded = draftFromRule(rule);
          return <RuleCard key={index + JSON.stringify(rule)} rule={rule} n={index + 1} editing={editing === index} removeDisabled={keepOne && rules.length <= 1}
            onRemove={() => remove(index)} onEdit={loaded ? () => { setDraft(loaded); setEditing(index); } : undefined} />;
        })}
      </ul>}
    </section>
    <form className="grid gap-4" aria-label={editing === undefined ? t('ruleEditor.addTitle') : t('ruleEditor.editTitle', { n: editing + 1 })}
      onSubmit={event => { event.preventDefault(); submit(); }}>
      <RuleDraftFields draft={draft} onChange={setDraft} onPick={pick} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={!!missing} aria-describedby="check-editor-missing">{editing === undefined ? <><Plus aria-hidden="true" />{t('ruleEditor.add')}</> : t('ruleEditor.applyEdit')}</Button>
        {editing !== undefined && <Button type="button" size="lg" variant="outline" onClick={reset}>{t('ruleEditor.cancelEdit')}</Button>}
        <p id="check-editor-missing" className="text-xs text-muted-foreground">{missing ? t(`ruleEditor.missing.${missing}`) : ''}</p>
      </div>
    </form>
    <ElementPicker open={picking !== undefined} onOpenChange={open => { if (!open) setPicking(undefined); }} url={url} roles={picking?.roles}
      onPick={element => picking?.apply(element)} />
  </div>;
}
