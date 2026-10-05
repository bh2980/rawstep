import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeRule } from '../lib/describeRule';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The source of a script rule as read-only text. It is never executed or edited here. */
export function ScriptSource({ source }: { source: string }) {
  const { t } = useTranslation();
  return <pre role="region" aria-label={t('checkSuggest.scriptCode')} tabIndex={0} className="max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all"><code>{source}</code></pre>;
}

/** The script source and description of a rule, when it is a script rule. */
export function scriptOf(rule: unknown): { source: string; description: string } | undefined {
  if (!isRecord(rule) || !isRecord(rule.script) || typeof rule.script.source !== 'string') return undefined;
  return { source: rule.script.source, description: typeof rule.script.description === 'string' ? rule.script.description : '' };
}

/**
 * One completion check as a card: a plain-language sentence, the read-only code for script rules and a remove button.
 * `n` is the 1-based position, used in accessible names.
 */
export function RuleCard({ rule, n, onRemove, removeDisabled }: { rule: unknown; n: number; onRemove: () => void; removeDisabled?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const script = scriptOf(rule);
  return <Card size="sm">
    <CardContent className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-6">{describeRule(rule)}</p>
        <Button type="button" variant="outline" size="sm" disabled={removeDisabled} aria-label={t('ruleText.removeAria', { n })} onClick={onRemove}><X aria-hidden="true" />{t('ruleText.remove')}</Button>
      </div>
      {script && <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-label={t('ruleText.scriptViewCodeAria', { n })}>
            <ChevronDown aria-hidden="true" className={'transition-transform' + (open ? ' rotate-180' : '')} />{t('ruleText.scriptViewCode')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent><ScriptSource source={script.source} /></CollapsibleContent>
      </Collapsible>}
    </CardContent>
  </Card>;
}
