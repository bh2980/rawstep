import { useState } from 'react';
import { ChevronDown, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeRule } from '../lib/describeRule';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The source of a script rule as read-only text. It is never executed here. */
export function ScriptSource({ source }: { source: string }) {
  const { t } = useTranslation();
  return <pre role="region" aria-label={t('checkSuggest.scriptCode')} tabIndex={0} className="max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all"><code>{source}</code></pre>;
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

/** One completion check as a row: a plain-language sentence, the read-only code of a script rule, and change / remove buttons. */
export function RuleCard({ rule, n, onRemove, removeDisabled, onEdit, editing }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const script = scriptOf(rule);
  return <li className={'grid gap-2 rounded-lg border px-3 py-2' + (editing ? ' border-primary bg-primary/5' : '')}>
    <div className="flex items-start justify-between gap-3">
      <p className="min-w-0 text-sm leading-6">{describeRule(rule)}</p>
      <div className="flex shrink-0 gap-1.5">
        {onEdit && <Button type="button" variant="outline" size="sm" aria-label={t('ruleEditor.editAria', { n })} onClick={onEdit}><Pencil aria-hidden="true" />{t('ruleEditor.edit')}</Button>}
        <Button type="button" variant="outline" size="sm" disabled={removeDisabled} aria-label={t('ruleEditor.removeAria', { n })} onClick={onRemove}><X aria-hidden="true" />{t('ruleEditor.remove')}</Button>
      </div>
    </div>
    {script && <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-label={t('ruleEditor.viewCodeAria', { n })}>
          <ChevronDown aria-hidden="true" className={'transition-transform' + (open ? ' rotate-180' : '')} />{t('ruleEditor.viewCode')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent><ScriptSource source={script.source} /></CollapsibleContent>
    </Collapsible>}
  </li>;
}
