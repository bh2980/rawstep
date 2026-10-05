import { useId, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { CheckSuggestion, SuggestionResult } from '../../shared/api';
import { api } from '../api';
import { describeRule } from '../lib/describeRule';
import type { PageProps } from '../pages/types';
import { ScriptSource, scriptOf } from './RuleCard';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Props = {
  view: PageProps['view'];
  url: string;
  goal: string;
  /** Replace the task's completion checks with this one. */
  onUse: (rule: VerifyRule) => void;
  /** Append this one to the task's completion checks. */
  onAdd?: (rule: VerifyRule) => void;
};

const WARNING = 'border-amber-500/60 text-amber-800 dark:text-amber-300';

function SuggestionCard({ suggestion, onUse, onAdd }: { suggestion: CheckSuggestion; onUse: Props['onUse']; onAdd?: Props['onAdd'] }) {
  const { t } = useTranslation();
  const ackId = useId();
  const [reviewed, setReviewed] = useState(false), [rawOpen, setRawOpen] = useState(false);
  const script = scriptOf(suggestion.rule);
  // Model-written code runs on the page at verification time: a person must read it first.
  const blocked = script !== undefined && !reviewed;
  return <Card size="sm">
    <CardHeader>
      <CardTitle>{suggestion.title}</CardTitle>
      <CardDescription>{suggestion.why}</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {suggestion.trueAtStart === true && <Badge variant="outline" className={'h-auto whitespace-normal ' + WARNING}>{t('checkSuggest.trueAtStart')}</Badge>}
        {!script && suggestion.checkedAtStart === false && <Badge variant="secondary" className="h-auto whitespace-normal">{t('checkSuggest.changeDuringRun')}</Badge>}
        {script && <Badge variant="outline" className="h-auto whitespace-normal">{t('checkSuggest.scriptBadge')}</Badge>}
      </div>
      <p className="text-sm leading-6"><span className="font-medium">{t('checkSuggest.meaning')}</span> {describeRule(suggestion.rule)}</p>
      {script && <div className="grid gap-3 rounded-lg border p-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.scriptNotice')}</p>
        {script.description && <p className="text-sm leading-6"><span className="font-medium">{t('checkSuggest.scriptDescription')}</span> {script.description}</p>}
        <ScriptSource source={script.source} />
        <div className="flex items-start gap-2">
          <Checkbox id={ackId} checked={reviewed} onCheckedChange={value => setReviewed(value === true)} />
          <Label htmlFor={ackId} className="font-normal leading-5">{t('checkSuggest.scriptAck')}</Label>
        </div>
      </div>}
      <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="grid gap-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="justify-self-start">
            <ChevronDown aria-hidden="true" className={'transition-transform' + (rawOpen ? ' rotate-180' : '')} />{t('checkSuggest.rawJson')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">{JSON.stringify(suggestion.rule, null, 2)}</pre>
        </CollapsibleContent>
      </Collapsible>
    </CardContent>
    <CardFooter className="flex-wrap justify-end gap-2">
      <Button type="button" disabled={blocked} onClick={() => onUse(suggestion.rule)}>{t('checkSuggest.use')}</Button>
      {onAdd && <Button type="button" variant="outline" disabled={blocked} onClick={() => onAdd(suggestion.rule)}>{t('checkSuggest.add')}</Button>}
    </CardFooter>
  </Card>;
}

/**
 * Asks an analysis model for completion checks based on the start page's structure.
 * Nothing changes until a person picks a suggestion; script suggestions also need an explicit "I read the code" check.
 */
export function CheckSuggestions({ view, url, goal, onUse, onAdd }: Props) {
  const { t } = useTranslation();
  const modelId = useId();
  const models = view.config.models.filter(model => model.kind === 'llm' && model.roles.includes('analysis'));
  const [picked, setPicked] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState<string>();
  const [result, setResult] = useState<SuggestionResult>();
  const selected = models.find(model => model.id === picked) ?? models[0];
  const ready = url.trim() !== '' && goal.trim() !== '' && selected !== undefined;
  async function suggest() {
    if (!selected) return;
    setLoading(true); setError(undefined); setResult(undefined);
    try {
      setResult(await api<SuggestionResult>('/suggest-checks', { method: 'POST', body: { url: url.trim(), goal: goal.trim(), modelId: selected.id } }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('apiErrors.requestFailed'));
    } finally { setLoading(false); }
  }
  return <section className="grid gap-4 rounded-lg border p-4" aria-labelledby={modelId + '-title'}>
    <div className="grid gap-1">
      <h3 id={modelId + '-title'} className="flex items-center gap-2 font-medium"><Sparkles aria-hidden="true" className="size-4" />{t('checkSuggest.title')}</h3>
      <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.description')}</p>
    </div>
    {models.length === 0
      ? <p role="status" className="text-sm leading-6 text-muted-foreground">{t('checkSuggest.noModel')}</p>
      : <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={modelId}>{t('checkSuggest.model')}</Label>
          <Select value={selected?.id ?? ''} onValueChange={setPicked} disabled={loading}>
            <SelectTrigger id={modelId} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{models.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid justify-items-start gap-2">
          <Button type="button" variant="outline" disabled={!ready || loading} aria-describedby={modelId + '-note'} onClick={() => void suggest()}>{loading ? t('checkSuggest.loading') : t('checkSuggest.submit')}</Button>
          <p id={modelId + '-note'} role={loading ? 'status' : undefined} className="text-xs leading-5 text-muted-foreground">{loading ? t('checkSuggest.loadingNote') : !ready ? t('checkSuggest.needInput') : ''}</p>
        </div>
      </div>}
    {error && <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
    {result && <div className="grid gap-3">
      <p className="text-sm font-medium">{t('checkSuggest.pageTitle', { title: result.page.title || t('checkSuggest.pageUntitled') })}</p>
      {result.suggestions.length === 0 && <p className="text-sm leading-6 text-muted-foreground">{t('checkSuggest.empty')}</p>}
      {result.suggestions.map((suggestion, i) => <SuggestionCard key={i + JSON.stringify(suggestion.rule)} suggestion={suggestion} onUse={onUse} onAdd={onAdd} />)}
      {result.dropped > 0 && <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.dropped', { n: result.dropped })}</p>}
    </div>}
  </section>;
}
