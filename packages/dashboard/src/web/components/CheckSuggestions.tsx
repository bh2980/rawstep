import { useId, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import { suggestionModel } from '@rawstep/project/config';
import type { CheckSuggestion, SuggestionResult } from '../../shared/api';
import { api } from '../api';
import { useRoute } from '../hooks/useRoute';
import { currentLanguage } from '../i18n';
import { describeRule } from '../lib/describeRule';
import { describeApiError, type ErrorView } from '../lib/errors';
import type { PageProps } from '../pages/types';
import { ErrorState } from './layout/ErrorState';
import { ScriptSource, scriptOf } from './RuleCard';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

type Props = {
  view: PageProps['view'];
  url: string;
  goal: string;
  /** Append this one to the task's completion checks. */
  onAdd: (rule: VerifyRule) => void;
};

/**
 * One suggestion as a ruled line: the condition as a sentence and [추가]. A suggestion that is code the model wrote shows the code
 * and cannot be added until the person has ticked that they read it.
 */
function Candidate({ suggestion, index, onAdd, added }: { suggestion: CheckSuggestion; index: number; onAdd: Props['onAdd']; added: boolean }) {
  const { t } = useTranslation();
  const ackId = useId();
  const [reviewed, setReviewed] = useState(false);
  const script = scriptOf(suggestion.rule), blocked = script !== undefined && !reviewed;
  const note = suggestion.trueAtStart === true ? t('checkSuggest.trueAtStart') : !script && suggestion.checkedAtStart === false ? t('checkSuggest.changeDuringRun') : undefined;
  return <li className="grid gap-2 border-b border-edge py-2.5">
    <div className="flex items-start justify-between gap-3">
      <div className="grid min-w-0 gap-0.5">
        <p className="text-sm leading-6 font-medium">{describeRule(suggestion.rule)}</p>
        {(suggestion.why || note) && <p className="text-[13px] leading-5 text-muted-foreground">{[suggestion.why, note].filter(Boolean).join(' · ')}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={blocked || added} aria-label={t('checkSuggest.addAria', { n: index + 1 })} onClick={() => onAdd(suggestion.rule)}>
        {added ? t('checkSuggest.added') : <><Plus aria-hidden="true" />{t('checkSuggest.add')}</>}
      </Button>
    </div>
    {script && <div className="grid gap-2 border-l-4 border-inspect bg-inspect-soft p-3">
      <p className="text-[13px] leading-5">{t('checkSuggest.scriptNotice')}</p>
      {script.description && <p className="text-sm leading-6"><span className="font-semibold">{t('checkSuggest.scriptDescription')}</span> {script.description}</p>}
      <ScriptSource source={script.source} />
      <div className="flex items-start gap-2.5">
        <Checkbox id={ackId} checked={reviewed} onCheckedChange={value => setReviewed(value === true)} className="mt-0.5" />
        <Label htmlFor={ackId} className="font-medium leading-5">{t('checkSuggest.scriptAck')}</Label>
      </div>
    </div>}
  </li>;
}

/**
 * AI suggestions for completion checks, as a compact block under the check editor: one button asks the project's suggestion model
 * for conditions from the start page's structure. Without a model it is one line linking to 설정. Nothing changes until a person
 * adds a candidate.
 */
export function CheckSuggestions({ view, url, goal, onAdd }: Props) {
  const { t } = useTranslation();
  const { navigate } = useRoute();
  const id = useId();
  // The project's suggestion model writes the suggestions (its analysis model when none is set), as the server picks it.
  const model = suggestionModel(view.config);
  const [loading, setLoading] = useState(false), [error, setError] = useState<ErrorView>();
  const [result, setResult] = useState<SuggestionResult>(), [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const ready = url.trim() !== '' && goal.trim() !== '';
  async function suggest() {
    setLoading(true); setError(undefined); setResult(undefined); setAdded(new Set());
    try {
      setResult(await api<SuggestionResult>('/suggest-checks', { method: 'POST', body: { url: url.trim(), goal: goal.trim(), language: currentLanguage() } }));
    } catch (failure) {
      setError(describeApiError(failure, 'start'));
    } finally { setLoading(false); }
  }
  const add = (suggestion: CheckSuggestion, key: string) => { onAdd(suggestion.rule); setAdded(new Set([...added, key])); };
  if (!model) return <p className="flex flex-wrap items-center gap-x-1 text-[13px] text-muted-foreground">
    <Sparkles aria-hidden="true" className="size-3.5" />{t('suggestModel.none')}
    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => navigate({ view: 'settings', section: 'connections' })}>{t('suggestModel.connect')}</Button>
  </p>;
  return <section aria-label={t('checkSuggest.title')} className="grid min-w-0 gap-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" size="sm" disabled={!ready || loading} aria-describedby={id + '-note'} onClick={() => void suggest()}><Sparkles aria-hidden="true" />{loading ? t('checkSuggest.loading') : t('checkSuggest.submit')}</Button>
      <p id={id + '-note'} role={loading ? 'status' : undefined} className="text-xs leading-5 text-muted-foreground">
        {loading ? t('checkSuggest.loadingNote') : !ready ? t('checkSuggest.needInput') : `${t('suggestModel.line', { model: model.name })} · ${t('checkSuggest.privacy')}`}
      </p>
    </div>
    {error && <ErrorState alert view={error} />}
    {result && <div className="grid gap-1">
      <p className="text-[13px] text-muted-foreground">{t('checkSuggest.pageTitle', { title: result.page.title || t('checkSuggest.pageUntitled') })}</p>
      {result.suggestions.length === 0
        ? <p className="text-sm leading-6 text-muted-foreground">{t('checkSuggest.empty')}</p>
        : <ol aria-label={t('checkSuggest.listLabel')} className="grid border-t border-edge">{result.suggestions.map((suggestion, i) => {
          const key = i + JSON.stringify(suggestion.rule);
          return <Candidate key={key} suggestion={suggestion} index={i} added={added.has(key)} onAdd={() => add(suggestion, key)} />;
        })}</ol>}
      {result.dropped > 0 && <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.dropped', { n: result.dropped })}</p>}
    </div>}
  </section>;
}
