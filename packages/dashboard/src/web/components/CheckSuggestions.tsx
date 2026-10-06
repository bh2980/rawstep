import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { CheckSuggestion, SuggestionResult } from '../../shared/api';
import { api } from '../api';
import { describeRule } from '../lib/describeRule';
import type { PageProps } from '../pages/types';
import { Disclosure } from './layout/Disclosure';
import { ErrorState } from './layout/ErrorState';
import { ScriptSource, scriptOf } from './RuleCard';
import { describeApiError } from '../lib/errors';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Collapsible, CollapsibleContent } from './ui/collapsible';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import type { ErrorView } from '../lib/errors';

type Props = {
  view: PageProps['view'];
  url: string;
  goal: string;
  /** Append this one to the task's completion checks. */
  onAdd: (rule: VerifyRule) => void;
  /** Titles the panel as a reference list beside the task specification (the new task page). */
  reference?: boolean;
};

/**
 * One suggestion as a candidate condition (spec §20): `제안 01`, a plain sentence, and [추가]. A suggestion that is code the model wrote
 * is set apart in a heavier ADVANCED CHECK block with the code itself, and cannot be added until the person has ticked that they read it.
 */
function Candidate({ suggestion, index, onAdd, added }: { suggestion: CheckSuggestion; index: number; onAdd: Props['onAdd']; added: boolean }) {
  const { t } = useTranslation();
  const ackId = useId();
  const [reviewed, setReviewed] = useState(false), [rawOpen, setRawOpen] = useState(false);
  const script = scriptOf(suggestion.rule), blocked = script !== undefined && !reviewed;
  const number = String(index + 1).padStart(2, '0');
  return <li className="grid gap-2 border-b border-edge py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1">
        <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{t('checkSuggest.candidate', { n: number })}</p>
        <p className="text-[15px] leading-6 font-medium">{describeRule(suggestion.rule)}</p>
        <p className="text-[13px] leading-5 text-muted-foreground">{suggestion.title}{suggestion.why ? ` — ${suggestion.why}` : ''}</p>
        {suggestion.trueAtStart === true && <p className="text-xs leading-5 text-inspect">{t('checkSuggest.trueAtStart')}</p>}
        {!script && suggestion.checkedAtStart === false && <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.changeDuringRun')}</p>}
      </div>
      <Button type="button" variant="outline" disabled={blocked || added} aria-label={t('checkSuggest.addAria', { n: number })} onClick={() => onAdd(suggestion.rule)}><Plus aria-hidden="true" />{added ? t('checkSuggest.added') : t('checkSuggest.add')}</Button>
    </div>
    {script && <div className="grid gap-3 border-2 border-inspect bg-inspect-soft p-3">
      <p lang="en" className="text-xs font-semibold tracking-[0.08em] text-inspect uppercase">{t('labels.advancedCheck')} · {t('labels.generatedCode')}</p>
      <p className="text-[13px] leading-5">{t('checkSuggest.scriptNotice')}</p>
      {script.description && <p className="text-sm leading-6"><span className="font-semibold">{t('checkSuggest.scriptDescription')}</span> {script.description}</p>}
      <ScriptSource source={script.source} />
      <div className="flex items-start gap-2.5">
        <Checkbox id={ackId} checked={reviewed} onCheckedChange={value => setReviewed(value === true)} className="mt-0.5" />
        <Label htmlFor={ackId} className="font-medium leading-5">{t('checkSuggest.scriptAck')}</Label>
      </div>
    </div>}
    <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="grid">
      <Disclosure label={t('checkSuggest.rawJson')} />
      <CollapsibleContent>
        <pre className="max-h-72 overflow-auto rounded-md border bg-raised p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">{JSON.stringify(suggestion.rule, null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  </li>;
}

/**
 * "AI 제안": a reference list of conditions an analysis model proposes from the start page's structure. It is not a chat; nothing changes
 * until a person adds a candidate.
 */
export function CheckSuggestions({ view, url, goal, onAdd, reference }: Props) {
  const { t } = useTranslation();
  const modelId = useId();
  const models = view.config.models.filter(model => model.kind === 'llm' && model.roles.includes('analysis'));
  const [picked, setPicked] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState<ErrorView>();
  const [result, setResult] = useState<SuggestionResult>(), [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const selected = models.find(model => model.id === picked) ?? models[0];
  const ready = url.trim() !== '' && goal.trim() !== '' && selected !== undefined;
  async function suggest() {
    if (!selected) return;
    setLoading(true); setError(undefined); setResult(undefined); setAdded(new Set());
    try {
      setResult(await api<SuggestionResult>('/suggest-checks', { method: 'POST', body: { url: url.trim(), goal: goal.trim(), modelId: selected.id } }));
    } catch (failure) {
      setError(describeApiError(failure, 'start'));
    } finally { setLoading(false); }
  }
  const add = (suggestion: CheckSuggestion, key: string) => { onAdd(suggestion.rule); setAdded(new Set([...added, key])); };
  return <section aria-labelledby={modelId + '-title'} className="grid min-w-0 gap-3 border-t-2 border-foreground pt-3">
    <div className="grid gap-1">
      <h3 id={modelId + '-title'} className="text-base font-semibold">{t('checkSuggest.title')}</h3>
      <p className="text-[13px] leading-5 text-muted-foreground">{reference ? t('checkSuggest.referenceNote') : t('checkSuggest.description')}</p>
    </div>
    {models.length === 0
      ? <p role="status" className="text-sm leading-6 text-muted-foreground">{t('checkSuggest.noModel')}</p>
      : <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={modelId} className="text-xs text-muted-foreground">{t('checkSuggest.model')}</Label>
          <Select value={selected?.id ?? ''} onValueChange={setPicked} disabled={loading}>
            <SelectTrigger id={modelId} className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{models.map(model => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid justify-items-start gap-2">
          <Button type="button" variant="outline" disabled={!ready || loading} aria-describedby={modelId + '-note'} onClick={() => void suggest()}>{loading ? t('checkSuggest.loading') : t('checkSuggest.submit')}</Button>
          <p id={modelId + '-note'} role={loading ? 'status' : undefined} className="text-xs leading-5 text-muted-foreground">{loading ? t('checkSuggest.loadingNote') : !ready ? t('checkSuggest.needInput') : ''}</p>
        </div>
      </div>}
    {error && <ErrorState alert view={error} />}
    {result && <div className="grid gap-1">
      <p className="text-sm font-medium">{t('checkSuggest.pageTitle', { title: result.page.title || t('checkSuggest.pageUntitled') })}</p>
      {result.suggestions.length === 0
        ? <p className="text-sm leading-6 text-muted-foreground">{t('checkSuggest.empty')}</p>
        : <ol aria-label={t('checkSuggest.listLabel')} className="grid">{result.suggestions.map((suggestion, i) => {
          const key = i + JSON.stringify(suggestion.rule);
          return <Candidate key={key} suggestion={suggestion} index={i} added={added.has(key)} onAdd={() => add(suggestion, key)} />;
        })}</ol>}
      {result.dropped > 0 && <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.dropped', { n: result.dropped })}</p>}
    </div>}
  </section>;
}
