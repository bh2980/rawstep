import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeRule } from '../lib/describeRule';
import { cn } from '../lib/utils';
import { Disclosure } from './layout/Disclosure';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent } from './ui/collapsible';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The source of a script rule as read-only text. It is never executed here. */
export function ScriptSource({ source }: { source: string }) {
  const { t } = useTranslation();
  return <pre role="region" aria-label={t('checkSuggest.scriptCode')} tabIndex={0} className="max-h-72 overflow-auto rounded-md border border-edge-strong bg-raised p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all"><code>{source}</code></pre>;
}

/** The script source and description of a rule, when it is a script rule. */
export function scriptOf(rule: unknown): { source: string; description: string } | undefined {
  if (!isRecord(rule) || !isRecord(rule.script) || typeof rule.script.source !== 'string') return undefined;
  return { source: rule.script.source, description: typeof rule.script.description === 'string' ? rule.script.description : '' };
}

type Props = {
  rule: unknown;
  /** 1-based position, used in accessible names. */
  n: number;
  onRemove: () => void; removeDisabled?: boolean;
  /** Present when the editor can load this rule back for changes. */
  onEdit?: (() => void) | undefined;
  /** True while this rule is the one being edited. */
  editing?: boolean;
};

/**
 * One condition of the goal boundary, as a ruled line: a ✓ and the sentence, with change and remove on the right. A script rule is
 * marked ADVANCED CHECK and its code can be read, read-only, from the line.
 */
export function RuleCard({ rule, n, onRemove, removeDisabled, onEdit, editing }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const script = scriptOf(rule);
  return <li className={cn('grid gap-1 border-b border-edge py-2.5 pl-1', editing && 'border-l-[3px] border-l-trace bg-trace-soft pl-3')}>
    <div className="flex items-start justify-between gap-3">
      <p className="flex min-w-0 items-start gap-2.5 text-[15px] leading-6">
        <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span className="min-w-0">{script && <span lang="en" className="mr-2 text-[11px] font-semibold tracking-[0.08em] text-inspect uppercase">{t('labels.advancedCheck')}</span>}{describeRule(rule)}</span>
      </p>
      <div className="flex shrink-0 gap-1">
        {onEdit && <Button type="button" variant="ghost" size="sm" aria-label={t('ruleEditor.editAria', { n })} onClick={onEdit}><Pencil aria-hidden="true" />{t('ruleEditor.edit')}</Button>}
        <Button type="button" variant="ghost" size="sm" disabled={removeDisabled} aria-label={t('ruleEditor.removeAria', { n })} onClick={onRemove}><X aria-hidden="true" />{t('ruleEditor.remove')}</Button>
      </div>
    </div>
    {script && <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2 pl-[1.625rem]">
      <Disclosure label={t('ruleEditor.viewCode')} />
      <CollapsibleContent><ScriptSource source={script.source} /></CollapsibleContent>
    </Collapsible>}
  </li>;
}
